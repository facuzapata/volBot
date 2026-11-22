import { BtcV5Strategy, validV5Parameters } from '../../src/v2/strategy/btc-v5.strategy';
import { BTC_V5_REVISION, DEFAULT_BTC_V5 } from '../../src/v2/strategy/btc-v5.config';
import { strategyConfiguration, revisionFor } from '../../src/v2/strategy/versions';
import { Candle, DEFAULT_SIMULATION, Position, SimulationConfig } from '../../src/v2/domain/model';
import { MarketHistory, StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { RiskPolicy } from '../../src/v2/risk/risk-policy';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { simulationConfig } from '../../src/v2/config';

const protectedConfig = (overrides: Partial<SimulationConfig> = {}) =>
  strategyConfiguration('btc-v5', {
    ...overrides,
    btcV5: { ...DEFAULT_BTC_V5, ...overrides.btcV5, exitMode: 'STOP_TARGET', trendMinutes: 60 },
  });

describe('BTC-V5 intraday PAPER candidate', () => {
  const end = Date.UTC(2025, 0, 5) - 1;
  const series = (
    timeframe: '1m' | '5m' | '1h',
    step: number,
    count: number,
    increment: number,
    high: number,
    low: number,
  ): Candle[] =>
    Array.from({ length: count }, (_, index) => {
      const closeTime = end - (count - 1 - index) * step;
      const close = 10000 - (count - 1 - index) * increment;
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
  const history = (): MarketHistory => {
    const data: MarketHistory = {
      '1m': series('1m', 60000, 100, 0.1, 0.02, 0.5),
      '5m': series('5m', 300000, 100, 0.3, 2, 4),
      '1h': series('1h', 3600000, 100, 5, 2, 6),
    };
    data['5m'].slice(-21, -1).forEach((bar, index) => {
      const close = index === 19 ? 9995 : 10000 + (index <= 10 ? index : 20 - index) * 14;
      Object.assign(bar, { close, open: close - 0.2, high: close + 2, low: close - 4 });
    });
    data['5m'].at(-1)!.low = 9980;
    return data;
  };
  const assessment = () => new BtcV5Strategy().assess(history(), protectedConfig());
  const closedLoss = (at: number, reason = 'STOP_LOSS'): Position => ({
    id: `closed-${at}`,
    accountId: 'v5',
    signalId: `signal-${at}`,
    strategy: 'btc-v5',
    executionMode: 'PAPER',
    regime: 'up',
    status: 'CLOSED',
    quantity: '0',
    entryQuantity: '0',
    entryQuote: '0',
    entryFees: '0',
    remainingCost: '0',
    averageEntry: '0',
    realizedPnl: '-0.1',
    stopLoss: '1',
    takeProfit: '2',
    highWater: '1',
    atr: '1',
    stopDistance: 0.002,
    targetDistance: 0.009,
    openedAt: at - 60000,
    closedAt: at,
    exitReason: reason,
    config: protectedConfig(),
  });
  const account = () => {
    const state = newAccount('v5', 'v5');
    state.account.entriesEnabled = true;
    return state;
  };

  it('emits a 1m entry with a small cost-adjusted target and 5m protection', () => {
    const a = assessment();
    expect(a.decision).toBe('BUY');
    expect(a.signal).toMatchObject({ strategy: 'btc-v5', strategyRevision: BTC_V5_REVISION });
    expect(a.signal!.protection).toMatchObject({ timeframe: '5m', horizonMs: 360 * 60000 });
    expect(a.features!.netRewardRisk).toBeGreaterThanOrEqual(1.25);
    expect(a.features!.netTargetFraction).toBeGreaterThanOrEqual(0.002);
    expect(a.features!.targetPrice).toBeLessThanOrEqual(a.signal!.referencePrice * 1.012);
  });

  it('reports an up regime using the new hourly filter', () => {
    const engine = new StrategyEngine();
    expect(engine.evaluate(history(), 'btc-v5', protectedConfig())).not.toBeNull();
    expect(engine.lastAssessment?.regime).toBe('up');
  });

  it('rejects bearish hourly context even with a valid minute recovery', () => {
    const data = history();
    data['1h'].reverse().forEach((bar, index) => {
      bar.openTime = end - (99 - index) * 3600000 - 3600000 + 1;
      bar.closeTime = bar.openTime + 3600000 - 1;
    });
    const a = new BtcV5Strategy().assess(data, protectedConfig());
    expect(a.conditions.recovery1m).toBe(true);
    expect(a.reason).toContain('NO_TREND1H');
  });

  it('rejects an absent minute recovery', () => {
    const data = history();
    data['1m'].at(-1)!.open = data['1m'].at(-1)!.close + 0.1;
    expect(new BtcV5Strategy().assess(data, protectedConfig()).conditions.recovery1m).toBe(false);
  });

  it('rejects a minute bounce without a preceding oversold 5m setup', () => {
    const data = history();
    data['5m'].slice(-3).forEach((bar) => {
      bar.low = Math.min(bar.open, bar.close) - 1;
    });
    const a = new BtcV5Strategy().assess(data, protectedConfig());
    expect(a.conditions.recovery1m).toBe(true);
    expect(a.conditions.oversoldReclaim5m).toBe(false);
    expect(a.decision).toBe('NO_TRADE');
  });

  it('waits for the five-minute decline to reverse instead of buying a minute bounce alone', () => {
    const data = history();
    Object.assign(data['5m'].at(-1)!, { close: 9994, open: 9993.8 });
    expect(new BtcV5Strategy().assess(data, protectedConfig()).conditions.oversoldReclaim5m).toBe(
      false,
    );
  });

  it('rejects a narrow historical range without stretching its target to manufacture reward/risk', () => {
    const data = history();
    data['5m'] = series('5m', 300000, 100, 0.3, 2, 4);
    const a = new BtcV5Strategy().assess(data, protectedConfig());
    expect(a.decision).toBe('NO_TRADE');
    expect(a.conditions.targetRoom).toBe(false);
    expect(a.features!.targetPrice).toBeLessThan(a.features!.minimumTargetPrice);
    expect(a.features!.targetPrice).toBeLessThanOrEqual(a.features!.bandUpper);
  });

  it('freezes the target range before the current 5m candle', () => {
    const data = history();
    const before = assessment();
    Object.assign(data['5m'].at(-1)!, { high: 10010, low: 9978 });
    const after = new BtcV5Strategy().assess(data, protectedConfig());
    expect(after.features!.bandUpper).toBe(before.features!.bandUpper);
    expect(after.features!.bandLower).toBe(before.features!.bandLower);
  });

  it('does not chase a recovery once price has already passed the historical mean', () => {
    const data = history();
    Object.assign(data['1m'].at(-1)!, { close: 10100, open: 10099.8, high: 10100.02 });
    const a = new BtcV5Strategy().assess(data, protectedConfig());
    expect(a.conditions.notExtended).toBe(false);
    expect(a.decision).toBe('NO_TRADE');
  });

  it('ignores unfinished future higher-timeframe candles', () => {
    const data = history();
    for (const [tf, step] of [
      ['5m', 300000],
      ['1h', 3600000],
    ] as const) {
      data[tf].push({ ...data[tf].at(-1)!, openTime: end + 1, closeTime: end + step, close: 1 });
    }
    expect(new BtcV5Strategy().assess(data, protectedConfig())).toEqual(assessment());
  });

  it.each(['1m', '5m', '1h'] as const)('rejects missing %s bars', (tf) => {
    const data = history();
    data[tf].splice(-3, 1);
    expect(new BtcV5Strategy().assess(data, protectedConfig()).reason).toBe(
      'MISSING_OR_UNALIGNED_DATA',
    );
  });

  it('rejects stale higher-timeframe data and incomplete candles', () => {
    const stale = history();
    stale['1h'].pop();
    expect(new BtcV5Strategy().assess(stale, protectedConfig()).reason).toBe(
      'MISSING_OR_UNALIGNED_DATA',
    );
    const partial = history();
    partial['5m'].at(-1)!.closeTime -= 1;
    expect(new BtcV5Strategy().assess(partial, protectedConfig()).reason).toBe(
      'MISSING_OR_UNALIGNED_DATA',
    );
  });

  it('rejects a small target when higher fees make it uneconomic', () => {
    const a = new BtcV5Strategy().assess(history(), protectedConfig({ feeRate: 0.003 }));
    expect(a.decision).toBe('NO_TRADE');
    expect(a.conditions.targetRoom).toBe(false);
  });

  it('rejects a wide structural stop', () => {
    const data = history();
    data['5m'].at(-2)!.low = 9900;
    expect(new BtcV5Strategy().assess(data, protectedConfig()).conditions.stopGeometry).toBe(false);
  });

  it('keeps conservative ceilings when generic deployment settings override defaults', () => {
    const c = protectedConfig({
      ...DEFAULT_SIMULATION,
      trailing: true,
      timeExit: false,
    });
    expect(c).toMatchObject({
      maxRiskPerTrade: 0.001,
      dailyLossLimit: 0.005,
      maxExposure: 0.2,
      maxStopPercent: 0.006,
      maxHoldingMs: 21600000,
      trailing: false,
      timeExit: true,
    });
    expect(protectedConfig({ maxRiskPerTrade: 0.0005 }).maxRiskPerTrade).toBe(0.0005);
    expect(revisionFor('btc-v5')).toBe(BTC_V5_REVISION);
    expect(validV5Parameters({ ...DEFAULT_BTC_V5 })).toBe(true);
    expect(validV5Parameters({ ...DEFAULT_BTC_V5, revision: '2026-11-22.v5.2' })).toBe(false);
    expect(validV5Parameters({ ...DEFAULT_BTC_V5, maxDailyEntries: NaN })).toBe(false);
  });

  it('loads the same safe limits through environment configuration', () => {
    const previous = { ...process.env };
    try {
      process.env.V2_STRATEGY = 'btc-v5';
      process.env.TRADING_MODE = 'PAPER';
      process.env.V2_MAX_RISK_PER_TRADE = '0.02';
      expect(simulationConfig()).toMatchObject({
        maxRiskPerTrade: 0.001,
        maxStopPercent: 0.006,
        dailyLossLimit: 0.005,
      });
    } finally {
      process.env = previous;
    }
  });

  it('executes protection and stays within the projected account risk budget', () => {
    const signal = assessment().signal!;
    const state = account();
    const paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, 1, 'OPEN');
    expect(state.orders[0].status).toBe('FILLED');
    const position = state.positions[0];
    expect(position.executionRisk?.accepted).toBe(true);
    expect(Number(position.executionRisk!.estimatedNetStopLoss)).toBeLessThanOrEqual(
      Number(position.executionRisk!.riskLimitQuote),
    );
    expect(Number(position.stopLoss)).toBe(signal.protection!.stopPrice);
    expect(paper.reserve(state, { ...signal, id: 'second' }, end + 2).reason).toBe(
      'MAX_V5_POSITION',
    );
  });

  it('sizes down a large ticket instead of increasing risk', () => {
    const signal = assessment().signal!;
    const state = account();
    state.account.usdtPerTrade = '200';
    const paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    expect(Number(state.orders[0].reservedQuote)).toBeLessThanOrEqual(100);
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, 1, 'OPEN');
    expect(state.positions[0].executionRisk?.accepted).toBe(true);
  });

  it('pauses entries at the daily loss cap', () => {
    const signal = assessment().signal!;
    const state = account();
    state.account.day = new Date(end).toISOString().slice(0, 10);
    state.account.dayStartEquity = '500';
    state.account.dayPnl = '-2.5';
    expect(new RiskPolicy().reserve(state, signal, end).reason).toBe('DAILY_LOSS_LIMIT');
  });

  it('waits between trades and requires quality after a loss', () => {
    const signal = assessment().signal!;
    const state = account();
    state.positions.push(closedLoss(end - 60000));
    const policy = new RiskPolicy();
    expect(policy.reserve(state, signal, end).reason).toBe('V5_ENTRY_COOLDOWN');
    const weak = {
      ...signal,
      id: 'weak',
      candleTime: end + 15 * 60000,
      conditions: { ...signal.conditions, recoveryQuality: false },
    };
    expect(policy.reserve(state, weak, weak.candleTime).reason).toBe(
      'V5_RECOVERY_QUALITY_REQUIRED',
    );
  });

  it('rejects an entry whose projected stop would exceed the remaining daily budget', () => {
    const signal = assessment().signal!;
    const state = account();
    state.account.day = new Date(end).toISOString().slice(0, 10);
    state.account.dayPnl = '-2.4';
    expect(new RiskPolicy().reserve(state, signal, end).reason).toBe('DAILY_LOSS_LIMIT');
  });

  it('rechecks the daily budget between reservation and fill', () => {
    const signal = assessment().signal!;
    const state = account();
    const paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    state.account.dayPnl = '-2.4';
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, 1, 'OPEN');
    expect(state.orders[0].executionRisk?.reason).toBe('EXECUTION_DAILY_LOSS_LIMIT');
    expect(state.positions[0].quantity).toBe('0');
  });

  it('applies the risk ceilings even when the strategy engine receives general defaults', () => {
    const data = history();
    data['5m'] = [...series('5m', 300000, 320, 0.3, 2, 4).slice(0, -100), ...data['5m']];
    const signal = new StrategyEngine().evaluate(data, 'btc-v5')!;
    expect(signal.config.maxRiskPerTrade).toBe(0.001);
    expect(signal.config.maxStopPercent).toBe(0.006);
  });

  it('halts new entries before a projected loss would exceed 2% of starting capital', () => {
    const signal = assessment().signal!;
    const state = account();
    state.account.available = '490.1';
    expect(new RiskPolicy().reserve(state, signal, end).reason).toBe('V5_CAPITAL_LOSS_LIMIT');
    expect(state.orders).toHaveLength(0);
  });

  it('rechecks the capital loss budget at execution', () => {
    const signal = assessment().signal!;
    const state = account();
    const paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    state.account.available = '460.1';
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, 1, 'OPEN');
    expect(state.orders[0].executionRisk?.reason).toBe('V5_CAPITAL_LOSS_LIMIT');
    expect(state.positions[0].quantity).toBe('0');
  });

  it('rejects an adverse opening gap when the target no longer compensates the risk', () => {
    const signal = assessment().signal!;
    const state = account();
    const paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    paper.execute(state, state.orders[0].id, signal.referencePrice * 1.003, end + 1, 1, 'OPEN');
    expect(state.orders[0].executionRisk?.accepted).toBe(false);
    expect(state.positions[0].quantity).toBe('0');
  });

  it('exits a stalled position at six hours even when that realizes a loss', () => {
    const signal = assessment().signal!;
    const state = account();
    const paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, 1, 'OPEN');
    const openTime = end + 1 + 360 * 60000;
    paper.onCandle(
      state,
      { ...history()['1m'].at(-1)!, openTime, closeTime: openTime + 59999 },
      false,
      () => true,
      { barOpenTime: openTime, sourceCloseTime: openTime - 1, capacity: 1, used: 0 },
    );
    expect(state.positions[0].status).toBe('CLOSED');
    expect(state.positions[0].exitReason).toBe('TIME_STOP');
    expect(Number(state.positions[0].realizedPnl)).toBeLessThan(0);
  });

  it('cools down after two losses including time exits, then permits a fresh entry', () => {
    const signal = assessment().signal!;
    const state = account();
    state.positions.push(closedLoss(end - 60000), closedLoss(end, 'TIME_STOP'));
    const policy = new RiskPolicy();
    expect(policy.reserve(state, signal, end).reason).toBe('V5_CONSECUTIVE_STOP_COOLDOWN');
    const fresh = { ...signal, id: 'after-cooldown', candleTime: end + 60 * 60000 };
    expect(policy.reserve(state, fresh, fresh.candleTime).accepted).toBe(true);
    expect(state.orders.at(-1)?.reservedQuote).toBe('30.000000000000');
  });

  it('does not add another cooldown when the strategy was idle for an hour after two losses', () => {
    const signal = assessment().signal!;
    const state = account();
    state.positions.push(closedLoss(end - 61 * 60000), closedLoss(end - 60 * 60000));
    expect(new RiskPolicy().reserve(state, signal, end).accepted).toBe(true);
  });

  it('limits daily entries even when all previous trades won', () => {
    const signal = assessment().signal!;
    const state = account();
    for (let i = 0; i < 6; i++)
      state.positions.push({ ...closedLoss(end - (i + 1) * 30 * 60000), realizedPnl: '0.1' });
    expect(new RiskPolicy().reserve(state, signal, end).reason).toBe('V5_DAILY_ENTRY_LIMIT');
    expect(state.orders).toHaveLength(0);
  });

  it('does not count rejected unfilled attempts as daily entries', () => {
    const signal = assessment().signal!;
    const state = account();
    for (let i = 0; i < 6; i++) {
      state.positions.push({
        ...closedLoss(end - (i + 1) * 30 * 60000),
        status: 'REJECTED',
        closedAt: undefined,
      });
    }
    expect(new RiskPolicy().reserve(state, signal, end).accepted).toBe(true);
  });
});
