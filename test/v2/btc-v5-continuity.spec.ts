import { BacktestingEngine, statistics } from '../../src/v2/backtesting/backtesting.engine';
import { StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { strategyConfiguration } from '../../src/v2/strategy/versions';
import { BTC_V5_REVISION } from '../../src/v2/strategy/btc-v5.config';
import { StrategyServiceV2 } from '../../src/v2/trading/trading.services';
import { DomainEvent } from '../../src/v2/events/contracts';
import { MarketHistory } from '../../src/v2/strategy/strategy-engine';
import { Candle, Position } from '../../src/v2/domain/model';
import { newAccount } from '../../src/v2/execution/paper-execution.adapter';
import { v5RecoverySummary } from '../../src/v2/risk/v5-recovery';
import { bar, signal } from './fixtures';

describe('V5 continuous signal publication', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['btc-v5', 'btc-v4'] as const)(
    'publishes fresh eligible candles for %s with replay idempotency',
    async (strategy) => {
      const first = bar(Date.UTC(2026, 0, 1));
      let history: MarketHistory;
      const row = {
        id: strategy,
        revision: 'old',
        state: { active: true, eligible: true, lastCandleTime: 0, lastSignalTime: 0 },
      };
      const repo = { find: async () => [row] };
      const tx = { findOneOrFail: async () => row, save: jest.fn(), insert: jest.fn() };
      const seen = new Set<string>();
      const emit = jest.fn();
      const store = {
        db: { getRepository: () => repo, transaction: async (action) => action(tx) },
        once: async (_tx, _consumer, id, action) => {
          if (!seen.has(id)) {
            seen.add(id);
            await action();
          }
        },
        emit,
      };
      const engine = new StrategyEngine();
      jest.spyOn(engine, 'evaluate').mockImplementation((h) => ({
        ...signal(`s-${h['1m'].at(-1)!.closeTime}`, h['1m'].at(-1)!.closeTime),
        strategy,
      }));
      const service = new StrategyServiceV2(
        store as never,
        engine,
        { candle: async () => undefined } as never,
        { config: strategyConfiguration(strategy) } as never,
        { get: async () => history } as never,
      );
      for (let i = 0; i < 3; i++) {
        const candle = bar(first.openTime + i * 60000);
        const higher = (timeframe: '5m' | '1h', step: number): Candle => {
          const end = Math.floor((candle.closeTime + 1) / step) * step - 1;
          return { ...bar(end - step + 1), timeframe, closeTime: end };
        };
        history = { '1m': [candle], '5m': [higher('5m', 300000)], '1h': [higher('1h', 3600000)] };
        jest.spyOn(Date, 'now').mockReturnValue(candle.closeTime);
        const event: DomainEvent<'market.candle.closed.v1'> = {
          eventId: `c-${i}`,
          schemaVersion: 1,
          topic: 'market.candle.closed.v1',
          key: 'BTCUSDT',
          occurredAt: new Date(candle.closeTime).toISOString(),
          correlationId: `c-${i}`,
          payload: { candle, recovered: i === 0 },
        };
        await service.candle(event);
        await service.candle(event);
      }
      expect(emit).toHaveBeenCalledTimes(strategy === 'btc-v5' ? 2 : 0);
      expect(tx.insert).toHaveBeenCalledTimes(strategy === 'btc-v5' ? 2 : 0);
    },
  );

  it('reenters on a fresh minute after a losing time exit without needing an eligibility reset', () => {
    const engine = new StrategyEngine();
    jest.spyOn(engine, 'evaluate').mockImplementation((h, strategy, config) => {
      const candle = h['1m'].at(-1)!;
      return {
        ...signal(`s-${candle.closeTime}`, candle.closeTime),
        strategy,
        strategyRevision: BTC_V5_REVISION,
        referencePrice: candle.close,
        config: config!,
        conditions: { recoveryQuality: true },
        protection: {
          stopPrice: candle.close - 200,
          targetPrice: candle.close + 500,
          horizonMs: 15 * 60000,
          timeframe: '5m',
        },
      };
    });
    const bars = Array.from({ length: 45 }, (_, i) =>
      bar(Date.UTC(2026, 0, 1) + i * 60000, {
        open: 100000 - i * 0.1,
        close: 100000 - i * 0.1,
        low: 99990 - i * 0.1,
        high: 100001 - i * 0.1,
      }),
    );
    const report = new BacktestingEngine(engine).run(bars, {
      strategy: 'btc-v5',
      initialCapital: 500,
      maxPositions: 1,
      usdtPerTrade: 30,
      config: {
        feeRate: 0,
        spreadBps: 0,
        slippageBps: 0,
        btcV5: {
          ...strategyConfiguration('btc-v5').btcV5!,
          exitMode: 'STOP_TARGET',
          horizonMinutes: 15,
          cooldownMinutes: 1,
          stopCooldownMinutes: 1,
        },
      },
    });
    const closed = report.trades.filter((p) => p.status === 'CLOSED');
    expect(closed.length).toBeGreaterThanOrEqual(2);
    expect(Number(closed[0].realizedPnl)).toBeLessThan(0);
    expect(report.trades[1].openedAt).toBeGreaterThan(closed[0].closedAt!);
    expect(report.metrics.maxSimultaneous).toBe(1);
    expect(report.trades.every((p) => Number(p.entryQuote) <= 30)).toBe(true);
    expect(report.metrics.v5Recovery.unrecoveredLossUSDT).toBeGreaterThan(0);
    expect(report.metrics.netRealizedPnl).toBeLessThan(0);
  });
});

describe('V5 recovery accounting', () => {
  const position = (id: string, at: number, pnl: string): Position =>
    ({
      id,
      strategy: 'btc-v5',
      status: 'CLOSED',
      entryQuantity: '1',
      quantity: '0',
      remainingCost: '0',
      openedAt: at - 60000,
      closedAt: at,
      realizedPnl: pnl,
    }) as Position;

  it('reduces the actual net deficit across several wins and resets only when recovered', () => {
    const state = newAccount('a', 'a');
    state.positions = [position('loss', 100, '-0.20'), position('partial', 200, '0.08')];
    const original = JSON.stringify(state);
    expect(v5RecoverySummary(state)).toMatchObject({
      unrecoveredLossUSDT: 0.12,
      recoveryGoalUSDT: 0.18,
      minimumCycleProfitUSDT: 0.06,
    });
    expect(JSON.stringify(state)).toBe(original);
    state.positions.push(position('recovered', 300, '0.15'));
    expect(v5RecoverySummary(state)).toMatchObject({
      unrecoveredLossUSDT: 0,
      netRealizedUSDT: 0.03,
      recoveryGoalUSDT: 0.06,
    });
    expect(statistics(state, 0).v5Recovery).toEqual(v5RecoverySummary(state));
  });

  it('uses close chronology and excludes other strategies and unfilled or unrealized positions', () => {
    const state = newAccount('a', 'a');
    state.positions = [
      position('win', 200, '0.10'),
      position('loss', 100, '-0.20'),
      { ...position('other', 300, '10'), strategy: 'btc-v4' },
      { ...position('open', 400, '10'), status: 'OPEN' },
      { ...position('unfilled', 500, '10'), entryQuantity: '0' },
    ];
    expect(v5RecoverySummary(state)).toMatchObject({ closedTrades: 2, unrecoveredLossUSDT: 0.1 });
  });

  it('tracks a new loss after a profitable cycle against the realized high water mark', () => {
    const state = newAccount('a', 'a');
    state.positions = [position('win', 100, '0.20'), position('loss', 200, '-0.10')];
    expect(v5RecoverySummary(state)).toMatchObject({
      unrecoveredLossUSDT: 0.1,
      netRealizedUSDT: 0.1,
    });
  });
});
