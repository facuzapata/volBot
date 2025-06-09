import { Module } from '@nestjs/common';
import { TradingService } from './services/trading.service';

@Module({
  providers: [TradingService]
})
export class TradingModule { }
