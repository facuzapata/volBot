import { MovementStatus } from 'src/strategy/entities';

export interface BinanceOrderResponse {
    id(id: any, FILLED: MovementStatus, arg2: { binanceResponse: BinanceOrderResponse; }): unknown;
    symbol: string;
    orderId: number;
    orderListId: number;
    clientOrderId: string;
    transactTime: number;
    price: string;
    origQty: string;
    executedQty: string;
    cummulativeQuoteQty: string;
    status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'PENDING_CANCEL' | 'REJECTED' | 'EXPIRED';
    timeInForce: string;
    type: string;
    side: 'BUY' | 'SELL';
    fills?: Array<{
        price: string;
        qty: string;
        commission: string;
        commissionAsset: string;
    }>;
}
