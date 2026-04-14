export interface TradeReport {
    signalId: string;
    symbol: string;
    buyPrice: number;
    sellPrice: number;
    quantity: number;
    totalBuyAmount: number;
    totalSellAmount: number;
    grossProfit: number;
    totalCommission: number;
    netProfit: number;
    profitPercent: number;
    roi: number;
    duration: string;
    paperTrading: boolean;
    stoppedByStopLoss: boolean;
}