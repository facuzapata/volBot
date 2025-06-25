export interface TradeSignal {
    id: string;
    symbol: string;
    price: number;
    size: number; // Tamaño de la posición
    stopLoss: number;
    takeProfit: number;
    side: 'buy' | 'sell';
    paperTrading: boolean;
}