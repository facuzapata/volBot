export interface PositionOpenReport {
    signalId: string;
    symbol: string;
    entryPrice: number;
    quantity: number;
    totalAmount: number;
    commission: number;
    netAmount: number;
    stopLoss: number;
    takeProfit: number;
    paperTrading: boolean;
    openedAt: Date;
}