import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignalDatabaseService } from './signal-database.service';
import { TradeSignal } from '../interfaces/traide-signal.interface';

interface CandleInput {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    time?: number;
    timestamp?: number;
}

@Injectable()
export class StrategyService {
    private readonly logger = new Logger(StrategyService.name);
    private closes: number[] = [];
    private openPosition: {
        signalId: string;
        symbol: string;
        entry: number;
        size: number;
        stopLoss: number;
        takeProfit: number;
    } | null = null;

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly signalDbService: SignalDatabaseService
    ) { }

    async processCandle(candle: CandleInput): Promise<void> {
        if (!Number.isFinite(candle?.close) || candle.close <= 0) {
            return;
        }

        this.closes.push(candle.close);
        if (this.closes.length < 22) {
            return;
        }

        const shortNow = this.calculateSma(9, 0);
        const longNow = this.calculateSma(21, 0);
        const shortPrev = this.calculateSma(9, 1);
        const longPrev = this.calculateSma(21, 1);

        if (
            !this.openPosition &&
            shortNow !== null &&
            longNow !== null &&
            shortPrev !== null &&
            longPrev !== null &&
            shortPrev <= longPrev &&
            shortNow > longNow
        ) {
            await this.openBuyPosition(candle);
            return;
        }

        if (this.openPosition) {
            await this.tryCloseOpenPosition(candle);
        }
    }

    private calculateSma(period: number, offset: number): number | null {
        const end = this.closes.length - offset;
        const start = end - period;
        if (start < 0) {
            return null;
        }

        const slice = this.closes.slice(start, end);
        if (slice.length !== period) {
            return null;
        }

        const total = slice.reduce((sum, value) => sum + value, 0);
        return total / period;
    }

    private async openBuyPosition(candle: CandleInput): Promise<void> {
        const entry = candle.close;
        const size = 1;
        const stopLoss = entry * 0.99;
        const takeProfit = entry * 1.02;
        const symbol = 'BTCUSDT';

        const signal = await this.signalDbService.createSignal({
            symbol,
            initialPrice: entry,
            stopLoss,
            takeProfit,
            atr: Math.abs(candle.high - candle.low),
            rsi: 50,
            macd: 0,
            smaShort: this.calculateSma(9, 0) || entry,
            smaLong: this.calculateSma(21, 0) || entry,
            volume: candle.volume,
            paperTrading: true
        });

        await this.signalDbService.createMovement({
            signalId: String(signal.id),
            type: 'buy' as any,
            price: entry,
            quantity: size,
            totalAmount: entry * size,
            commission: entry * size * 0.001,
            netAmount: entry * size * 1.001
        });

        const tradeSignal: TradeSignal = {
            id: String(signal.id),
            symbol,
            side: 'buy',
            price: entry,
            size,
            stopLoss,
            takeProfit,
            paperTrading: true,
            timestamp: candle.time || candle.timestamp || Date.now()
        };

        this.openPosition = {
            signalId: String(signal.id),
            symbol,
            entry,
            size,
            stopLoss,
            takeProfit
        };

        this.eventEmitter.emit('trade.buy', tradeSignal);
        this.logger.debug(`Buy emitida para señal ${signal.id}`);
    }

    private async tryCloseOpenPosition(candle: CandleInput): Promise<void> {
        if (!this.openPosition) return;

        const hitStop = candle.close <= this.openPosition.stopLoss;
        const hitTake = candle.close >= this.openPosition.takeProfit;

        if (!hitStop && !hitTake) {
            return;
        }

        const closePrice = candle.close;

        await this.signalDbService.createMovement({
            signalId: this.openPosition.signalId,
            type: 'sell' as any,
            price: closePrice,
            quantity: this.openPosition.size,
            totalAmount: closePrice * this.openPosition.size,
            commission: closePrice * this.openPosition.size * 0.001,
            netAmount: closePrice * this.openPosition.size * 0.999
        });

        const sellSignal: TradeSignal = {
            id: `${this.openPosition.signalId}-sell-${Date.now()}`,
            symbol: this.openPosition.symbol,
            side: 'sell',
            price: closePrice,
            size: this.openPosition.size,
            stopLoss: this.openPosition.stopLoss,
            takeProfit: this.openPosition.takeProfit,
            buySignalId: this.openPosition.signalId,
            paperTrading: true,
            timestamp: candle.time || candle.timestamp || Date.now()
        };

        this.eventEmitter.emit('trade.sell', sellSignal);
        this.logger.debug(`Sell emitida para señal ${this.openPosition.signalId}`);
        this.openPosition = null;
    }
}