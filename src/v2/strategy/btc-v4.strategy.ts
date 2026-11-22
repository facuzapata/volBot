import { createHash } from 'crypto';
import * as indicators from '../../utils/indicators';
import { floorStep } from '../execution/pricing';
import { Candle, MarketSignal, SimulationConfig } from '../domain/model';
import type { MarketHistory } from './strategy-engine';
import { BtcV4Parameters, BTC_V4_REVISION, DEFAULT_BTC_V4 } from './btc-v4.config';

export interface V4Assessment {
  at: number;
  decision: 'BUY' | 'NO_TRADE';
  reason: string;
  conditions: Record<string, boolean>;
  features?: { atr4h: number; atrFraction: number; emaFast: number; emaSlow: number; stopPrice: number; targetPrice: number; rewardRisk: number };
  signal?: MarketSignal;
}

const HOUR = 3600000;

/** Aggregate only complete contiguous 1h candles; no partial 4h bar is visible. */
const fourHourBars = (bars: Candle[]): Candle[] => {
  const grouped = new Map<number, Candle[]>();
  for (const bar of bars) {
    const bucket = Math.floor(bar.openTime / (4 * HOUR)) * 4 * HOUR;
    const group = grouped.get(bucket) ?? [];
    group.push(bar);
    grouped.set(bucket, group);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([openTime, group]) => {
      const ordered = group.sort((a, b) => a.openTime - b.openTime);
      if (ordered.length !== 4 || ordered[0].openTime !== openTime || ordered.some((bar, index) => bar.openTime !== openTime + index * HOUR)) return [];
      return [{
        symbol: 'BTCUSDT' as const,
        timeframe: '1h' as const,
        openTime,
        closeTime: openTime + 4 * HOUR - 1,
        open: ordered[0].open,
        high: Math.max(...ordered.map((bar) => bar.high)),
        low: Math.min(...ordered.map((bar) => bar.low)),
        close: ordered.at(-1)!.close,
        volume: ordered.reduce((sum, bar) => sum + bar.volume, 0),
      }];
    });
};

/**
 * V4.2: long-only 4h trend continuation. It enters a completed bullish 4h
 * pullback that recovers EMA20 and the previous 4h high while EMA20 remains above EMA50.
 */
export class BtcV4Strategy {
  assess(input: MarketHistory, config: SimulationConfig): V4Assessment {
    const last = input['1m'].at(-1);
    const at = last?.closeTime ?? 0;
    const parameters = { ...DEFAULT_BTC_V4, ...config.btcV4 };
    const no = (reason: string, conditions: Record<string, boolean> = {}, features?: V4Assessment['features']): V4Assessment => ({ at, decision: 'NO_TRADE', reason, conditions, features });
    if (!last) return no('MISSING_CLOSED_DATA');
    if ((at + 1) % (parameters.entryHours * HOUR) !== 0) return no('WAITING_FOR_4H_CLOSE');
    const source = input['1h'].filter((bar) => bar.closeTime <= at).slice(-500);
    if (source.length < parameters.trendEmaSlow * parameters.entryHours || source.some((bar, index) => index > 0 && bar.openTime !== source[index - 1].openTime + HOUR)) return no('MISSING_OR_UNALIGNED_DATA');
    const bars = fourHourBars(source).slice(-100);
    const current = bars.at(-1);
    const previous = bars.at(-2);
    if (!current || !previous || current.closeTime !== at || bars.length < parameters.trendEmaSlow) return no('MISSING_OR_UNALIGNED_DATA');
    const closes = bars.map((bar) => bar.close);
    const emaFast = indicators.calculateEMA(closes, parameters.trendEmaFast);
    const emaSlow = indicators.calculateEMA(closes, parameters.trendEmaSlow);
    const priorEmaFast = indicators.calculateEMA(closes.slice(0, -1), parameters.trendEmaFast);
    const priorEmaSlow = indicators.calculateEMA(closes.slice(0, -1), parameters.trendEmaSlow);
    const atr = indicators.calculateATR(bars, 14);
    if (emaFast === null || emaSlow === null || priorEmaFast === null || priorEmaSlow === null || atr === null || atr <= 0) return no('MISSING_INDICATORS');
    const stopPrice = current.close - parameters.stopAtr5m * atr;
    const riskPerUnit = current.close - stopPrice;
    const marketImpact = (config.spreadBps / 2 + config.slippageBps) / 10000;
    const entryCostPerUnit = current.close * (1 + marketImpact) * (1 + config.feeRate);
    const stopProceedsPerUnit = stopPrice * (1 - marketImpact) * (1 - config.feeRate);
    const targetPrice = (entryCostPerUnit + parameters.targetRiskMultiple * (entryCostPerUnit - stopProceedsPerUnit)) / (1 - config.feeRate) + 10 * config.tickSize;
    const conditions: Record<string, boolean> = {
      primaryTrend: emaFast > emaSlow && current.close > emaSlow,
      pullbackRecovery: current.low <= emaFast && current.close > emaFast && current.close > current.open,
      confirmation: previous.low <= priorEmaFast && previous.close > priorEmaFast && previous.close > previous.open && priorEmaFast > priorEmaSlow && current.close > previous.high,
      volatility: atr / current.close >= parameters.minAtr5mFraction && atr / current.close <= parameters.maxAtr5mFraction,
      stopGeometry: stopPrice > 0 && stopPrice < current.close && riskPerUnit / current.close <= config.maxStopPercent,
      rewardRisk: targetPrice > current.close && (targetPrice - current.close) / riskPerUnit >= parameters.targetRiskMultiple,
    };
    const features = { atr4h: atr, atrFraction: atr / current.close, emaFast, emaSlow, stopPrice, targetPrice, rewardRisk: riskPerUnit > 0 ? (targetPrice - current.close) / riskPerUnit : 0 };
    const failed = Object.keys(conditions).filter((key) => !conditions[key]);
    if (failed.length) return no(failed.map((key) => `NO_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`).join('|'), conditions, features);
    const id = createHash('sha256').update(`btc-v4:${BTC_V4_REVISION}:BTCUSDT:${at}`).digest('hex');
    const signal: MarketSignal = {
      id,
      strategy: 'btc-v4',
      strategyRevision: BTC_V4_REVISION,
      symbol: 'BTCUSDT',
      candleTime: at,
      referencePrice: current.close,
      atr,
      swingLow: stopPrice,
      regime: 'up',
      conditions,
      config: { ...config, btcV4: parameters },
      protection: { stopPrice: floorStep(stopPrice, config.tickSize).toNumber(), targetPrice: floorStep(targetPrice, config.tickSize).toNumber(), horizonMs: parameters.horizonMinutes * 60000, timeframe: '4h' },
    };
    return { at, decision: 'BUY', reason: 'TREND_PULLBACK_4H', conditions, features, signal };
  }
}

export const validV4Parameters = (parameters: BtcV4Parameters): boolean =>
  parameters.revision === BTC_V4_REVISION &&
  Object.entries(parameters).every(([key, value]) => key === 'revision' || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) &&
  parameters.entryHours === 4 &&
  Number.isInteger(parameters.trendEmaFast) && Number.isInteger(parameters.trendEmaSlow) && parameters.trendEmaFast >= 5 && parameters.trendEmaFast < parameters.trendEmaSlow && parameters.trendEmaSlow <= 100 &&
  parameters.stopAtr5m > 0 && parameters.targetRiskMultiple >= 1.25 && parameters.maxConsecutiveStopLosses >= 1 && Number.isInteger(parameters.maxConsecutiveStopLosses);
