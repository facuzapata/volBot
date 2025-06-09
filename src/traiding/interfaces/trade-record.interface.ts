import { TradeSignal } from 'src/strategy/interfaces/traide-signal.interface';

export interface TradeRecord extends TradeSignal {
    timestamp: number;
    status: 'open' | 'closed';
    closePrice?: number;
    closeTimestamp?: number;
}