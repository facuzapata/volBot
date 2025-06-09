import { forwardRef, Module } from '@nestjs/common';
import { BinanceWsService } from './services/binance-ws.service';
import { StrategyModule } from 'src/strategy/strategy.module';

@Module({
  imports: [forwardRef(() => StrategyModule)],
  providers: [BinanceWsService],
  exports: [BinanceWsService],
})
export class BinanceModule { }