export interface StrategyCallback {
    processCandle(candle: {
        open: number;
        close: number;
        high: number;
        low: number;
        volume: number;
        timestamp: number;
    }): void;
}