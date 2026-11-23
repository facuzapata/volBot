import { BtcV5Strategy, validV5Parameters } from '../../src/v2/strategy/btc-v5.strategy';
import { DEFAULT_BTC_V5 } from '../../src/v2/strategy/btc-v5.config';
import { strategyConfiguration } from '../../src/v2/strategy/versions';
import { fifteenMinuteCloses } from '../../src/v2/strategy/fifteen-minute-bars';
import { StrategyServiceV2 } from '../../src/v2/trading/trading.services';
import { CandleRow, StrategyVersionRow } from '../../src/v2/persistence/entities';
import { DomainEvent } from '../../src/v2/events/contracts';
import { Candle } from '../../src/v2/domain/model';
import { v5FifteenHistory, V5_FIXTURE_END } from './btc-v5-fixtures';

const config = (trendMinutes: 15 | 60 = 15) =>
  strategyConfiguration('btc-v5', { btcV5: { ...DEFAULT_BTC_V5, trendMinutes } });

describe('V5 complete fifteen-minute trend context', () => {
  afterEach(() => jest.restoreAllMocks());
  const five = (openTime: number): Candle => ({
    symbol: 'BTCUSDT',
    timeframe: '5m',
    openTime,
    closeTime: openTime + 299999,
    open: 10000,
    high: 10001,
    low: 9999,
    close: 10000 + (openTime % 900000) / 300000,
    volume: 1,
  });

  it('drops partial UTC edge groups and keeps only complete fifteen-minute closes', () => {
    const bars = [1, 2, 3, 4, 5, 6].map((i) => five(i * 300000));
    const before = JSON.stringify(bars);
    expect(fifteenMinuteCloses(bars)).toEqual([
      { openTime: 900000, closeTime: 1799999, close: bars[4].close },
    ]);
    expect(JSON.stringify(bars)).toBe(before);
  });

  it('does not aggregate gaps, duplicates or incomplete source candles', () => {
    expect(fifteenMinuteCloses([five(0), five(300000)])).toEqual([]);
    expect(fifteenMinuteCloses([five(0), five(0), five(600000)])).toEqual([]);
    expect(
      fifteenMinuteCloses([five(0), five(300000), { ...five(600000), closeTime: 899998 }]),
    ).toEqual([]);
  });

  it('keeps the protected recovery model able to use 15m context without hourly history', () => {
    const data = v5FifteenHistory();
    data['1h'] = [];
    const assessment = new BtcV5Strategy().assess(data, config());
    const signal = assessment.signal;
    expect(signal?.conditions.trend15m).toBe(true);
    expect(signal?.conditions.trend1h).toBeUndefined();
    expect(signal?.protection).toMatchObject({
      exitMode: 'TARGET_ONLY',
      stopPrice: 0,
      horizonMs: 0,
    });
    expect(assessment.features).toMatchObject({ trendTimeframe: '15m' });
    expect(assessment.features?.ema1hFast).toBeUndefined();
  });

  it('accepts a 15m recovery even when the hourly filter would still be bearish', () => {
    const data = v5FifteenHistory();
    data['1h'].forEach((bar, i) => {
      const close = 10000 + (99 - i) * 5;
      Object.assign(bar, { close, open: close - 0.2, high: close + 2, low: close - 6 });
    });
    const strategy = new BtcV5Strategy();
    expect(strategy.assess(data, config(60)).conditions.trend1h).toBe(false);
    expect(strategy.assess(data, config(15)).decision).toBe('BUY');
  });

  it('rejects the old 100-bar warmup and gaps outside the immediate entry window', () => {
    const short = v5FifteenHistory();
    short['5m'] = short['5m'].slice(-100);
    expect(new BtcV5Strategy().assess(short, config()).reason).toBe('MISSING_OR_UNALIGNED_DATA');
    const gap = v5FifteenHistory();
    gap['5m'].splice(-120, 1);
    expect(new BtcV5Strategy().assess(gap, config()).reason).toBe('MISSING_OR_UNALIGNED_DATA');
  });

  it('changes the trend only after a full 15m close, invalidating the closed-bar cache', () => {
    const data = v5FifteenHistory(),
      strategy = new BtcV5Strategy();
    data['1h'] = [];
    const before = strategy.assess(data, config());
    for (let i = 0; i < 2; i++)
      data['5m'].push({ ...five(V5_FIXTURE_END + 1 + i * 300000), close: 10000 });
    data['1m'] = data['1m'].map((bar) => ({
      ...bar,
      openTime: bar.openTime + 600000,
      closeTime: bar.closeTime + 600000,
    }));
    const partial = strategy.assess(data, config());
    expect(partial.features!.trendEmaFast).toBe(before.features!.trendEmaFast);
    data['5m'].push({
      ...five(V5_FIXTURE_END + 1 + 600000),
      open: 10000,
      close: 10200,
      high: 10201,
      low: 9999,
    });
    data['1m'] = data['1m'].map((bar) => ({
      ...bar,
      openTime: bar.openTime + 300000,
      closeTime: bar.closeTime + 300000,
    }));
    const full = strategy.assess(data, config());
    expect(full.features!.trendEmaFast).toBeGreaterThan(partial.features!.trendEmaFast);
  });

  it('validates the timeframe rather than accepting arbitrary minute values', () => {
    expect(validV5Parameters({ ...DEFAULT_BTC_V5, trendMinutes: 15 })).toBe(true);
    expect(validV5Parameters({ ...DEFAULT_BTC_V5, trendMinutes: 60 })).toBe(true);
    expect(validV5Parameters({ ...DEFAULT_BTC_V5, trendMinutes: 30 as 15 })).toBe(false);
  });

  it('loads enough 5m history in the worker and publishes without waiting for an hourly candle', async () => {
    const data = v5FifteenHistory();
    data['1h'] = [];
    const row = {
      id: 'btc-v5',
      revision: 'old',
      state: { active: true, eligible: false, lastCandleTime: 0, lastSignalTime: 0 },
    };
    const limits: Record<string, number> = {};
    const candleRepo = {
      createQueryBuilder: () => {
        let tf: keyof typeof data = '1m',
          limit = 0;
        const query = {
          where: (_sql, args) => {
            tf = args.timeframe;
            return query;
          },
          andWhere: () => query,
          orderBy: () => query,
          take: (n) => {
            limit = n;
            limits[tf] = n;
            return query;
          },
          getMany: async () =>
            data[tf]
              .slice(-limit)
              .reverse()
              .map((bar) => ({ data: bar })),
        };
        return query;
      },
    };
    const tx = { findOneOrFail: async () => row, save: async () => undefined, insert: jest.fn() };
    const emit = jest.fn();
    const store = {
      db: {
        getRepository: (entity) =>
          entity === CandleRow
            ? candleRepo
            : entity === StrategyVersionRow
              ? { find: async () => [row] }
              : undefined,
        transaction: async (action) => action(tx),
      },
      once: async (_tx, _consumer, _id, action) => action(),
      emit,
    };
    const assessment = new BtcV5Strategy().assess(data, config());
    const engine = {
      lastAssessment: {
        at: assessment.at,
        eligible: true,
        regime: 'up',
        reason: assessment.reason,
        conditions: assessment.conditions,
        features: assessment.features,
      },
      evaluate: () => assessment.signal,
    };
    const service = new StrategyServiceV2(
      store as never,
      engine as never,
      { candle: async () => undefined } as never,
      { config: config() } as never,
      { get: async () => undefined, set: async () => undefined } as never,
    );
    jest.spyOn(Date, 'now').mockReturnValue(V5_FIXTURE_END);
    const event: DomainEvent<'market.candle.closed.v1'> = {
      eventId: '15m-context',
      schemaVersion: 1,
      topic: 'market.candle.closed.v1',
      key: 'BTCUSDT',
      occurredAt: new Date(V5_FIXTURE_END).toISOString(),
      correlationId: '15m-context',
      payload: { candle: data['1m'].at(-1)!, recovered: false },
    };
    await service.candle(event);
    expect(limits['5m']).toBe(320);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][3].signal.conditions.trend15m).toBe(true);
  });
});
