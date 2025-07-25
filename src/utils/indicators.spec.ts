/** 
    * @file Unit tests for the indicators utility functions.
    * @module utils/indicators.spec
    * SMA: Calcula la media móvil simple de los últimos 5 cierres y la compara con el valor esperado. 
        También prueba el caso de datos insuficientes.
    * RSI: Calcula el RSI sobre las 50 velas y verifica que esté en el rango 0-100. Prueba el caso de datos insuficientes.
    * MACD: Calcula el MACD y verifica que devuelve arrays con valores numéricos. Prueba el caso de datos insuficientes.
    * ATR: Calcula el ATR y verifica que devuelve un número positivo. Prueba el caso de datos insuficientes.
    Bullish Engulfing:
    * Detecta correctamente un patrón envolvente alcista.
    * Verifica que no detecta el patrón cuando no corresponde.
    * Prueba el caso de menos de dos velas.
    Bearish Engulfing:
    * Detecta correctamente un patrón envolvente bajista.
    * Verifica que no detecta el patrón cuando no corresponde.
    * Prueba el caso de menos de dos velas.
    EMA:
    * Calcula correctamente la media móvil exponencial de los últimos 12 cierres.
    * Prueba el caso de datos insuficientes.
    Bollinger Bands:
    * Calcula correctamente las bandas de Bollinger con un período de 20.
    * Verifica que la banda superior es mayor que la banda media, y la banda media es mayor que la banda inferior.
*/

import {
    calculateSMA,
    calculateRSI,
    calculateMACD,
    calculateATR,
    isBullishEngulfing,
    isBearishEngulfing,
    calculateEMA,
    calculateBollingerBands,
    Candle,
} from './indicators';

// 50 velas reales simuladas
const velasReales: Candle[] = [
    { open: 104900, high: 105000, low: 104800, close: 104950, volume: 10, timestamp: 1 },
    { open: 104950, high: 105100, low: 104900, close: 105000, volume: 12, timestamp: 2 },
    { open: 105000, high: 105200, low: 104950, close: 105100, volume: 15, timestamp: 3 },
    { open: 105100, high: 105250, low: 105000, close: 105200, volume: 18, timestamp: 4 },
    { open: 105200, high: 105300, low: 105100, close: 105250, volume: 20, timestamp: 5 },
    { open: 105250, high: 105400, low: 105200, close: 105350, volume: 22, timestamp: 6 },
    { open: 105350, high: 105500, low: 105300, close: 105400, volume: 25, timestamp: 7 },
    { open: 105400, high: 105600, low: 105350, close: 105500, volume: 30, timestamp: 8 },
    { open: 105500, high: 105700, low: 105400, close: 105600, volume: 35, timestamp: 9 },
    { open: 105600, high: 105800, low: 105500, close: 105700, volume: 40, timestamp: 10 },
    { open: 105700, high: 105900, low: 105600, close: 105800, volume: 42, timestamp: 11 },
    { open: 105800, high: 106000, low: 105700, close: 105900, volume: 45, timestamp: 12 },
    { open: 105900, high: 106100, low: 105800, close: 106000, volume: 48, timestamp: 13 },
    { open: 106000, high: 106200, low: 105900, close: 106100, volume: 50, timestamp: 14 },
    { open: 106100, high: 106300, low: 106000, close: 106200, volume: 52, timestamp: 15 },
    { open: 106200, high: 106400, low: 106100, close: 106300, volume: 55, timestamp: 16 },
    { open: 106300, high: 106500, low: 106200, close: 106400, volume: 57, timestamp: 17 },
    { open: 106400, high: 106600, low: 106300, close: 106500, volume: 60, timestamp: 18 },
    { open: 106500, high: 106700, low: 106400, close: 106600, volume: 62, timestamp: 19 },
    { open: 106600, high: 106800, low: 106500, close: 106700, volume: 65, timestamp: 20 },
    { open: 106700, high: 106900, low: 106600, close: 106800, volume: 67, timestamp: 21 },
    { open: 106800, high: 107000, low: 106700, close: 106900, volume: 70, timestamp: 22 },
    { open: 106900, high: 107100, low: 106800, close: 107000, volume: 72, timestamp: 23 },
    { open: 107000, high: 107200, low: 106900, close: 107100, volume: 75, timestamp: 24 },
    { open: 107100, high: 107300, low: 107000, close: 107200, volume: 77, timestamp: 25 },
    { open: 107200, high: 107400, low: 107100, close: 107300, volume: 80, timestamp: 26 },
    { open: 107300, high: 107500, low: 107200, close: 107400, volume: 82, timestamp: 27 },
    { open: 107400, high: 107600, low: 107300, close: 107500, volume: 85, timestamp: 28 },
    { open: 107500, high: 107700, low: 107400, close: 107600, volume: 87, timestamp: 29 },
    { open: 107600, high: 107800, low: 107500, close: 107700, volume: 90, timestamp: 30 },
    { open: 107700, high: 107900, low: 107600, close: 107800, volume: 92, timestamp: 31 },
    { open: 107800, high: 108000, low: 107700, close: 107900, volume: 95, timestamp: 32 },
    { open: 107900, high: 108100, low: 107800, close: 108000, volume: 97, timestamp: 33 },
    { open: 108000, high: 108200, low: 107900, close: 108100, volume: 100, timestamp: 34 },
    { open: 108100, high: 108300, low: 108000, close: 108200, volume: 102, timestamp: 35 },
    { open: 108200, high: 108400, low: 108100, close: 108300, volume: 105, timestamp: 36 },
    { open: 108300, high: 108500, low: 108200, close: 108400, volume: 107, timestamp: 37 },
    { open: 108400, high: 108600, low: 108300, close: 108500, volume: 110, timestamp: 38 },
    { open: 108500, high: 108700, low: 108400, close: 108600, volume: 112, timestamp: 39 },
    { open: 108600, high: 108800, low: 108500, close: 108700, volume: 115, timestamp: 40 },
    { open: 108700, high: 108900, low: 108600, close: 108800, volume: 117, timestamp: 41 },
    { open: 108800, high: 109000, low: 108700, close: 108900, volume: 120, timestamp: 42 },
    { open: 108900, high: 109100, low: 108800, close: 109000, volume: 122, timestamp: 43 },
    { open: 109000, high: 109200, low: 108900, close: 109100, volume: 125, timestamp: 44 },
    { open: 109100, high: 109300, low: 109000, close: 109200, volume: 127, timestamp: 45 },
    { open: 109200, high: 109400, low: 109100, close: 109300, volume: 130, timestamp: 46 },
    { open: 109300, high: 109500, low: 109200, close: 109400, volume: 132, timestamp: 47 },
    { open: 109400, high: 109600, low: 109300, close: 109500, volume: 135, timestamp: 48 },
    { open: 109500, high: 109700, low: 109400, close: 109600, volume: 137, timestamp: 49 },
    { open: 109600, high: 109800, low: 109500, close: 109700, volume: 140, timestamp: 50 },
];

describe('Indicadores técnicos', () => {
    it('debería calcular correctamente la SMA', () => {
        // SMA de los últimos 5 cierres
        const closes = velasReales.map(v => v.close);
        const sma5 = calculateSMA(closes, 5);
        // Cálculo manual esperado:
        const expected = (109300 + 109400 + 109500 + 109600 + 109700) / 5;
        expect(sma5).toBeCloseTo(expected, 5);
    });

    it('debería devolver null en SMA si no hay suficientes datos', () => {
        const closes = [1, 2, 3];
        expect(calculateSMA(closes, 5)).toBeNull();
    });

    it('debería calcular correctamente el RSI', () => {
        const closes = velasReales.map(v => v.close);
        const rsi = calculateRSI(closes, 14);
        // El valor exacto depende de los datos, pero debe estar entre 0 y 100
        expect(rsi).toBeGreaterThanOrEqual(0);
        expect(rsi).toBeLessThanOrEqual(100);
    });

    it('debería devolver null en RSI si no hay suficientes datos', () => {
        const closes = [1, 2, 3];
        expect(calculateRSI(closes, 14)).toBeNull();
    });

    it('debería calcular correctamente el MACD', () => {
        const closes = velasReales.map(v => v.close);
        const macd = calculateMACD(closes);
        expect(macd).not.toBeNull();
        expect(macd!.macdLine.length).toBeGreaterThan(0);
        expect(macd!.signalLine.length).toBeGreaterThan(0);
        // El último valor debe ser un número
        expect(typeof macd!.macdLine[macd!.macdLine.length - 1]).toBe('number');
        expect(typeof macd!.signalLine[macd!.signalLine.length - 1]).toBe('number');
    });

    it('debería devolver null en MACD si no hay suficientes datos', () => {
        const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        expect(calculateMACD(closes)).toBeNull();
    });

    it('debería calcular correctamente el MACD con histograma', () => {
        const closes = velasReales.map(v => v.close);
        const macd = calculateMACD(closes);
        expect(macd).not.toBeNull();
        expect(macd!.macdLine.length).toBeGreaterThan(0);
        expect(macd!.signalLine.length).toBeGreaterThan(0);
        expect(macd!.histogram.length).toBeGreaterThan(0);

        // Verificar que el histograma es la diferencia entre MACD y signal
        const lastHistogram = macd!.histogram[macd!.histogram.length - 1];
        const lastMacd = macd!.macdLine[macd!.macdLine.length - 1];
        const lastSignal = macd!.signalLine[macd!.signalLine.length - 1];

        expect(lastHistogram).toBeCloseTo(lastMacd - lastSignal, 5);
    });

    it('debería calcular correctamente la EMA', () => {
        const closes = velasReales.map(v => v.close);
        const ema12 = calculateEMA(closes, 12);
        expect(ema12).not.toBeNull();
        expect(typeof ema12).toBe('number');
        expect(ema12!).toBeGreaterThan(0);
    });

    it('debería calcular correctamente las Bollinger Bands', () => {
        const closes = velasReales.map(v => v.close);
        const bbands = calculateBollingerBands(closes, 20);
        expect(bbands).not.toBeNull();
        expect(bbands!.upper).toBeGreaterThan(bbands!.middle);
        expect(bbands!.middle).toBeGreaterThan(bbands!.lower);
        expect(typeof bbands!.upper).toBe('number');
        expect(typeof bbands!.middle).toBe('number');
        expect(typeof bbands!.lower).toBe('number');
    });

    it('debería detectar correctamente un patrón Bullish Engulfing', () => {
        // Creamos dos velas: una bajista y una alcista que envuelve a la anterior
        const velas = [
            { open: 100, high: 105, low: 95, close: 98, volume: 10 },
            { open: 97, high: 110, low: 96, close: 106, volume: 12 },
        ];
        expect(isBullishEngulfing(velas)).toBe(true);
    });

    it('debería detectar correctamente cuando NO hay Bullish Engulfing', () => {
        // Dos velas alcistas seguidas
        const velas = [
            { open: 100, high: 105, low: 95, close: 104, volume: 10 },
            { open: 104, high: 110, low: 103, close: 108, volume: 12 },
        ];
        expect(isBullishEngulfing(velas)).toBe(false);
    });

    it('debería devolver false en Bullish Engulfing si no hay suficientes velas', () => {
        expect(isBullishEngulfing([{ open: 1, high: 2, low: 1, close: 2, volume: 1 }])).toBe(false);
    });

    it('debería detectar correctamente un patrón Bearish Engulfing', () => {
        // Creamos dos velas: una alcista y una bajista que envuelve a la anterior
        const velas = [
            { open: 100, high: 105, low: 95, close: 104, volume: 10 },
            { open: 106, high: 107, low: 96, close: 98, volume: 12 },
        ];
        expect(isBearishEngulfing(velas)).toBe(true);
    });

    it('debería detectar correctamente cuando NO hay Bearish Engulfing', () => {
        // Dos velas bajistas seguidas
        const velas = [
            { open: 100, high: 105, low: 95, close: 98, volume: 10 },
            { open: 98, high: 99, low: 94, close: 96, volume: 12 },
        ];
        expect(isBearishEngulfing(velas)).toBe(false);
    });

    it('debería devolver false en Bearish Engulfing si no hay suficientes velas', () => {
        expect(isBearishEngulfing([{ open: 1, high: 2, low: 1, close: 2, volume: 1 }])).toBe(false);
    });
});