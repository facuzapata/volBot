import { EventEmitter } from 'events';
import WebSocket = require('ws');
import { MarketDataService } from '../../src/v2/market/market-data.service';
import { StoreService } from '../../src/v2/persistence/store.service';
import { PublicMarketClient } from '../../src/v2/market/public-market.client';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';
import { bar } from './fixtures';
import { v5FifteenHistory } from './btc-v5-fixtures';

jest.mock('ws', () => {
  const { EventEmitter: Emitter } = jest.requireActual<typeof import('events')>('events');
  class MockSocket extends Emitter {
    static instances: MockSocket[] = [];
    constructor(_url: string) {
      super();
      MockSocket.instances.push(this);
    }
    terminate() {
      this.emit('close');
    }
  }
  return MockSocket;
});
const sockets = (WebSocket as unknown as { instances: EventEmitter[] }).instances;

describe('MarketData reconnection and shutdown', () => {
  afterEach(() => {
    sockets.length = 0;
    jest.useRealTimers();
  });
  it('repairs the old 100-bar 5m seed using recovered history before resuming forward catch-up', async () => {
    const history = v5FifteenHistory()['5m'];
    const latest = history.at(-1)!;
    const repo = {
      findOne: jest.fn(async (q) =>
        q.where.timeframe === '5m' ? { openTime: latest.openTime } : null,
      ),
      countBy: jest.fn().mockResolvedValue(100),
    };
    const store = { db: { getRepository: () => repo } } as unknown as StoreService;
    const candles = jest.fn(async (tf, start, limit) =>
      tf === '5m' && start === undefined && limit === 320 ? history : [],
    );
    const market = new MarketDataService(
      store,
      { candles } as unknown as PublicMarketClient,
      new SimulationSettings(),
    );
    const persist = jest.spyOn(market, 'persist').mockResolvedValue(true);
    await (market as unknown as { recover: () => Promise<void> }).recover();
    expect(candles).toHaveBeenCalledWith('5m', undefined, 320);
    expect(candles).toHaveBeenCalledWith('5m', latest.openTime + 300000, 1000);
    expect(persist).toHaveBeenCalledTimes(320);
    expect(
      persist.mock.calls.every(([, recovered, emitRecovered]) => recovered && emitRecovered),
    ).toBe(true);
  });
  it('ignores partial candles, queues closed ones, reconnects and does not reconnect after shutdown', async () => {
    // Runtime import uses CommonJS constructor; supply the mock in the same shape.
    jest.useFakeTimers();
    const lease = {
      connect: jest.fn(),
      query: jest.fn().mockResolvedValue([{ acquired: true }]),
      release: jest.fn().mockResolvedValue(undefined),
      isReleased: false,
    };
    const repo = { findOne: jest.fn().mockResolvedValue(null) };
    const store = {
      db: { createQueryRunner: () => lease, getRepository: () => repo },
    } as unknown as StoreService;
    const candles = jest.fn().mockResolvedValue([]);
    const client = {
      wsBase: 'wss://example.invalid',
      filters: async () => ({ stepSize: 0.00001, tickSize: 0.01, minQty: 0.00001, minNotional: 5 }),
      candles,
    } as unknown as PublicMarketClient;
    const market = new MarketDataService(store, client, new SimulationSettings());
    const persist = jest.spyOn(market, 'persist').mockResolvedValue(true);
    market.onModuleInit();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(candles).toHaveBeenNthCalledWith(1, '1h', undefined, 500);
    expect(candles).toHaveBeenNthCalledWith(2, '5m', undefined, 320);
    expect(candles).toHaveBeenNthCalledWith(3, '1m', undefined, 100);
    expect(sockets).toHaveLength(1);
    const socket = sockets[0];
    socket.emit('open');
    const c = bar();
    const message = (closed: boolean) =>
      Buffer.from(
        JSON.stringify({
          data: {
            s: 'BTCUSDT',
            k: {
              x: closed,
              i: '1m',
              t: c.openTime,
              T: c.closeTime,
              o: c.open,
              h: c.high,
              l: c.low,
              c: c.close,
              v: c.volume,
            },
          },
        }),
      );
    socket.emit('message', message(false));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(persist).not.toHaveBeenCalled();
    socket.emit('message', message(true));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
    socket.emit('close');
    await jest.advanceTimersByTimeAsync(5000);
    expect(sockets).toHaveLength(2);
    await market.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10000);
    expect(sockets).toHaveLength(2);
    expect(lease.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock(72821001)');
  });

  it('repairs the trailing hourly window even when an older deployment already wrote a latest candle', async () => {
    const lease = {
      connect: jest.fn(),
      query: jest.fn().mockResolvedValue([{ acquired: true }]),
      release: jest.fn().mockResolvedValue(undefined),
      isReleased: false,
    };
    const newestStored = 1735689600000;
    const repo = { findOne: jest.fn().mockResolvedValue({ openTime: newestStored }) };
    const hourly = bar(newestStored - 499 * 3600000, {
      timeframe: '1h', closeTime: newestStored - 499 * 3600000 + 3599999,
    });
    const candles = jest.fn((timeframe: string, start?: number, limit?: number) =>
      Promise.resolve(timeframe === '1h' && start === undefined && limit === 500 ? [hourly] : []),
    );
    const store = { db: { createQueryRunner: () => lease, getRepository: () => repo } } as unknown as StoreService;
    const client = {
      wsBase: 'wss://example.invalid',
      filters: async () => ({ stepSize: 0.00001, tickSize: 0.01, minQty: 0.00001, minNotional: 5 }),
      candles,
    } as unknown as PublicMarketClient;
    const market = new MarketDataService(store, client, new SimulationSettings());
    const persist = jest.spyOn(market, 'persist').mockResolvedValue(true);

    market.onModuleInit();
    for (let i = 0; i < 30; i++) await Promise.resolve();

    expect(candles).toHaveBeenCalledWith('1h', undefined, 500);
    expect(persist).toHaveBeenCalledWith(hourly, true, false);
    await market.onModuleDestroy();
  });
});
