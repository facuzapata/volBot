import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { QueryRunner } from 'typeorm';
import WebSocket = require('ws');
import { Candle, Timeframe } from '../domain/model';
import { CandleRow } from '../persistence/entities';
import { StoreService } from '../persistence/store.service';
import { INTERVAL_MS, PublicMarketClient, validCandle } from './public-market.client';
import { SimulationSettings } from './simulation-settings';

@Injectable()
export class MarketDataService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MarketDataService.name);
  private stopped = false;
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private lease?: QueryRunner;
  private queue: Promise<void> = Promise.resolve();
  private lastMessage = 0;
  private heartbeat?: NodeJS.Timeout;
  connected = false;
  ready = false;
  lastError: string | null = null;
  constructor(
    private readonly store: StoreService,
    private readonly client: PublicMarketClient,
    private readonly settings: SimulationSettings,
  ) {}
  onModuleInit(): void {
    void this.start();
  }
  private async start(): Promise<void> {
    if (this.stopped) return;
    try {
      this.lease = this.store.db.createQueryRunner();
      await this.lease.connect();
      const [lock] = (await this.lease.query(
        'SELECT pg_try_advisory_lock(72821001) AS acquired',
      )) as { acquired: boolean }[];
      if (!lock.acquired) {
        await this.lease.release();
        this.lease = undefined;
        throw new Error('MARKET_LEADER_ALREADY_RUNNING');
      }
      this.settings.updateFilters(await this.client.filters());
      await this.recover();
      if (this.stopped) return;
      this.connect();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > 90000) this.socket?.terminate();
        void this.lease?.query('SELECT 1').catch(() => {
          this.ready = false;
          this.socket?.terminate();
        });
      }, 30000);
      this.ready = true;
      this.lastError = null;
    } catch (e) {
      this.ready = false;
      this.lastError = e instanceof Error ? e.message : 'MARKET_START_FAILED';
      this.log.warn(JSON.stringify({ event: 'market_unavailable', code: this.lastError }));
      await this.releaseLease();
      if (!this.stopped)
        this.reconnectTimer = setTimeout(() => {
          void this.start();
        }, 10000);
    }
  }
  private async recover(): Promise<void> {
    for (const tf of ['1h', '5m', '1m'] as Timeframe[]) {
      const latest = await this.store.db
        .getRepository(CandleRow)
        .findOne({ where: { timeframe: tf }, order: { openTime: 'DESC' } });
      let start = latest ? Number(latest.openTime) + INTERVAL_MS[tf] : undefined;
      let pages = 0;
      while (!this.stopped) {
        if (this.stopped) return;
        // V4 derives a 50-EMA from complete 4h bars: it needs at least 200
        // contiguous 1h candles immediately after a clean database start.
        // Seed more than that from public market data rather than making the
        // strategy wait over eight days for a fresh worker to accumulate them.
        const initialLimit = tf === '1h' ? 500 : 100;
        const candles = await this.client.candles(tf, start, start === undefined ? initialLimit : 1000);
        for (const c of candles) await this.persist(c, true, !!latest);
        if (!candles.length || candles.length < 1000 || start === undefined) break;
        start = candles[candles.length - 1].openTime + INTERVAL_MS[tf];
        if (++pages > 100) throw new Error('BACKFILL_LIMIT_REQUIRES_OPERATOR');
      }
    }
  }
  private connect(): void {
    if (this.stopped) return;
    const streams = ['1m', '5m', '1h'].map((tf) => `btcusdt@kline_${tf}`).join('/');
    this.socket = new WebSocket(`${this.client.wsBase}/stream?streams=${streams}`);
    this.lastMessage = Date.now();
    this.socket.on('open', () => {
      this.connected = true;
    });
    this.socket.on('message', (raw) => {
      this.lastMessage = Date.now();
      try {
        const message = JSON.parse(raw.toString()) as {
          data?: { s: string; k?: Record<string, unknown> };
        };
        const k = message.data?.k;
        if (!k || k.x !== true || message.data?.s !== 'BTCUSDT') return;
        const c: Candle = {
          symbol: 'BTCUSDT',
          timeframe: k.i as Timeframe,
          openTime: Number(k.t),
          closeTime: Number(k.T),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
        };
        this.queue = this.queue
          .then(async () => {
            if (!validCandle(c) || c.closeTime > Date.now())
              throw new Error('INVALID_CLOSED_CANDLE');
            const last = await this.store.db
              .getRepository(CandleRow)
              .findOne({ where: { timeframe: c.timeframe }, order: { openTime: 'DESC' } });
            if (last && c.openTime > Number(last.openTime) + INTERVAL_MS[c.timeframe])
              await this.recover();
            if (Date.now() - this.settings.filtersUpdatedAt > 3600000)
              this.settings.updateFilters(await this.client.filters());
            await this.persist(c, false, true);
          })
          .catch(() => {
            this.ready = false;
            this.lastError = 'CANDLE_PROCESSING_FAILED';
            this.socket?.terminate();
          });
      } catch {
        this.log.warn(JSON.stringify({ event: 'market_payload_rejected' }));
      }
    });
    this.socket.on('error', () => this.socket?.terminate());
    this.socket.on('close', () => {
      this.connected = false;
      this.ready = false;
      if (!this.stopped)
        this.reconnectTimer = setTimeout(() => {
          this.queue = this.queue
            .then(async () => {
              // Verify leadership before reconnecting: loss of DB lease must fail closed.
              if (!this.lease || this.lease.isReleased) throw new Error('MARKET_LEASE_LOST');
              await this.lease.query('SELECT 1');
              await this.recover();
              this.ready = true;
              this.connect();
            })
            .catch(async () => {
              this.ready = false;
              this.lastError = 'RECONNECT_FAILED';
              clearInterval(this.heartbeat);
              await this.releaseLease();
              if (!this.stopped)
                this.reconnectTimer = setTimeout(() => {
                  void this.start();
                }, 10000);
            });
        }, 5000);
    });
  }
  async persist(candle: Candle, recovered: boolean, publish: boolean): Promise<boolean> {
    if (!validCandle(candle)) throw new Error('INVALID_CANDLE');
    return this.store.db.transaction(async (tx) => {
      const id = `${candle.timeframe}:${candle.openTime}`;
      const result = await tx
        .createQueryBuilder()
        .insert()
        .into(CandleRow)
        .values({ id, timeframe: candle.timeframe, openTime: candle.openTime, data: candle })
        .orIgnore()
        .returning('id')
        .execute();
      if (!result.raw.length) return false;
      if (publish)
        await this.store.emit(
          tx,
          'market.candle.closed.v1',
          `BTCUSDT:${candle.timeframe}`,
          { candle, recovered: recovered || Date.now() - candle.closeTime > 120000 },
          id,
          createHash('sha256').update(`candle:${id}`).digest('hex'),
        );
      return true;
    });
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    this.socket?.terminate();
    await this.queue;
    await this.releaseLease();
  }
  private async releaseLease(): Promise<void> {
    if (this.lease && !this.lease.isReleased) {
      await this.lease.query('SELECT pg_advisory_unlock(72821001)').catch(() => undefined);
      await this.lease.release().catch(() => undefined);
    }
    this.lease = undefined;
  }
}
