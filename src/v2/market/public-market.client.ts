import { Injectable } from '@nestjs/common';
import { Candle, Timeframe } from '../domain/model';

export const INTERVAL_MS: Record<Timeframe, number> = { '1m': 60000, '5m': 300000, '1h': 3600000 };
@Injectable()
export class PublicMarketClient {
  // Market-data-only hosts. No SDK, API key, signature, or configurable private host.
  readonly restBase = 'https://data-api.binance.vision';
  readonly wsBase = 'wss://data-stream.binance.vision:443';
  async request(path: 'klines' | 'exchangeInfo', params: Record<string, string>): Promise<unknown> {
    if (!['klines', 'exchangeInfo'].includes(path)) throw new Error('PRIVATE_ENDPOINT_FORBIDDEN');
    if (
      Object.keys(params).some(
        (k) => !['symbol', 'interval', 'limit', 'startTime', 'endTime'].includes(k),
      )
    )
      throw new Error('PRIVATE_PARAMETERS_FORBIDDEN');
    const url = `${this.restBase}/api/v3/${path}?${new URLSearchParams(params)}`;
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
        if (response.status === 418 || response.status === 429)
          throw new Error('PUBLIC_RATE_LIMIT');
        if (!response.ok) throw new Error(`PUBLIC_HTTP_${response.status}`);
        return await response.json();
      } catch (e) {
        last = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    throw last;
  }
  async candles(timeframe: Timeframe, startTime?: number, limit = 1000, endTime?: number): Promise<Candle[]> {
    const raw = await this.request('klines', {
      symbol: 'BTCUSDT',
      interval: timeframe,
      limit: String(limit),
      ...(startTime === undefined ? {} : { startTime: String(startTime) }),
      ...(endTime === undefined ? {} : { endTime: String(endTime) }),
    });
    if (!Array.isArray(raw)) throw new Error('INVALID_PUBLIC_KLINES');
    return raw
      .map((r: unknown[]) => ({
        symbol: 'BTCUSDT' as const,
        timeframe,
        openTime: Number(r[0]),
        closeTime: Number(r[6]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }))
      .filter((c) => c.closeTime < Date.now() && validCandle(c));
  }
  async filters(): Promise<{
    stepSize: number;
    tickSize: number;
    minQty: number;
    minNotional: number;
  }> {
    const raw = (await this.request('exchangeInfo', { symbol: 'BTCUSDT' })) as {
      symbols?: { filters: { filterType: string; [key: string]: unknown }[] }[];
    };
    const filters = raw.symbols?.[0]?.filters || [];
    const lot = filters.find((f) => f.filterType === 'LOT_SIZE');
    const marketLot = filters.find((f) => f.filterType === 'MARKET_LOT_SIZE');
    const price = filters.find((f) => f.filterType === 'PRICE_FILTER');
    const notional = filters.find(
      (f) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL',
    );
    const result = {
      stepSize: Math.max(Number(lot?.stepSize || 0), Number(marketLot?.stepSize || 0)),
      minQty: Math.max(Number(lot?.minQty || 0), Number(marketLot?.minQty || 0)),
      tickSize: Number(price?.tickSize),
      minNotional: Number(notional?.minNotional),
    };
    if (Object.values(result).some((v) => !Number.isFinite(v) || v <= 0))
      throw new Error('INVALID_PUBLIC_FILTERS');
    return result;
  }
}
export function validCandle(c: Candle): boolean {
  const duration = INTERVAL_MS[c.timeframe];
  return (
    c.symbol === 'BTCUSDT' &&
    !!duration &&
    Number.isSafeInteger(c.openTime) &&
    c.openTime >= 0 &&
    c.openTime % duration === 0 &&
    c.closeTime === c.openTime + duration - 1 &&
    [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
    Math.min(c.open, c.high, c.low, c.close) > 0 &&
    c.volume >= 0 &&
    c.low <= Math.min(c.open, c.close) &&
    c.high >= Math.max(c.open, c.close)
  );
}
