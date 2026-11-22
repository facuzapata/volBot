import { BtcV5Strategy } from '../../src/v2/strategy/btc-v5.strategy';
import { DEFAULT_BTC_V5 } from '../../src/v2/strategy/btc-v5.config';
import { strategyConfiguration } from '../../src/v2/strategy/versions';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { isTargetOnlyPosition, Candle, MarketSignal } from '../../src/v2/domain/model';
import { MarketHistory } from '../../src/v2/strategy/strategy-engine';
import { statistics } from '../../src/v2/backtesting/backtesting.engine';

const end = Date.UTC(2025, 0, 5) - 1;
const history = (): MarketHistory => {
  const series = (
    timeframe: '1m' | '5m' | '1h',
    step: number,
    increment: number,
    high: number,
    low: number,
  ): Candle[] =>
    Array.from({ length: 100 }, (_, i) => {
      const closeTime = end - (99 - i) * step,
        close = 10000 - (99 - i) * increment;
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
    '1m': series('1m', 60000, 0.1, 0.02, 0.5),
    '5m': series('5m', 300000, 0.3, 2, 4),
    '1h': series('1h', 3600000, 5, 2, 6),
  };
  data['5m'].slice(-21, -1).forEach((bar, i) => {
    const close = i === 19 ? 9995 : 10000 + (i <= 10 ? i : 20 - i) * 14;
    Object.assign(bar, { close, open: close - 0.2, high: close + 2, low: close - 4 });
  });
  data['5m'].at(-1)!.low = 9980;
  return data;
};
const assessment = (exitMode: 'TARGET_ONLY' | 'STOP_TARGET' = 'TARGET_ONLY') =>
  new BtcV5Strategy().assess(
    history(),
    strategyConfiguration('btc-v5', { btcV5: { ...DEFAULT_BTC_V5, exitMode, trendMinutes: 60 } }),
  );
const account = () => {
  const state = newAccount('target-only', 'target-only');
  state.account.entriesEnabled = true;
  return state;
};
const openPosition = (exitMode: 'TARGET_ONLY' | 'STOP_TARGET' = 'TARGET_ONLY') => {
  const state = account(),
    signal = assessment(exitMode).signal!,
    paper = new PaperExecutionAdapter();
  expect(paper.reserve(state, signal, end).accepted).toBe(true);
  paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, 1, 'OPEN');
  expect(state.orders[0].status).toBe('FILLED');
  return { state, signal, paper };
};
const candle = (openTime: number, price: number, high = price, low = price): Candle => ({
  symbol: 'BTCUSDT',
  timeframe: '1m',
  openTime,
  closeTime: openTime + 59999,
  open: price,
  high,
  low,
  close: price,
  volume: 100,
});

describe('V5 explicit target-only PAPER execution', () => {
  it('emits a real no-stop signal while retaining the reference geometry for entry selection', () => {
    const a = assessment();
    expect(a.decision).toBe('BUY');
    expect(a.signal!.protection).toMatchObject({
      exitMode: 'TARGET_ONLY',
      stopPrice: 0,
      horizonMs: 0,
    });
    expect(a.features).toMatchObject({ stopLossEnabled: false, stopPrice: 0 });
    expect(a.features!.referenceStopPrice).toBeGreaterThan(0);
    expect(a.signal!.config).toMatchObject({
      timeExit: false,
      invalidationExit: false,
      trailing: false,
    });
    expect(a.conditions.referenceGeometry).toBe(true);
  });

  it('snapshots target-only mode and reports the entire ticket as exposed, not a stop-sized loss', () => {
    const { state } = openPosition();
    const p = state.positions[0];
    expect(isTargetOnlyPosition(p)).toBe(true);
    expect(p.plannedStop).toBeUndefined();
    expect(Number(p.stopLoss)).toBe(0);
    expect(p.stopDistance).toBe(0);
    expect(p.executionRisk?.riskModel).toBe('FULL_NOTIONAL');
    expect(Number(p.executionRisk!.estimatedNetStopLoss)).toBeCloseTo(Number(p.remainingCost), 8);
    expect(Number(p.executionRisk!.estimatedNetStopLoss)).toBeGreaterThan(0.5);
    expect(isTargetOnlyPosition(JSON.parse(JSON.stringify(p)))).toBe(true);
  });

  it('keeps a falling position open past six hours and exposes its unrealized loss', () => {
    const { state, paper } = openPosition();
    const quantity = state.positions[0].quantity;
    // Even inconsistent generic flags must not re-enable exits on this snapshotted mode.
    Object.assign(state.positions[0].config, {
      timeExit: true,
      trailing: true,
      invalidationExit: true,
    });
    paper.onCandle(state, candle(end + 1 + 8 * 3600000, 5000), true, () => true);
    expect(state.positions[0].status).toBe('OPEN');
    expect(state.positions[0].quantity).toBe(quantity);
    expect(Number(state.positions[0].stopLoss)).toBe(0);
    expect(state.orders.filter((o) => o.side === 'SELL')).toHaveLength(0);
    const metrics = statistics(state, 5000);
    expect(metrics.netRealizedPnl).toBe(0);
    expect(metrics.unrealizedPnl).toBeLessThan(-10);
    expect(metrics.equity).toBeLessThan(490);
  });

  it('sells at the target after a prior decline, including both commissions', () => {
    const { state, signal, paper } = openPosition();
    paper.onCandle(state, candle(end + 60001, 8000), false, () => true);
    const target = signal.protection!.targetPrice;
    paper.onCandle(state, candle(end + 120001, 10000, target + 1, 5000), false, () => true, {
      barOpenTime: end + 120001,
      sourceCloseTime: end + 120000,
      capacity: 1,
      used: 0,
    });
    const p = state.positions[0];
    expect(p.status).toBe('CLOSED');
    expect(p.exitReason).toBe('TAKE_PROFIT');
    expect(Number(p.realizedPnl)).toBeGreaterThan(0);
    expect(state.fills.filter((f) => f.side === 'SELL')).toHaveLength(1);
    const cashFlow = state.fills.reduce(
      (sum, f) =>
        sum + (f.side === 'BUY' ? -Number(f.quote) : Number(f.quote)) - Number(f.commission),
      0,
    );
    expect(Number(p.realizedPnl)).toBeCloseTo(cashFlow, 8);
    expect(Number(state.fills[0].commission)).toBeGreaterThan(0);
    expect(Number(state.fills[1].commission)).toBeGreaterThan(0);
    const freshAt = p.closedAt! + 15 * 60000;
    expect(
      paper.reserve(state, { ...signal, id: 'next', candleTime: freshAt }, freshAt).accepted,
    ).toBe(true);
    expect(Number(state.orders.at(-1)!.reservedQuote)).toBe(30);
  });

  it('still prevents a second V5 position while the first is occupied', () => {
    const { state, paper, signal } = openPosition();
    expect(paper.reserve(state, { ...signal, id: 'second' }, end + 1).reason).toBe(
      'MAX_V5_POSITION',
    );
  });

  it('caps a large requested ticket by total exposure, not a fictitious stop budget', () => {
    const state = account(),
      signal = assessment().signal!,
      paper = new PaperExecutionAdapter();
    state.account.usdtPerTrade = '200';
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    expect(Number(state.orders[0].reservedQuote)).toBe(100);
    paper.execute(state, state.orders[0].id, signal.referencePrice, end + 1, 1, 'OPEN');
    expect(state.positions[0].executionRisk?.accepted).toBe(true);
  });

  it('rejects a gap that makes the target unprofitable after commissions', () => {
    const state = account(),
      signal = assessment().signal!,
      paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, signal, end).accepted).toBe(true);
    paper.execute(state, state.orders[0].id, 10100, end + 1, 1, 'OPEN');
    expect(state.orders[0].status).toBe('REJECTED');
    expect(state.orders[0].executionRisk?.reason).toBe('TARGET_NOT_ECONOMIC');
    expect(state.fills).toHaveLength(0);
  });

  it('does not enable target-only mode on another strategy or a LIVE account', () => {
    const paper = new PaperExecutionAdapter(),
      signal = assessment().signal!;
    expect(paper.reserve(account(), { ...signal, strategy: 'btc-v4' }, end).reason).toBe(
      'INVALID_EXIT_MODE',
    );
    const live = account();
    live.account.executionMode = 'LIVE';
    expect(paper.reserve(live, signal, end).reason).toBe('INVALID_EXIT_MODE');
  });

  it('does not treat a zero stop without an explicit mode as intentional', () => {
    const signal = assessment().signal!,
      state = account();
    const invalid: MarketSignal = {
      ...signal,
      protection: { ...signal.protection!, exitMode: undefined },
    };
    expect(new PaperExecutionAdapter().reserve(state, invalid, end).accepted).toBe(false);
  });

  it('retains stop exits on protected positions created before the mode change', () => {
    const { state, paper } = openPosition('STOP_TARGET');
    paper.onCandle(state, candle(end + 60001, 5000), false, () => true, {
      barOpenTime: end + 60001,
      sourceCloseTime: end + 60000,
      capacity: 1,
      used: 0,
    });
    expect(state.positions[0].exitReason).toBe('STOP_LOSS');
    expect(Number(state.positions[0].realizedPnl)).toBeLessThan(0);
  });

  it('allows an explicit manual close even when it realizes a loss', () => {
    const { state, paper } = openPosition();
    const exit = paper.requestExit(state, state.positions[0].id, end + 60000, 'MANUAL')!;
    paper.execute(state, exit.id, 5000, end + 60001, 1);
    expect(state.positions[0].exitReason).toBe('MANUAL');
    expect(Number(state.positions[0].realizedPnl)).toBeLessThan(0);
  });
});
