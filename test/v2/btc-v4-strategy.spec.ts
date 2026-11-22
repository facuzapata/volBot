import { BtcV4Strategy } from '../../src/v2/strategy/btc-v4.strategy';
import { BTC_V4_REVISION, DEFAULT_BTC_V4, v4ParametersHash } from '../../src/v2/strategy/btc-v4.config';
import { strategyConfiguration, revisionFor } from '../../src/v2/strategy/versions';
import { MarketHistory } from '../../src/v2/strategy/strategy-engine';
import { Candle } from '../../src/v2/domain/model';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { causalLiquidity } from '../../src/v2/execution/causal-liquidity';

describe('BTC-V4 4h trend/pullback candidate', () => {
  const end = Date.UTC(2025, 0, 5) - 1;
  const candles = (timeframe: '1m' | '5m' | '1h', step: number, count: number): Candle[] =>
    Array.from({ length: count }, (_, index) => {
      const closeTime = end - (count - 1 - index) * step;
      const close = 10000 + index * 10;
      return {
        symbol: 'BTCUSDT', timeframe, closeTime, openTime: closeTime - step + 1,
        open: close - 5, high: close + 4, low: close - 8, close, volume: 100,
      };
    });
  const history = (): MarketHistory => {
    const result: MarketHistory = { '1m': candles('1m', 60000, 100), '5m': candles('5m', 300000, 100), '1h': candles('1h', 3600000, 300) };
    // A completed 4h bar that briefly touches EMA20 then closes bullishly back above it.
    result['1h'].slice(-8).forEach((bar) => { bar.low = 12500; });
    return result;
  };

  it('emits a BUY only for a completed 4h trend pullback recovery', () => {
    const assessment = new BtcV4Strategy().assess(history(), strategyConfiguration('btc-v4'));
    expect(assessment.decision).toBe('BUY');
    expect(assessment.signal).toMatchObject({ strategy: 'btc-v4', strategyRevision: BTC_V4_REVISION });
    expect(assessment.signal!.protection!.timeframe).toBe('4h');
    expect(assessment.signal!.protection!.stopPrice).toBeLessThan(assessment.signal!.referencePrice);
    expect(assessment.signal!.protection!.targetPrice).toBeGreaterThan(assessment.signal!.referencePrice);
  });

  it('does not evaluate an incomplete 4h bar', () => {
    const data = history();
    data['1m'][99].closeTime -= 60000;
    expect(new BtcV4Strategy().assess(data, strategyConfiguration('btc-v4')).reason).toBe('WAITING_FOR_4H_CLOSE');
  });

  it('keeps its revision and executes its absolute 4h protection', () => {
    expect(revisionFor('btc-v4')).toBe(BTC_V4_REVISION);
    expect(v4ParametersHash({ ...DEFAULT_BTC_V4 })).toHaveLength(64);
    const data = history();
    const signal = new BtcV4Strategy().assess(data, strategyConfiguration('btc-v4')).signal!;
    const paper = new PaperExecutionAdapter();
    const state = newAccount('v4-synthetic', 'v4-synthetic');
    state.account.entriesEnabled = true;
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    const budget = causalLiquidity(end + 1, data['1m'].at(-1), 0.001);
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, budget, 'OPEN');
    expect(state.orders[0].status).toBe('FILLED');
    expect(state.positions[0].executionRisk?.accepted).toBe(true);
    expect(Number(state.positions[0].stopLoss)).toBeCloseTo(signal.protection!.stopPrice, 2);
    expect(Number(state.positions[0].takeProfit)).toBeCloseTo(signal.protection!.targetPrice, 2);
  });
});
