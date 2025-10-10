export interface CreateOrderParams {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
    timeInForce?: 'FOK' | 'IOC' | 'GTC' | 'GTX'
}