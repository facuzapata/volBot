import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinanceWsService } from './services/binance-ws.service';
import { BinanceService } from './services/binance.service';
import { MultiBinanceService } from './services/multi-binance.service';
import { StrategyModule } from 'src/strategy/strategy.module';
import { User } from '../users/entities/user.entity';
import { UserCredentials } from '../users/entities/user-credentials.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCredentials]),
    forwardRef(() => StrategyModule)
  ],
  providers: [
    BinanceWsService,
    // Original service (commented for backup)
    // BinanceService,

    // New multi-user service
    MultiBinanceService
  ],
  exports: [
    BinanceWsService,
    // BinanceService, // Original service
    MultiBinanceService // New multi-user service
  ],
})
export class BinanceModule { }