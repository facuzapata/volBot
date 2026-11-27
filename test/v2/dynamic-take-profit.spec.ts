import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { BacktestingEngine } from '../../src/v2/backtesting/backtesting.engine';
import { DEFAULT_DYNAMIC_TAKE_PROFIT } from '../../src/v2/execution/dynamic-take-profit';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { DEFAULT_BTC_V6 } from '../../src/v2/strategy/btc-v6.config';
import { PositionManagerService } from '../../src/v2/trading/trading.services';
import { StoreService } from '../../src/v2/persistence/store.service';
import { StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { bar, signal } from './fixtures';

describe('V6 dynamic take profit with chronological sampled prices', () => {
  function bought(dynamic = true) {
    const state = newAccount('a', 'u', 500, 5, 30);
    state.account.entriesEnabled = true;
    const sig = signal();
    sig.strategy = 'btc-v6';
    sig.config.btcV6 = { ...DEFAULT_BTC_V6 };
    if (dynamic) sig.config.v6DynamicTakeProfit = { ...DEFAULT_DYNAMIC_TAKE_PROFIT };
    sig.protection = { stopPrice: 0, targetPrice: 100400, horizonMs: 0, timeframe: '5m', exitMode: 'TARGET_ONLY' };
    const paper = new PaperExecutionAdapter();
    expect(paper.reserve(state, sig, sig.candleTime).accepted).toBe(true);
    paper.execute(state, state.orders[0].id, 100000, sig.candleTime, 1);
    expect(state.positions[0].status).toBe('OPEN');
    return { state, paper, sig };
  }
  function tick(context: ReturnType<typeof bought>, price: number, step: number, liquidity = 1) {
    context.paper.onPrice(context.state, { symbol: 'BTCUSDT', price: String(price), at: context.sig.candleTime + step * 2000 }, liquidity);
  }
  it('preserves the same purchase and snapshots the exit policy only for new opted-in positions', () => {
    const a = bought(), b = bought(false);
    expect(a.state.orders).toEqual(b.state.orders);
    expect(a.state.fills).toEqual(b.state.fills);
    expect(a.state.ledger).toEqual(b.state.ledger);
    expect(b.state.positions[0].dynamicTakeProfit).toBeUndefined();
    expect(a.state.positions[0].dynamicTakeProfit).toMatchObject({ phase: 'WAITING_TARGET', originalTarget: '100400.000000000000' });
  });
  it('arms at the target, follows rising prices and sells above the original target on retracement', () => {
    const context = bought();
    tick(context, 100399, 1);
    expect(context.state.positions[0].dynamicTakeProfit?.phase).toBe('WAITING_TARGET');
    tick(context, 100400, 2);
    tick(context, 100800, 3);
    expect(context.state.orders.filter((o) => o.side === 'SELL')).toHaveLength(0);
    tick(context, 100700, 4);
    const { state } = context;
    expect(state.positions[0]).toMatchObject({ status: 'CLOSED', exitReason: 'DYNAMIC_TAKE_PROFIT' });
    expect(state.positions[0].dynamicTakeProfit).toMatchObject({ phase: 'CLOSED', peak: '100800' });
    expect(new Decimal(state.fills[1].price).gt(100400)).toBe(true);
    expect(new Decimal(state.positions[0].realizedPnl).gt(0)).toBe(true);
    expect(state.positions[0].takeProfit).toBe('100400.000000000000');
  });
  it('keeps a LIMIT pending across a gap below the floor and fills only after a real later observation', () => {
    const context = bought();
    tick(context, 100400, 1);
    tick(context, 100800, 2);
    tick(context, 100000, 3);
    expect(context.state.orders.at(-1)).toMatchObject({ side: 'SELL', type: 'LIMIT', status: 'PENDING', limitPrice: '100400.000000000000' });
    expect(context.state.fills).toHaveLength(1);
    const minute = context.sig.candleTime + 1;
    context.paper.onCandle(context.state, bar(minute, { high: 101000, close: 100000, low: 99000 }), true);
    expect(context.state.fills).toHaveLength(1);
    tick(context, 100410, 40);
    expect(context.state.positions[0].status).toBe('CLOSED');
    expect(new Decimal(context.state.fills[1].price).gte(100400)).toBe(true);
  });
  it('does not use OHLC highs to arm or trigger a dynamic exit', () => {
    const context = bought();
    context.paper.onCandle(context.state, bar(context.sig.candleTime + 1, { high: 101000 }), false);
    expect(context.state.positions[0].dynamicTakeProfit?.phase).toBe('WAITING_TARGET');
    expect(context.state.orders).toHaveLength(1);
  });
  it('persists its peak and armed state across JSON restore, ignoring duplicates and out-of-order samples', () => {
    const context = bought();
    tick(context, 100400, 1);
    tick(context, 100800, 2);
    const serialized = JSON.stringify(context.state);
    tick(context, 99900, 2);
    tick(context, 99900, 1);
    expect(JSON.stringify(context.state)).toBe(serialized);
    context.state = JSON.parse(serialized);
    tick(context, 100700, 3);
    const after = JSON.stringify(context.state);
    tick(context, 100700, 3);
    expect(JSON.stringify(context.state)).toBe(after);
    expect(context.state.fills).toHaveLength(2);
  });
  it('shares a finite liquidity budget and retains the floor through partial fills', () => {
    const context = bought();
    tick(context, 100400, 1);
    tick(context, 100800, 2);
    tick(context, 100700, 3, 0.00002);
    expect(context.state.orders.at(-1)?.status).toBe('PARTIALLY_FILLED');
    tick(context, 100000, 4);
    expect(context.state.fills).toHaveLength(2);
    tick(context, 100500, 5);
    expect(context.state.positions[0].status).toBe('CLOSED');
    expect(context.state.orders.filter((o) => o.side === 'SELL')).toHaveLength(1);
    expect(context.state.fills.filter((f) => f.side === 'SELL').every((f) => new Decimal(f.price).gte(100400))).toBe(true);
    context.paper.assertInvariants(context.state);
  });
  it('does not invent a fill without liquidity', () => {
    const context = bought();
    tick(context, 100400, 1);
    tick(context, 100399, 2, 0);
    expect(context.state.orders.at(-1)?.status).toBe('PENDING');
    expect(context.state.fills).toHaveLength(1);
  });
  it('does not clamp an unmarketable simulated bid upward to fabricate a floor fill', () => {
    const context = bought();
    context.state.positions[0].config.spreadBps = 10;
    tick(context, 100400, 1);
    tick(context, 100800, 2);
    tick(context, 100401, 3);
    expect(context.state.orders.at(-1)?.deferredReason).toBe('DYNAMIC_TARGET_NOT_MARKETABLE');
    expect(context.state.fills).toHaveLength(1);
    tick(context, 100600, 4);
    expect(context.state.positions[0].status).toBe('CLOSED');
    expect(new Decimal(context.state.fills[1].price).gte(100400)).toBe(true);
  });
  it('does not compete with a manual close', () => {
    const context = bought();
    context.paper.requestExit(context.state, context.state.positions[0].id, context.sig.candleTime + 1, 'USER_CLOSE');
    tick(context, 100800, 1);
    tick(context, 100400, 2);
    expect(context.state.orders.filter((o) => o.side === 'SELL')).toHaveLength(1);
    expect(context.state.orders.at(-1)?.reason).toBe('USER_CLOSE');
  });
  it('refuses a malformed dynamic order that would violate the floor', () => {
    const context = bought();
    tick(context, 100400, 1);
    tick(context, 100000, 2);
    const order = context.state.orders.at(-1)!;
    order.limitPrice = '100000';
    context.paper.execute(context.state, order.id, 100000, context.sig.candleTime + 6000, 1);
    expect(order.deferredReason).toBe('DYNAMIC_TARGET_FLOOR_VIOLATION');
    expect(context.state.fills).toHaveLength(1);
  });
  it('rejects an OHLC-only dynamic backtest instead of assuming intrabar order', () => {
    expect(() => new BacktestingEngine().run([bar()], {
      strategy: 'btc-v6', initialCapital: 500, maxPositions: 5, usdtPerTrade: 30,
      config: { v6DynamicTakeProfit: { ...DEFAULT_DYNAMIC_TAKE_PROFIT } },
    })).toThrow('DYNAMIC_TP_REQUIRES_PRICE_OBSERVATIONS');
  });
  it('drops stale live samples before reading accounts', async () => {
    const query = jest.fn();
    const manager = new PositionManagerService({ db: { query } } as unknown as StoreService,
      new PaperExecutionAdapter(), new StrategyEngine());
    await manager.price({ eventId: 'old', topic: 'market.price.observed.v1', key: 'BTCUSDT',
      occurredAt: new Date().toISOString(), correlationId: 'old', schemaVersion: 1,
      payload: { symbol: 'BTCUSDT', price: '100800', at: Date.now() - 11000 } });
    expect(query).not.toHaveBeenCalled();
  });
  it('persists tracking changes and emits each dynamic Telegram event once through the outbox', async () => {
    const context = bought();
    const upsert = jest.fn().mockResolvedValue(undefined);
    const tx = { findOneOrFail: async () => ({ id: 'a' }), update: async () => undefined, insert: async () => undefined,
      getRepository: () => ({ upsert, insert: async () => undefined }) };
    const store = new StoreService({ transaction: async (action: (value: typeof tx) => Promise<void>) => action(tx) } as unknown as DataSource);
    jest.spyOn(store, 'readAccount').mockImplementation(async () => context.state);
    const emit = jest.spyOn(store, 'emit').mockResolvedValue(undefined);
    const process = async (price: string, step: number) => store.accountTransaction('a', async (state) => {
      context.paper.onPrice(state, { symbol: 'BTCUSDT', price, at: context.sig.candleTime + step * 2000 }, 1);
    });
    await process('100400', 1);
    await process('100800', 2);
    await process('100000', 3);
    await process('100000', 3);
    const notifications = emit.mock.calls.filter((call) => call[1] === 'notification.requested.v1');
    expect(notifications.filter((call) => (call[3] as { kind: string }).kind === 'DYNAMIC_TP_ACTIVATED')).toHaveLength(1);
    expect(notifications.filter((call) => (call[3] as { kind: string }).kind === 'DYNAMIC_TP_EXIT_REQUESTED')).toHaveLength(1);
    for (const call of notifications) {
      expect(call[3]).toMatchObject({ parseMode: 'HTML', text: expect.stringContaining('<b>') });
    }
    expect(upsert.mock.calls.some(([value]) => value.data.dynamicTakeProfit?.phase === 'SELL_ORDER_PENDING')).toBe(true);
    expect(context.state.orders.filter((order) => order.side === 'SELL')).toHaveLength(1);
  });
  it('replays identical entries against sampled exits reproducibly and hashes the price dataset', () => {
    const bars = [0, 1, 2].map((i) => bar(1735689600000 + i * 60000, { high: 101000, volume: 100 }));
    const strategy = new StrategyEngine();
    jest.spyOn(strategy, 'evaluate').mockImplementation((history, _id, config) => {
      if (history['1m'].length !== 1) return null;
      const sig = signal('replay', bars[0].closeTime);
      sig.strategy = 'btc-v6';
      sig.config = config!;
      sig.protection = { stopPrice: 0, targetPrice: 100400, horizonMs: 0, timeframe: '5m', exitMode: 'TARGET_ONLY' };
      return sig;
    });
    const prices = [100400, 100800, 100700].map((price, i) => ({ symbol: 'BTCUSDT' as const,
      price: String(price), at: bars[1].openTime + (i + 1) * 2000 }));
    const engine = new BacktestingEngine(strategy);
    const options = { strategy: 'btc-v6' as const, initialCapital: 500, maxPositions: 5, usdtPerTrade: 30,
      config: { spreadBps: 0, slippageBps: 0, v6DynamicTakeProfit: { ...DEFAULT_DYNAMIC_TAKE_PROFIT } } };
    const report = engine.run(bars, options, undefined, undefined, prices);
    expect(report.metrics.closedTrades).toBe(1);
    expect(report.fills[1].price).toBe('100700.000000000000');
    expect(engine.run(bars, options, undefined, undefined, prices)).toEqual(report);
    const changed = engine.run(bars, options, undefined, undefined, prices.map((price, i) => i === 2 ? { ...price, price: '100600' } : price));
    expect(changed.priceObservationsHash).not.toBe(report.priceObservationsHash);
    expect(changed.datasetHash).toBe(report.datasetHash);
  });
});
