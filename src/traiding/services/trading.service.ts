import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TradeSignal } from 'src/strategy/interfaces/traide-signal.interface';
import { TradeRecord } from '../interfaces/trade-record.interface';

@Injectable()
export class TradingService {
    private readonly logger = new Logger(TradingService.name);

    private openTrades: TradeRecord[] = [];

    @OnEvent('trade.buy')
    async onBuy(tradeSignal: TradeSignal) {
        this.logger.log(`🟢 Compra simulada: ${tradeSignal.symbol} @ ${tradeSignal.price.toFixed(2)} tamaño ${tradeSignal.size.toFixed(4)}`);
        this.openTrades.push({ ...tradeSignal, timestamp: Date.now(), status: 'open' });
    }

    @OnEvent('trade.sell')
    async onSell(tradeSignal: TradeSignal) {
        this.logger.log(`🔴 Venta simulada: ${tradeSignal.symbol} @ ${tradeSignal.price.toFixed(2)} tamaño ${tradeSignal.size.toFixed(4)}`);
        this.openTrades.push({ ...tradeSignal, timestamp: Date.now(), status: 'open' });
    }

    @OnEvent('price.update')
    async onPriceUpdate(payload: { symbol: string; price: number }) {
        const { price } = payload;

        for (const trade of this.openTrades) {
            if (trade.status !== 'open') continue;

            if (
                (trade.side === 'buy' && (price <= trade.stopLoss || price >= trade.takeProfit)) ||
                (trade.side === 'sell' && (price >= trade.stopLoss || price <= trade.takeProfit))
            ) {
                trade.status = 'closed';
                trade.closePrice = price;
                trade.closeTimestamp = Date.now();

                this.logger.log(`📉 Trade cerrado: ${trade.side} ${trade.symbol} @ ${price.toFixed(2)}`);
                // Podés emitir eventos o actualizar DB acá
            }
        }
    }
}
