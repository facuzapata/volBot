import { DEFAULT_SIMULATION, Candle, MarketSignal } from '../../src/v2/domain/model';
export const signal = (id = 's1', time = 1735689659999): MarketSignal => ({
  id,
  strategy: 'btc-v2',
  strategyRevision: 'test',
  symbol: 'BTCUSDT',
  candleTime: time,
  referencePrice: 100000,
  atr: 200,
  swingLow: 99600,
  regime: 'up',
  conditions: { test: true },
  config: { ...DEFAULT_SIMULATION, spreadBps: 0, slippageBps: 0 },
});
export const bar = (openTime = 1735689660000, overrides: Partial<Candle> = {}): Candle => ({
  symbol: 'BTCUSDT',
  timeframe: '1m',
  openTime,
  closeTime: openTime + 59999,
  open: 100000,
  high: 100100,
  low: 99900,
  close: 100000,
  volume: 100,
  ...overrides,
});
