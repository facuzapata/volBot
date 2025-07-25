import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StrategyService } from './services/strategy.service';
import { SignalDatabaseService } from './services/signal-database.service';
import { CandleCacheService } from './services/candle-cache.service';
import { BinanceModule } from 'src/binance/binance.module';
import { Signal, Movement } from './entities';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, Movement]),
    forwardRef(() => BinanceModule),
    NotificationsModule
  ],
  providers: [StrategyService, SignalDatabaseService, CandleCacheService],
  exports: [StrategyService, SignalDatabaseService, CandleCacheService],
})
export class StrategyModule { }