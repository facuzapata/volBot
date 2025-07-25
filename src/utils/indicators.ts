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
    if (!data || data.length < period || period <= 0) return null;

    const slice = data.slice(data.length - period);

    // Verificar que todos los valores sean números válidos
    const validData = slice.filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
    if (validData.length !== slice.length) return null;

    const sum = validData.reduce((acc, val) => acc + val, 0);
    const result = sum / period;

    return isNaN(result) || !isFinite(result) ? null : result;
}

// Relative Strength Index
export function calculateRSI(data: number[], period = 14): number | null {
    if (!data || data.length < period + 1 || period <= 0) return null;

    // Verificar que todos los datos sean válidos
    const validData = data.filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
    if (validData.length !== data.length || validData.length < period + 1) return null;

    let gains = 0;
    let losses = 0;
    for (let i = validData.length - period; i < validData.length; i++) {
        const diff = validData[i] - validData[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }

    if (losses === 0) return 100;
    if (gains === 0) return 0;

    const rs = gains / losses;
    const rsi = 100 - 100 / (1 + rs);

    return isNaN(rsi) || !isFinite(rsi) ? null : rsi;
}

// Exponential Moving Average (public function)
export function calculateEMA(data: number[], period: number): number | null {
    if (!data || data.length < period || period <= 0) return null;

    // Verificar que todos los datos sean válidos
    const validData = data.filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
    if (validData.length !== data.length || validData.length < period) return null;

    const k = 2 / (period + 1);
    let ema = calculateSMA(validData.slice(0, period), period);
    if (ema === null) return null;

    for (let i = period; i < validData.length; i++) {
        ema = validData[i] * k + ema * (1 - k);
        if (isNaN(ema) || !isFinite(ema)) return null;
    }

    return ema;
}

// Exponential Moving Average array (internal function for MACD)
function calculateEMAArray(data: number[], period: number): number[] | null {
    if (!data || data.length < period || period <= 0) return null;

    // Verificar que todos los datos sean válidos
    const validData = data.filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
    if (validData.length !== data.length || validData.length < period) return null;

    const k = 2 / (period + 1);
    const ema: number[] = [];

    // First EMA = SMA of first period
    let prevEma = calculateSMA(validData.slice(0, period), period);
    if (prevEma === null) return null;
    ema.push(prevEma);

    for (let i = period; i < validData.length; i++) {
        const currentEma = validData[i] * k + prevEma! * (1 - k);
        if (isNaN(currentEma) || !isFinite(currentEma)) return null;
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
): { macdLine: number[]; signalLine: number[]; histogram: number[] } | null {
    if (data.length < longPeriod + signalPeriod) return null;

    const emaShort = calculateEMAArray(data, shortPeriod);
    const emaLong = calculateEMAArray(data, longPeriod);

    if (!emaShort || !emaLong) return null;

    // Align arrays (emaShort and emaLong lengths differ)
    const diff = emaShort.length - emaLong.length;
    const macdLine: number[] = [];
    for (let i = 0; i < emaLong.length; i++) {
        const shortVal = emaShort[i + diff] ?? 0;
        macdLine.push(shortVal - emaLong[i]);
    }

    // Calculate signal line as EMA of macdLine
    const signalLine = calculateEMAArray(macdLine, signalPeriod);
    if (!signalLine) return null;

    // Calculate histogram
    const histogram: number[] = [];
    const minLength = Math.min(macdLine.length, signalLine.length);
    for (let i = 0; i < minLength; i++) {
        histogram.push(macdLine[macdLine.length - minLength + i] - signalLine[i]);
    }

    return { macdLine, signalLine, histogram };
}

// ATR - Average True Range
export function calculateATR(candles: Candle[], period = 14): number | null {
    console.log(`[ATR] Input: candles.length=${candles?.length}, period=${period}`);

    // Necesitamos al menos period + 1 velas para calcular ATR correctamente
    if (!candles || candles.length < period + 1 || period <= 0) {
        console.log(`[ATR] FAILED: Insufficient data. candles.length=${candles?.length}, required=${period + 1}`);
        return null;
    }

    const trs: number[] = [];

    // Calcular TR para las últimas 'period' velas, pero necesitamos vela anterior para cada una
    for (let i = candles.length - period; i < candles.length; i++) {
        // Asegurarse de que tenemos la vela anterior
        if (i <= 0) {
            console.log(`[ATR] Skipping index ${i} (no previous candle)`);
            continue;
        }

        const current = candles[i];
        const prev = candles[i - 1];

        // Validar que las velas existen y tienen datos válidos
        if (!current || !prev ||
            typeof current.high !== 'number' || typeof current.low !== 'number' ||
            typeof current.close !== 'number' || typeof prev.close !== 'number' ||
            isNaN(current.high) || isNaN(current.low) || isNaN(current.close) || isNaN(prev.close)) {
            console.log(`[ATR] Invalid candle data at index ${i}:`, { current, prev });
            continue;
        }

        const highLow = current.high - current.low;
        const highClose = Math.abs(current.high - prev.close);
        const lowClose = Math.abs(current.low - prev.close);

        const tr = Math.max(highLow, highClose, lowClose);
        console.log(`[ATR] Index ${i}: TR=${tr.toFixed(4)} (HL=${highLow.toFixed(4)}, HC=${highClose.toFixed(4)}, LC=${lowClose.toFixed(4)})`);

        // Verificar que el TR sea un número válido y positivo
        if (!isNaN(tr) && isFinite(tr) && tr >= 0) {
            trs.push(tr);
        } else {
            console.log(`[ATR] Invalid TR at index ${i}: ${tr}`);
        }
    }

    console.log(`[ATR] Collected ${trs.length} TR values, required minimum: ${Math.max(1, period / 2)}`);

    // Necesitamos al menos period/2 valores válidos para calcular ATR
    if (trs.length < Math.max(1, period / 2)) {
        console.log(`[ATR] FAILED: Not enough valid TR values`);
        return null;
    }

    const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
    console.log(`[ATR] SUCCESS: ATR=${atr.toFixed(4)}`);
    return isNaN(atr) || !isFinite(atr) || atr <= 0 ? null : atr;
}

// Bollinger Bands
export function calculateBollingerBands(
    data: number[],
    period = 20,
    multiplier = 2
): { upper: number; middle: number; lower: number } | null {
    if (!data || data.length < period || period <= 0) return null;

    // Verificar que todos los datos sean válidos
    const validData = data.filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
    if (validData.length !== data.length || validData.length < period) return null;

    const middle = calculateSMA(validData, period);
    if (middle === null) return null;

    const slice = validData.slice(validData.length - period);
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    if (isNaN(stdDev) || !isFinite(stdDev)) return null;

    const upper = middle + stdDev * multiplier;
    const lower = middle - stdDev * multiplier;

    if (isNaN(upper) || isNaN(lower) || !isFinite(upper) || !isFinite(lower)) return null;

    return {
        upper,
        middle,
        lower
    };
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

// Bearish Engulfing pattern detection
export function isBearishEngulfing(candles: Candle[]): boolean {
    if (candles.length < 2) return false;
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];

    const prevBull = prev.close > prev.open;
    const currBear = curr.close < curr.open;

    const engulfing =
        currBear &&
        prevBull &&
        curr.open > prev.close &&
        curr.close < prev.open;

    return engulfing;
}
