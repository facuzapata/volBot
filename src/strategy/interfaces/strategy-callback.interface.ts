export interface StrategyCallback {
    /**
     * Procesa una vela completada
     */
    processCandle?(candle: {
        open: number;
        close: number;
        high: number;
        low: number;
        volume: number;
        timestamp: number;
    }): void;

    /**
     * Procesa una vela con información del símbolo y timeframe
     * Usado por BinanceMultiWsService
     */
    processCandleMulti?(
        candle: {
            open: number;
            close: number;
            high: number;
            low: number;
            volume: number;
            timestamp: number;
        },
        symbol: string,
        timeframeMinutes: number
    ): Promise<void>;
}
