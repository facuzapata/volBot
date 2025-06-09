// src/binance/binance.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Binance from 'binance-api-node';

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
    private client = Binance();
    private wsCloseFn: (() => void) | null = null;
    private readonly logger = new Logger(BinanceService.name);

    constructor(private eventEmitter: EventEmitter2) { }

    onModuleInit() {
        const symbol = process.env.BINANCE_SYMBOL || 'BTCUSDT';
        this.subscribeToSymbol(symbol); // puedes cambiar a ETHUSDT, etc.
    }

    onModuleDestroy() {
        if (this.wsCloseFn) this.wsCloseFn();
    }

    subscribeToSymbol(symbol: string) {
        this.wsCloseFn = this.client.ws.ticker(symbol, (ticker) => {
            const price = parseFloat(ticker.curDayClose);
            this.eventEmitter.emit('binance.price.update', {
                symbol,
                price,
                time: Date.now(),
            });
        });
    }

    async getPrice(symbol: string): Promise<number> {
        const ticker = await this.client.prices({ symbol });
        return parseFloat(ticker[symbol]);
    }
}
