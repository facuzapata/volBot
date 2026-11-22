import { Candle } from '../../src/v2/domain/model';
import { MarketHistory } from '../../src/v2/strategy/strategy-engine';

export const V5_FIXTURE_END = Date.UTC(2025, 0, 5) - 1;
export function v5FifteenHistory(): MarketHistory {
  const series = (
    timeframe: '1m' | '5m' | '1h',
    step: number,
    count: number,
    increment: number,
    high: number,
    low: number,
  ): Candle[] =>
    Array.from({ length: count }, (_, i) => {
      const closeTime = V5_FIXTURE_END - (count - 1 - i) * step,
        close = 10000 - (count - 1 - i) * increment;
      return {
        symbol: 'BTCUSDT',
        timeframe,
        closeTime,
        openTime: closeTime - step + 1,
        open: close - 0.2,
        high: close + high,
        low: close - low,
        close,
        volume: 100,
      };
    });
  const data: MarketHistory = {
    '1m': series('1m', 60000, 100, 0.1, 0.02, 0.5),
    '5m': series('5m', 300000, 320, 0.3, 2, 4),
    '1h': series('1h', 3600000, 100, 5, 2, 6),
  };
  data['5m'].slice(-21, -1).forEach((bar, i) => {
    const close = i === 19 ? 9995 : 10000 + (i <= 10 ? i : 20 - i) * 14;
    Object.assign(bar, { close, open: close - 0.2, high: close + 2, low: close - 4 });
  });
  data['5m'].at(-1)!.low = 9980;
  return data;
}
