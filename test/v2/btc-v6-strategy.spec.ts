import { Candle } from '../../src/v2/domain/model';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { BTC_V6_REVISION } from '../../src/v2/strategy/btc-v6.config';
import { BtcV6Strategy } from '../../src/v2/strategy/btc-v6.strategy';
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

  const smallerBreakout = (): MarketHistory => {
    const bars = minutes.map(bar => ({ ...bar, high: resistance - 85 }));
    // A high 30 minutes ago blocks V6.1, but is outside the new 20-minute window.
    bars[bars.length - 31].high = resistance + 50;
    Object.assign(bars.at(-1)!, { open: resistance - 100, low: resistance - 105,
      close: resistance - 70, high: resistance - 65, volume: 40 });
    return { ...history, '1m': bars };
  };

  it('accepts a smaller impulse through recent resistance that V6.1 rejected', () => {
    const strategy = new BtcV6Strategy(), candidate = smallerBreakout();
    const current = strategy.assess(candidate, strategyConfiguration('btc-v6'));
    expect(current.decision).toBe('BUY');
    expect(current.features!.impulseAtr).toBeCloseTo(0.6);
    expect(current.features!.breakoutDistanceAtr).toBeCloseTo(0.3);
    const old = strategy.assess(candidate, strategyConfiguration('btc-v6', {
      btcV6: { ...strategyConfiguration('btc-v6').btcV6!,
        resistanceMinutes: 45, breakoutAtr: 0.5, minImpulseAtr: 1 },
    }));
    expect(old.conditions.shortBreakout).toBe(false);
    expect(old.conditions.cryptoImpulse).toBe(false);
    expect(old.decision).toBe('NO_TRADE');
  });

  it('still rejects a smaller breakout with insufficient volume', () => {
    const candidate = smallerBreakout();
    candidate['1m'].at(-1)!.volume = 10;
    const assessment = new BtcV6Strategy().assess(candidate, strategyConfiguration('btc-v6'));
    expect(assessment.conditions.shortBreakout).toBe(true);
    expect(assessment.conditions.cryptoImpulse).toBe(true);
    expect(assessment.conditions.relativeVolume).toBe(false);
    expect(assessment.decision).toBe('NO_TRADE');
  });

  it('allows a rising EMA9 below EMA21 after a decline', () => {
    const declining = fives.map((bar, index) => {
      const close = 60000 - index * 8;
      return { ...bar, open: close - 2, high: close + 25, low: close - 25, close };
    });
    const close = declining.at(-2)!.close + 45;
    Object.assign(declining.at(-1)!, { open: close - 2, high: close + 25, low: close - 25, close });
    const assessment = new BtcV6Strategy().assess({ ...history, '5m': declining }, strategyConfiguration('btc-v6'));
    expect(assessment.features!.ema5mFast).toBeLessThan(assessment.features!.ema5mSlow as number);
    expect(assessment.features!.ema5mFastSlope).toBeGreaterThan(0);
    expect(assessment.conditions.fastTrend).toBe(true);
    expect(assessment.decision).toBe('BUY');
  });

  it('rejects a falling EMA9 even while it remains above EMA21', () => {
    const turning = fives.map(bar => ({ ...bar }));
    const close = turning.at(-2)!.close - 54;
    Object.assign(turning.at(-1)!, { open: close + 2, high: close + 25, low: close - 25, close });
    const assessment = new BtcV6Strategy().assess({ ...history, '5m': turning }, strategyConfiguration('btc-v6'));
    expect(assessment.features!.ema5mFast).toBeGreaterThan(assessment.features!.ema5mSlow as number);
    expect(assessment.features!.ema5mFastSlope).toBeLessThan(0);
    expect(assessment.conditions.fastTrend).toBe(false);
    expect(assessment.decision).toBe('NO_TRADE');
  });

  it('rejects a flat EMA9', () => {
    const flat = fives.map(bar => ({ ...bar, open: 60000, high: 60025, low: 59975, close: 60000 }));
    const assessment = new BtcV6Strategy().assess({ ...history, '5m': flat }, strategyConfiguration('btc-v6'));
    expect(assessment.features!.ema5mFastSlope).toBe(0);
    expect(assessment.conditions.fastTrend).toBe(false);
    expect(assessment.decision).toBe('NO_TRADE');
  });

  it('ignores the current five-minute candle when checking EMA direction', () => {
    const strategy = new BtcV6Strategy(), config = strategyConfiguration('btc-v6');
    const current = { ...fives.at(-1)!, openTime: liveOpen, closeTime: liveOpen + fiveStep - 1,
      open: 60000, high: 60000, low: 10000, close: 10000 };
    expect(strategy.assess({ ...history, '5m': [...fives, current] }, config))
      .toEqual(strategy.assess(history, config));
  });
});
