import { Candle } from '../../src/v2/domain/model';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { BTC_V6_REVISION } from '../../src/v2/strategy/btc-v6.config';
import { MarketHistory, StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { strategyConfiguration } from '../../src/v2/strategy/versions';

describe('BTC-V6 aggressive PAPER momentum', () => {
  const fiveStep = 300000, minuteStep = 60000, base = Date.UTC(2026, 9, 1);
  const fives: Candle[] = Array.from({ length: 100 }, (_, index) => {
    const openTime = base + index * fiveStep, close = 60000 + index * 8;
    return { symbol: 'BTCUSDT', timeframe: '5m', openTime, closeTime: openTime + fiveStep - 1,
      open: close - 2, high: close + 25, low: close - 25, close, volume: 10 };
  });
  const liveOpen = fives.at(-1)!.closeTime + 1;
  const resistance = fives.at(-1)!.close + 40;
  const minutes: Candle[] = Array.from({ length: 100 }, (_, index) => {
    const openTime = liveOpen - (99 - index) * minuteStep, close = resistance - 100;
    return { symbol: 'BTCUSDT', timeframe: '1m', openTime, closeTime: openTime + minuteStep - 1,
      open: close, high: close + 5, low: close - 5, close, volume: 10 };
  });
  Object.assign(minutes.at(-1)!, { open: resistance - 100, low: resistance - 105,
    close: resistance + 20, high: resistance + 25, volume: 40 });
  const history: MarketHistory = { '1m': minutes, '5m': fives, '1h': [] };

  it('buys the same closed minute instead of waiting for confirmation', () => {
    const signal = new StrategyEngine().evaluate(history, 'btc-v6', strategyConfiguration('btc-v6'));
    expect(signal).toMatchObject({ strategy: 'btc-v6', strategyRevision: BTC_V6_REVISION,
      protection: { exitMode: 'TARGET_ONLY', stopPrice: 0, horizonMs: 0 } });
    expect(signal!.conditions).toMatchObject({ fastTrend: true, shortBreakout: true,
      cryptoImpulse: true, relativeVolume: true });
  });

  it('uses the account ticket without a V6 internal cap', () => {
    const signal = new StrategyEngine().evaluate(history, 'btc-v6', strategyConfiguration('btc-v6'))!;
    const state = newAccount('v6', 'v6', 500, 3, 30);
    state.account.entriesEnabled = true;
    expect(new PaperExecutionAdapter().reserve(state, signal, signal.candleTime).accepted).toBe(true);
    expect(Number(state.orders[0].reservedQuote)).toBe(30);
  });
});
