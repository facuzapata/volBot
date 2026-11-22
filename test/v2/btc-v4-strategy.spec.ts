import { BtcV4Strategy } from '../../src/v2/strategy/btc-v4.strategy';
import { BTC_V4_REVISION, DEFAULT_BTC_V4, v4ParametersHash } from '../../src/v2/strategy/btc-v4.config';
import { strategyConfiguration, revisionFor } from '../../src/v2/strategy/versions';
import { MarketHistory, Technical } from '../../src/v2/strategy/strategy-engine';
import { Candle } from '../../src/v2/domain/model';
import { bar } from './fixtures';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { causalLiquidity } from '../../src/v2/execution/causal-liquidity';

describe('BTC-V4 frozen trend/pullback candidate', () => {
  const end = Date.UTC(2025, 0, 5) - 1;
  const history = (): MarketHistory => {
    const make = (timeframe: '1m' | '5m' | '1h', step: number): Candle[] =>
      Array.from({ length: 100 }, (_, index) => ({
        ...bar(end + 1 - (100 - index) * step, { open: 10020, close: 10040, high: 10100, low: 9900 }),
        timeframe,
        closeTime: end - (99 - index) * step,
      }));
    const result = { '1m': make('1m', 60000), '5m': make('5m', 300000), '1h': make('1h', 3600000) };
    Object.assign(result['1m'][98], { open: 10025, close: 10030, high: 10040 });
    Object.assign(result['1m'][99], { open: 10045, close: 10050, high: 10060 });
    Object.assign(result['5m'][98], { open: 10020, close: 10040, high: 10060 });
    Object.assign(result['5m'][99], { open: 10035, close: 10050, high: 10060 });
    result['5m'].forEach((candle) => (candle.low = 9980));
    return result;
  };
  const read = (bars: Candle[]): Technical => ({
    sma9: 10020,
    sma21: bars.length < 100 ? 9990 : 10000,
    sma50: 9900,
    ema12: 10020,
    ema26: 10000,
    rsi: 50,
    atr: 50,
    bb: { lower: 9900, middle: 10000, upper: 10100 },
    volumeMA: 100,
    macd: 1,
    signal: 0.5,
    histogram: 0.5,
  });

  it('emits an absolutely protected BUY only after trend, pullback and recovery agree', () => {
    const assessment = new BtcV4Strategy(read).assess(history(), strategyConfiguration('btc-v4'));
    expect(assessment.decision).toBe('BUY');
    expect(assessment.signal).toMatchObject({ strategy: 'btc-v4', strategyRevision: BTC_V4_REVISION });
    expect(assessment.signal!.protection!.stopPrice).toBeLessThan(assessment.signal!.referencePrice);
    expect(assessment.signal!.protection!.targetPrice).toBeGreaterThan(assessment.signal!.referencePrice);
    expect(assessment.features!.rewardRisk).toBeGreaterThanOrEqual(DEFAULT_BTC_V4.targetRiskMultiple);
  });

  it('records the failed filter rather than silently ignoring an extended recovery', () => {
    const data = history();
    data['1m'][99].close = 10101;
    data['1m'][99].high = 10102;
    const assessment = new BtcV4Strategy(read).assess(data, strategyConfiguration('btc-v4'));
    expect(assessment.decision).toBe('NO_TRADE');
    expect(assessment.reason).toContain('NO_NOT_EXTENDED');
  });

  it('keeps its revision and executes with the frozen absolute protection', () => {
    expect(revisionFor('btc-v4')).toBe(BTC_V4_REVISION);
    expect(v4ParametersHash({ ...DEFAULT_BTC_V4 })).toHaveLength(64);
    const data = history();
    const signal = new BtcV4Strategy(read).assess(data, strategyConfiguration('btc-v4')).signal!;
    const paper = new PaperExecutionAdapter();
    const state = newAccount('v4-synthetic', 'v4-synthetic');
    state.account.entriesEnabled = true;
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    const budget = causalLiquidity(end + 1, data['1m'].at(-1), 0.001);
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, budget, 'OPEN');
    expect(state.orders[0].status).toBe('FILLED');
    expect(state.positions[0].executionRisk?.accepted).toBe(true);
    expect(state.positions[0].stopLoss).toBe(signal.protection!.stopPrice.toFixed(12));
    expect(Number(state.positions[0].takeProfit)).toBeCloseTo(signal.protection!.targetPrice, 2);
  });
});
