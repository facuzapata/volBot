// src/utils/indicators.ts

export interface Candle {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp?: number;
}

// Simple Moving Average
export function calculateSMA(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const slice = data.slice(data.length - period);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    return sum / period;
}

// Relative Strength Index
export function calculateRSI(data: number[], period = 14): number | null {
    if (data.length < period + 1) return null;

    let gains = 0;
    let losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    if (losses === 0) return 100;

    const rs = gains / losses;
    const rsi = 100 - 100 / (1 + rs);
    return rsi;
}

// Exponential Moving Average helper
function calculateEMA(data: number[], period: number): number[] | null {
    if (data.length < period) return null;

    const k = 2 / (period + 1);
    const ema: number[] = [];
    // First EMA = SMA of first period
    let prevEma = calculateSMA(data.slice(0, period), period);
    if (prevEma === null) return null;
    ema.push(prevEma);

    for (let i = period; i < data.length; i++) {
        const currentEma = data[i] * k + prevEma! * (1 - k);
        ema.push(currentEma);
        prevEma = currentEma;
    }
    return ema;
}

// MACD calculation returns macdLine and signalLine arrays
export function calculateMACD(
    data: number[],
    shortPeriod = 12,
    longPeriod = 26,
    signalPeriod = 9,
): { macdLine: number[]; signalLine: number[] } | null {
    if (data.length < longPeriod + signalPeriod) return null;

    const emaShort = calculateEMA(data, shortPeriod);
    const emaLong = calculateEMA(data, longPeriod);

    if (!emaShort || !emaLong) return null;

    // Align arrays (emaShort and emaLong lengths differ)
    const diff = emaLong.length - emaShort.length;
    const macdLine: number[] = [];
    for (let i = 0; i < emaLong.length; i++) {
        const shortVal = emaShort[i - diff] ?? 0;
        macdLine.push(shortVal - emaLong[i]);
    }

    // Calculate signal line as EMA of macdLine
    const signalLine = calculateEMA(macdLine, signalPeriod);
    if (!signalLine) return null;

    return { macdLine, signalLine };
}

// ATR - Average True Range
export function calculateATR(candles: Candle[], period = 14): number | null {
    if (candles.length < period + 1) return null;

    const trs: number[] = [];
    for (let i = candles.length - period; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i - 1];

        const highLow = current.high - current.low;
        const highClose = Math.abs(current.high - prev.close);
        const lowClose = Math.abs(current.low - prev.close);

        const tr = Math.max(highLow, highClose, lowClose);
        trs.push(tr);
    }
    const atr = trs.reduce((a, b) => a + b, 0) / period;
    return atr;
}

// Bullish Engulfing pattern simple detection
export function isBullishEngulfing(candles: Candle[]): boolean {
    if (candles.length < 2) return false;
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];

    const prevBear = prev.close < prev.open;
    const currBull = curr.close > curr.open;

    const engulfing =
        currBull &&
        prevBear &&
        curr.open < prev.close &&
        curr.close > prev.open;

    return engulfing;
}
