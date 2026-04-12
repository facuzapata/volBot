import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinanceMultiWsService } from './services/binance-multi-ws.service';
import { MultiBinanceService } from './services/multi-binance.service';
import { StrategyModule } from 'src/strategy/strategy.module';
import { UsersModule } from '../users/users.module';
import { User } from '../users/entities/user.entity';
import { UserCredentials } from '../users/entities/user-credentials.entity';
import { UserTradeConfig } from '../users/entities/user-trade-config.entity';
import { SignalDatabaseService } from '../strategy/services/signal-database.service';
import { Signal, Movement } from '../strategy/entities';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCredentials, UserTradeConfig, Signal, Movement]),
    NotificationsModule,
    UsersModule,
    forwardRef(() => StrategyModule)
  ],
  providers: [
    BinanceMultiWsService,
    MultiBinanceService,
    SignalDatabaseService
  ],
  exports: [
    BinanceMultiWsService,
    MultiBinanceService
  ],
})
export class BinanceModule { }