import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/typeorm.config';
import { ConfigModule } from '@nestjs/config';
import { BinanceModule } from './binance/binance.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { StrategyModule } from './strategy/strategy.module';
import { TradingModule } from './traiding/trading.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(typeOrmConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    BinanceModule,
    StrategyModule,
    TradingModule,
    NotificationsModule,
  ],
})
export class AppModule { }
