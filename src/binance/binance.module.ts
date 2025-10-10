import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinanceWsService } from './services/binance-ws.service';
import { BinanceService } from './services/binance.service';
import { MultiBinanceService } from './services/multi-binance.service';
import { StrategyModule } from 'src/strategy/strategy.module';
import { User } from '../users/entities/user.entity';
import { UserCredentials } from '../users/entities/user-credentials.entity';
import { SignalDatabaseService } from '../strategy/services/signal-database.service';
import { Signal, Movement } from '../strategy/entities';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCredentials, Signal, Movement]),
    NotificationsModule, // Para el SignalDatabaseService
    forwardRef(() => StrategyModule)
  ],
  providers: [
    BinanceWsService,
    // Original service (commented for backup)
    // BinanceService,

    // New multi-user service
    MultiBinanceService,

    // Shared service needed by MultiBinanceService
    SignalDatabaseService
  ],
  exports: [
    BinanceWsService,
    // BinanceService, // Original service
    MultiBinanceService // New multi-user service
  ],
})
export class BinanceModule { }