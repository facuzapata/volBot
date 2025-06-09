import { forwardRef, Module } from '@nestjs/common';
import { StrategyService } from './services/strategy.service';
import { BinanceModule } from 'src/binance/binance.module';

@Module({
  imports: [forwardRef(() => BinanceModule)],
  providers: [StrategyService],
  exports: [StrategyService],
})
export class StrategyModule { }