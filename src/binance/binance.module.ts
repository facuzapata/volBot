import { forwardRef, Module } from '@nestjs/common';
import { BinanceWsService } from './services/binance-ws.service';
import { BinanceService } from './services/binance.service';
import { StrategyModule } from 'src/strategy/strategy.module';

@Module({
  imports: [forwardRef(() => StrategyModule)],
  providers: [BinanceWsService, BinanceService],
  exports: [BinanceWsService, BinanceService],
})
export class BinanceModule { }