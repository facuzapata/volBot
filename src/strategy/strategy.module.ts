import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StrategyService } from './services/strategy.service';
import { MultiUserStrategyService } from './services/multi-user-strategy.service';
import { SignalDatabaseService } from './services/signal-database.service';
import { CandleCacheService } from './services/candle-cache.service';
import { BinanceModule } from 'src/binance/binance.module';
import { Signal, Movement } from './entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { UserCredentials } from '../users/entities/user-credentials.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, Movement, User, UserCredentials]),
    forwardRef(() => BinanceModule),
    NotificationsModule
  ],
  providers: [
    // Original service (commented for backup)
    // StrategyService,

    // New multi-user service
    MultiUserStrategyService,

    // Shared services
    SignalDatabaseService,
    CandleCacheService
  ],
  exports: [
    // StrategyService, // Original service
    MultiUserStrategyService, // New multi-user service
    SignalDatabaseService,
    CandleCacheService
  ],
})
export class StrategyModule { }