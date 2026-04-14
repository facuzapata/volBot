import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MultiUserStrategyService } from './services/multi-user-strategy.service';
import { SignalDatabaseService } from './services/signal-database.service';
import { CandleCacheService } from './services/candle-cache.service';
import { AiAnalysisService } from './services/ai-analysis.service';
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
    MultiUserStrategyService,
    SignalDatabaseService,
    CandleCacheService,
    AiAnalysisService
  ],
  exports: [
    MultiUserStrategyService,
    SignalDatabaseService,
    CandleCacheService,
    AiAnalysisService
  ],
})
export class StrategyModule { }