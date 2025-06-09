import { TradeSignal } from "./traide-signal.interface";

export interface TradeRecord extends TradeSignal {
    timestamp: number;
    status: 'open' | 'closed' | 'cancelled';
    profitLoss?: number;
}