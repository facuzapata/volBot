import { Candle } from '../../src/v2/domain/model';
import { BtcV5JumpStrategy } from '../../src/v2/strategy/btc-v5-jump.strategy';
import { BTC_V5_REVISION } from '../../src/v2/strategy/btc-v5.config';
import { MarketHistory, StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { strategyConfiguration } from '../../src/v2/strategy/versions';
import {
  newAccount,
  PaperExecutionAdapter,
} from '../../src/v2/execution/paper-execution.adapter';

describe('BTC-V5.9 confirmed exceptional jump', () => {
  const fiveStep = 5 * 60000;
  const minuteStep = 60000;
  const base = Date.UTC(2026, 0, 1);
  const fives: Candle[] = Array.from({ length: 320 }, (_, index) => {
    const openTime = base + index * fiveStep;
    const close = 60000 + index * 5;
    return {
      symbol: 'BTCUSDT',
      timeframe: '5m',
      openTime,
      closeTime: openTime + fiveStep - 1,
      open: close - 1,
      high: close + 20,
      low: close - 20,
      close,
      volume: 10,
    };
  });
  const firstLiveMinute = fives.at(-1)!.closeTime + 1;
  const confirmationOpen = firstLiveMinute + minuteStep;
  const resistance = fives.at(-1)!.high;
  const minutes: Candle[] = Array.from({ length: 100 }, (_, index) => {
    const openTime = confirmationOpen - (99 - index) * minuteStep;
    const close = resistance - 100;
    return {
      symbol: 'BTCUSDT',
      timeframe: '1m',
      openTime,
      closeTime: openTime + minuteStep - 1,
      open: close,
      high: close + 5,
      low: close - 5,
      close,
      volume: 10,
    };
  });
  Object.assign(minutes.at(-2)!, {
    open: resistance - 100,
    low: resistance - 105,
    close: resistance + 30,
    high: resistance + 35,
    volume: 200,
  });
  Object.assign(minutes.at(-1)!, {
    open: resistance + 30,
    low: resistance + 25,
    close: resistance + 80,
    high: resistance + 85,
    volume: 300,
  });
  const history = (includeConfirmation = true): MarketHistory => ({
    '1m': includeConfirmation ? minutes : minutes.slice(0, -1),
    '5m': fives,
    '1h': [],
  });

  it('waits for continuation instead of buying the first explosive minute', () => {
    const assessment = new BtcV5JumpStrategy().assess(
      history(false),
      strategyConfiguration('btc-v5'),
    );
    expect(assessment.decision).toBe('NO_TRADE');
    expect(assessment.conditions.firstBreakoutCross).toBe(false);
  });

  it('buys the confirmed minute with an executable target-only objective', () => {
    const signal = new StrategyEngine().evaluate(
      history(),
      'btc-v5',
      strategyConfiguration('btc-v5'),
    );
    expect(signal).toMatchObject({
      strategy: 'btc-v5',
      strategyRevision: BTC_V5_REVISION,
      protection: { exitMode: 'TARGET_ONLY', stopPrice: 0, horizonMs: 0 },
    });
    expect(signal!.conditions).toMatchObject({
      firstBreakoutCross: true,
      exceptionalImpulse: true,
      exceptionalVolume: true,
      continuationConfirmation: true,
    });
    expect(signal!.protection!.targetPrice).toBeGreaterThan(signal!.referencePrice);
    expect(signal!.protection!.targetPrice).toBeLessThanOrEqual(signal!.referencePrice * 1.008);
  });

  it('caps PAPER exposure to the validated 10 USDT ticket', () => {
    const signal = new StrategyEngine().evaluate(
      history(),
      'btc-v5',
      strategyConfiguration('btc-v5'),
    )!;
    const state = newAccount('v5.9', 'v5.9', 500, 5, 30);
    state.account.entriesEnabled = true;
    const result = new PaperExecutionAdapter().reserve(state, signal, signal.candleTime);
    expect(result.accepted).toBe(true);
    expect(Number(state.orders[0].reservedQuote)).toBe(10);
  });
});
