import * as indicators from '../../src/utils/indicators';
import { StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { bar } from './fixtures';
import { alignedHistory } from '../../src/v2/trading/trading.services';

describe('Extracted legacy-v1 technical behavior', () => {
  it('preserves the original seven conditions and five-of-seven threshold', () => {
    const engine = new StrategyEngine();
    let emitted = 0;
    for (let phase = 0; phase < 20; phase++) {
      const bars = Array.from({ length: 100 }, (_, i) => {
        const close = 100000 + i * 3 + Math.sin((i + phase) / 3) * 80;
        return bar(1735689600000 + i * 60000, {
          open: close - 5,
          high: close + 20,
          low: close - 20,
          close,
          volume: i === 99 ? 200 : 100,
        });
      });
      const closes = bars.map((c) => c.close);
      const last = bars[99];
      const sma9 = indicators.calculateSMA(closes, 9)!;
      const sma21 = indicators.calculateSMA(closes, 21)!;
      const sma50 = indicators.calculateSMA(closes, 50)!;
      const ema12 = indicators.calculateEMA(closes, 12)!;
      const ema26 = indicators.calculateEMA(closes, 26)!;
      const m = indicators.calculateMACD(closes)!;
      const macd = m.macdLine.slice(-1)[0];
      const sig = m.signalLine.slice(-1)[0];
      const rsi = indicators.calculateRSI(closes)!;
      const bb = indicators.calculateBollingerBands(closes)!;
      const volumeMA = indicators.calculateSMA(bars.map((c) => c.volume), 10)!;
      const up = sma9 > sma21 && sma21 > sma50 && ema12 > ema26;
      const down = sma9 < sma21 && sma21 < sma50 && ema12 < ema26;
      const original = [
        up || (!up && !down && macd > sig),
        rsi >= 25 && rsi <= 65,
        macd > sig || m.histogram.slice(-1)[0] > 0,
        indicators.isBullishEngulfing(bars) || last.close > last.open,
        last.close <= bb.lower * 1.005 || last.close < sma9,
        last.volume > volumeMA * 1.2,
        last.close > sma21 * 0.995,
      ];
      const result = engine.evaluate({ '1m': bars, '5m': [], '1h': [] }, 'legacy-v1');
      expect(!!result).toBe(original.filter(Boolean).length >= 5);
      if (result) {
        emitted++;
        expect(Object.values(result.conditions)).toEqual(original);
      }
    }
    expect(emitted).toBeGreaterThan(0);
  });
  it('does not evaluate btc-v2 without closed higher-timeframe history', () => {
    const bars = Array.from({ length: 100 }, (_, i) => bar(1735689600000 + i * 60000));
    expect(new StrategyEngine().evaluate({ '1m': bars, '5m': [], '1h': [] }, 'btc-v2')).toBeNull();
  });
  it('records the BTC-V2 conditions that prevented a signal', () => {
    const engine = new StrategyEngine();
    const oneStart = 1735689600000;
    const one = Array.from({ length: 100 }, (_, i) => bar(oneStart + i * 60000, { volume: 100 }));
    const end = one.at(-1)!.closeTime;
    const five = Array.from({ length: 100 }, (_, i) => ({ ...bar(end - 59999 - (99 - i) * 300000, { volume: 100 }), timeframe: '5m' as const }));
    const hour = Array.from({ length: 100 }, (_, i) => ({ ...bar(end - 59999 - (99 - i) * 3600000, { volume: 100 }), timeframe: '1h' as const }));
    expect(engine.evaluate({ '1m': one, '5m': five, '1h': hour }, 'btc-v2')).toBeNull();
    expect(engine.lastAssessment).toMatchObject({ eligible: false });
    expect(engine.lastAssessment?.reason).toContain('NO_PRIMARY_TREND');
    expect(engine.lastAssessment?.conditions).toHaveProperty('volume', false);
  });
  it('waits for the simultaneous higher-timeframe close rather than using arrival order', () => {
    const hourClose = 1735693199999;
    const minute = bar(hourClose - 59999);
    const five = { ...bar(hourClose - 299999), timeframe: '5m' as const, closeTime: hourClose };
    const hour = { ...bar(hourClose - 3599999), timeframe: '1h' as const, closeTime: hourClose };
    expect(alignedHistory({ '1m': [minute], '5m': [five], '1h': [] }, hourClose)).toBe(false);
    expect(alignedHistory({ '1m': [minute], '5m': [five], '1h': [hour] }, hourClose)).toBe(true);
  });
});
