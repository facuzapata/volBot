export interface CreateOrderParams {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
    timeInForce?: 'FOK' | 'IOC' | 'GTC' | 'GTX'
}

export interface CreateOCOParams {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;           // take profit (LIMIT leg)
    stopPrice: number;       // stop trigger price
    stopLimitPrice: number;  // stop limit execution price (slightly below stopPrice)
    stopLimitTimeInForce?: 'FOK' | 'IOC' | 'GTC';
}