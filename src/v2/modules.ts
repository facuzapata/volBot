import { Module, OnModuleDestroy, OnModuleInit, Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createServer, Server } from 'http';
import { DataSource } from 'typeorm';
import { databaseUrl, simulationConfig } from './config';
import { V2_ENTITIES } from './persistence/entities';
import { StoreService } from './persistence/store.service';
import { EXECUTION_ADAPTER, PaperExecutionAdapter } from './execution/paper-execution.adapter';
import { StrategyEngine } from './strategy/strategy-engine';
import { BacktestingEngine } from './backtesting/backtesting.engine';
import { PublicMarketClient } from './market/public-market.client';
import { SimulationSettings } from './market/simulation-settings';
import { RedisCacheService } from './market/redis-cache.service';
import { MarketDataService } from './market/market-data.service';
import {
  ExecutionEngineService,
  PositionManagerService,
  RiskManagerService,
  SignalDispatcherService,
  StrategyServiceV2,
} from './trading/trading.services';
import { KafkaService } from './events/kafka.service';
import { NotificationServiceV2 } from './notifications/notification.service';
import { API_CONTROLLERS } from './api/controllers';
import { ApiService } from './api/api.service';
import { AuthGuardV2, jwtSecret } from './api/auth';
import { RiskPolicy } from './risk/risk-policy';
import { StrategyApprovalService } from './strategy/approval.service';
import { BinanceCredentialsService } from './execution/binance-credentials.service';
import { TelegramClient } from './notifications/telegram.client';
import { TelegramCommandsService } from './notifications/telegram-commands.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env.v2' }),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        simulationConfig();
        return {
          type: 'postgres' as const,
          url: databaseUrl(),
          entities: V2_ENTITIES,
          synchronize: false,
          migrationsRun: false,
          logging: false,
          retryAttempts: 3,
          extra: { max: 12, connectionTimeoutMillis: 5000, statement_timeout: 30000 },
        };
      },
    }),
  ],
  providers: [
    StoreService,
    PaperExecutionAdapter,
    { provide: EXECUTION_ADAPTER, useExisting: PaperExecutionAdapter },
    StrategyEngine,
    RiskPolicy,
    StrategyApprovalService,
    BinanceCredentialsService,
    PublicMarketClient,
    SimulationSettings,
    RedisCacheService,
  ],
  exports: [
    TypeOrmModule,
    StoreService,
    PaperExecutionAdapter,
    EXECUTION_ADAPTER,
    StrategyEngine,
    RiskPolicy,
    StrategyApprovalService,
    BinanceCredentialsService,
    PublicMarketClient,
    SimulationSettings,
    RedisCacheService,
  ],
})
export class CoreModule {}
@Module({ imports: [CoreModule], providers: [RiskManagerService], exports: [RiskManagerService] })
export class RiskManagerModule {}
@Module({
  imports: [CoreModule, RiskManagerModule],
  providers: [SignalDispatcherService],
  exports: [SignalDispatcherService],
})
export class SignalDispatcherModule {}
@Module({
  imports: [CoreModule],
  providers: [ExecutionEngineService],
  exports: [ExecutionEngineService],
})
export class ExecutionModule {}
@Module({
  imports: [CoreModule],
  providers: [PositionManagerService],
  exports: [PositionManagerService],
})
export class PositionManagerModule {}
@Module({
  imports: [CoreModule, PositionManagerModule],
  providers: [StrategyServiceV2],
  exports: [StrategyServiceV2],
})
export class StrategyModuleV2 {}
@Module({ imports: [CoreModule], providers: [MarketDataService], exports: [MarketDataService] })
export class MarketDataModule {}
@Module({
  imports: [CoreModule],
  providers: [NotificationServiceV2, TelegramCommandsService,
    { provide: TelegramClient, useFactory: () => new TelegramClient() }],
  exports: [NotificationServiceV2],
})
export class NotificationModule {}
@Module({
  imports: [CoreModule],
  providers: [{ provide: BacktestingEngine, useFactory: () => new BacktestingEngine() }],
  exports: [BacktestingEngine],
})
export class BacktestingModule {}
@Module({
  imports: [
    CoreModule,
    StrategyModuleV2,
    SignalDispatcherModule,
    ExecutionModule,
    NotificationModule,
  ],
  providers: [KafkaService],
  exports: [KafkaService],
})
export class EventsModule {}
@Module({
  imports: [
    CoreModule,
    BacktestingModule,
    JwtModule.registerAsync({ useFactory: () => ({ secret: jwtSecret() }) }),
  ],
  controllers: API_CONTROLLERS,
  providers: [ApiService, { provide: APP_GUARD, useClass: AuthGuardV2 }],
})
export class V2ApiModule {}

@Injectable()
export class WorkerHealthService implements OnModuleInit, OnModuleDestroy {
  private server?: Server;
  private dailyTimer?: NodeJS.Timeout;
  constructor(
    private readonly kafka: KafkaService,
    private readonly market: MarketDataService,
    private readonly notifications: NotificationServiceV2,
    private readonly db: DataSource,
  ) {}
  onModuleInit(): void {
    this.server = createServer((req, res) => {
      const ready =
        this.kafka.connected && this.market.ready && this.market.connected && this.db.isInitialized;
      res.statusCode = req.url === '/health/live' ? 200 : ready ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          mode: 'PAPER',
          ready,
          kafka: this.kafka.connected,
          market: this.market.connected,
        }),
      );
    });
    this.server.listen(Number(process.env.V2_WORKER_PORT || 3101), '0.0.0.0');
    // Catch up yesterday on restart. dailySummary is idempotent per account/day.
    void this.notifications.dailySummary().catch(() => undefined);
    this.dailyTimer = setInterval(() => {
      const date = new Date();
      if (date.getUTCMinutes() === 0)
        void this.notifications.dailySummary().catch(() => undefined);
    }, 30000);
  }
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.dailyTimer);
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
@Module({
  imports: [CoreModule, MarketDataModule, EventsModule, NotificationModule],
  providers: [WorkerHealthService],
})
export class V2WorkerModule {}
