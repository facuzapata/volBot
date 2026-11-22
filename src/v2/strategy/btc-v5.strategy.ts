import { createHash } from 'crypto';
import * as indicators from '../../utils/indicators';
import { floorStep } from '../execution/pricing';
import { Candle, MarketSignal, SimulationConfig } from '../domain/model';
import type { MarketHistory } from './strategy-engine';
import { BtcV5Parameters, BTC_V5_REVISION, DEFAULT_BTC_V5 } from './btc-v5.config';

export interface V5Assessment {
  at: number;
  decision: 'BUY' | 'NO_TRADE';
  reason: string;
  conditions: Record<string, boolean>;
  features?: {
    atr1h: number; atrFraction: number; ema4hFast: number; ema4hSlow: number;
    ema1hFast: number; ema15m: number; entryEma: number; stopPrice: number;
    targetPrice: number; rewardRisk: number;
  };
  signal?: MarketSignal;
}

const MINUTE = 60000;
const HOUR = 60 * MINUTE;

/** Aggregates only complete, contiguous bars. No unfinished higher-timeframe bar leaks into a signal. */
const aggregate = (bars: Candle[], sourceStep: number, bucketStep: number): Candle[] => {
  const grouped = new Map<number, Candle[]>();
  for (const bar of bars) {
    const bucket = Math.floor(bar.openTime / bucketStep) * bucketStep;
    const group = grouped.get(bucket) ?? [];
    group.push(bar);
    grouped.set(bucket, group);
  }
  const expected = bucketStep / sourceStep;
  return [...grouped.entries()].sort(([a], [b]) => a - b).flatMap(([openTime, group]) => {
    const ordered = group.sort((a, b) => a.openTime - b.openTime);
    if (ordered.length !== expected || ordered.some((bar, index) => bar.openTime !== openTime + index * sourceStep)) return [];
    return [{
      symbol: 'BTCUSDT' as const,
      timeframe: ordered[0].timeframe,
      openTime,
      closeTime: openTime + bucketStep - 1,
      open: ordered[0].open,
      high: Math.max(...ordered.map((bar) => bar.high)),
      low: Math.min(...ordered.map((bar) => bar.low)),
      close: ordered.at(-1)!.close,
      volume: ordered.reduce((sum, bar) => sum + bar.volume, 0),
    }];
  });
};

/**
 * V5 tests a specific hypothesis: failed V4 continuations can be reduced by
 * requiring a healthy 4h trend, a 1h higher-low, a 15m pullback/retest, and a
 * one-minute recovery. A stronger volume-confirmed subset is tagged for a
 * per-account recovery gate after a stop; size never increases after loss.
 */
export class BtcV5Strategy {
  assess(input: MarketHistory, config: SimulationConfig): V5Assessment {
    const last = input['1m'].at(-1);
    const at = last?.closeTime ?? 0;
    const parameters = { ...DEFAULT_BTC_V5, ...config.btcV5 };
    const no = (reason: string, conditions: Record<string, boolean> = {}, features?: V5Assessment['features']): V5Assessment =>
      ({ at, decision: 'NO_TRADE', reason, conditions, features });
    if (!last) return no('MISSING_CLOSED_DATA');

    const hours = input['1h'].filter((bar) => bar.closeTime <= at).slice(-500);
    const fives = input['5m'].filter((bar) => bar.closeTime <= at).slice(-100);
    const minutes = input['1m'].filter((bar) => bar.closeTime <= at).slice(-100);
    const contiguous = (bars: Candle[], step: number) => bars.every((bar, index) => index === 0 || bar.openTime === bars[index - 1].openTime + step);
    if (hours.length < parameters.trendEmaSlow * 4 || fives.length < 60 || minutes.length < parameters.entryEmaPeriod + parameters.entryPullbackMinutes + 1 || !contiguous(hours, HOUR) || !contiguous(fives, 5 * MINUTE) || !contiguous(minutes, MINUTE))
      return no('MISSING_OR_UNALIGNED_DATA');

    const fours = aggregate(hours, HOUR, 4 * HOUR).slice(-100);
    const fifteens = aggregate(fives, 5 * MINUTE, 15 * MINUTE).slice(-30);
    const currentHour = hours.at(-1);
    const current15m = fifteens.at(-1);
    const previousMinute = minutes.at(-2);
    if (!currentHour || !current15m || !previousMinute || fours.length < parameters.trendEmaSlow || fifteens.length < 21)
      return no('MISSING_OR_UNALIGNED_DATA');

    const ema4hFast = indicators.calculateEMA(fours.map((bar) => bar.close), parameters.trendEmaFast);
    const ema4hSlow = indicators.calculateEMA(fours.map((bar) => bar.close), parameters.trendEmaSlow);
    const prior4hFast = indicators.calculateEMA(fours.slice(0, -1).map((bar) => bar.close), parameters.trendEmaFast);
    const prior4hSlow = indicators.calculateEMA(fours.slice(0, -1).map((bar) => bar.close), parameters.trendEmaSlow);
    const ema1hFast = indicators.calculateEMA(hours.map((bar) => bar.close), parameters.trendEmaFast);
    const ema1hSlow = indicators.calculateEMA(hours.map((bar) => bar.close), parameters.trendEmaSlow);
    const atr1h = indicators.calculateATR(hours, 14);
    const ema15m = indicators.calculateEMA(fifteens.map((bar) => bar.close), parameters.trendEmaFast);
    const prior15mVolume = indicators.calculateSMA(fifteens.slice(0, -1).slice(-10).map((bar) => bar.volume), 10);
    const entryEma = indicators.calculateEMA(minutes.map((bar) => bar.close), parameters.entryEmaPeriod);
    if ([ema4hFast, ema4hSlow, prior4hFast, prior4hSlow, ema1hFast, ema1hSlow, atr1h, ema15m, prior15mVolume, entryEma].some((value) => value === null) || atr1h! <= 0)
      return no('MISSING_INDICATORS');

    const entryPrice = last.close;
    const swingLow = Math.min(...hours.slice(-parameters.hourStructureLookback).map((bar) => bar.low));
    const stopPrice = Math.min(swingLow - parameters.swingBufferAtr * atr1h!, entryPrice - parameters.stopAtr1h * atr1h!);
    const riskPerUnit = entryPrice - stopPrice;
    const marketImpact = (config.spreadBps / 2 + config.slippageBps) / 10000;
    const entryCost = entryPrice * (1 + marketImpact) * (1 + config.feeRate);
    const stopProceeds = stopPrice * (1 - marketImpact) * (1 - config.feeRate);
    const targetPrice = (entryCost + parameters.targetRiskMultiple * (entryCost - stopProceeds)) / (1 - config.feeRate) + 10 * config.tickSize;
    const priorHourLow = Math.min(...hours.slice(-(parameters.hourStructureLookback + 1), -1).map((bar) => bar.low));
    const fifteenPullback = fifteens.slice(-4, -1);
    const fifteenBreakout = Math.max(...fifteens.slice(-(parameters.fifteenBreakoutLookback + 1), -1).map((bar) => bar.high));
    const minutePullback = minutes.slice(-(parameters.entryPullbackMinutes + 1), -1);
    const conditions: Record<string, boolean> = {
      trend4h: ema4hFast! > ema4hSlow! && fours.at(-1)!.close > ema4hFast! && ema4hFast! > prior4hFast! && ema4hSlow! >= prior4hSlow!,
      structure1h: ema1hFast! > ema1hSlow! && currentHour.close > ema1hFast! && currentHour.low > priorHourLow,
      retest15m: Math.min(...fifteenPullback.map((bar) => bar.low)) <= ema15m! && current15m.close > ema15m! && current15m.close > fifteenBreakout,
      recovery1m: last.close > last.open && last.close > previousMinute.high && last.close > entryEma! && Math.min(...minutePullback.map((bar) => bar.low)) <= entryEma!,
      notExtended: entryPrice - ema1hFast! <= parameters.maxEntryExtensionAtr * atr1h!,
      volatility: atr1h! / entryPrice >= parameters.minAtr1hFraction && atr1h! / entryPrice <= parameters.maxAtr1hFraction,
      stopGeometry: stopPrice > 0 && stopPrice < entryPrice && riskPerUnit / entryPrice <= config.maxStopPercent,
      rewardRisk: targetPrice > entryPrice && (targetPrice - entryPrice) / riskPerUnit >= parameters.targetRiskMultiple,
      recoveryQuality: current15m.volume >= prior15mVolume! * parameters.recoveryVolumeMultiplier && currentHour.close > currentHour.open,
    };
    const features = { atr1h: atr1h!, atrFraction: atr1h! / entryPrice, ema4hFast: ema4hFast!, ema4hSlow: ema4hSlow!, ema1hFast: ema1hFast!, ema15m: ema15m!, entryEma: entryEma!, stopPrice, targetPrice, rewardRisk: riskPerUnit > 0 ? (targetPrice - entryPrice) / riskPerUnit : 0 };
    const required = Object.keys(conditions).filter((key) => key !== 'recoveryQuality');
    const failed = required.filter((key) => !conditions[key]);
    if (failed.length) return no(failed.map((key) => `NO_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`).join('|'), conditions, features);
    const id = createHash('sha256').update(`btc-v5:${BTC_V5_REVISION}:BTCUSDT:${at}`).digest('hex');
    const signal: MarketSignal = {
      id, strategy: 'btc-v5', strategyRevision: BTC_V5_REVISION, symbol: 'BTCUSDT', candleTime: at,
      referencePrice: entryPrice, atr: atr1h!, swingLow: stopPrice, regime: 'up', conditions,
      config: { ...config, btcV5: parameters },
      protection: { stopPrice: floorStep(stopPrice, config.tickSize).toNumber(), targetPrice: floorStep(targetPrice, config.tickSize).toNumber(), horizonMs: parameters.horizonMinutes * MINUTE, timeframe: '1h' },
    };
    return { at, decision: 'BUY', reason: 'STRUCTURE_RETEST_RECOVERY', conditions, features, signal };
  }
}

export const validV5Parameters = (parameters: BtcV5Parameters): boolean =>
  parameters.revision === BTC_V5_REVISION &&
  Object.entries(parameters).every(([key, value]) => key === 'revision' || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) &&
  parameters.horizonMinutes >= 60 && parameters.horizonMinutes <= 10080 &&
  Number.isInteger(parameters.trendEmaFast) && Number.isInteger(parameters.trendEmaSlow) && parameters.trendEmaFast >= 5 && parameters.trendEmaFast < parameters.trendEmaSlow && parameters.trendEmaSlow <= 100 &&
  Number.isInteger(parameters.hourStructureLookback) && parameters.hourStructureLookback >= 3 && parameters.hourStructureLookback <= 24 &&
  Number.isInteger(parameters.fifteenBreakoutLookback) && parameters.fifteenBreakoutLookback >= 3 && parameters.fifteenBreakoutLookback <= 20 &&
  Number.isInteger(parameters.entryEmaPeriod) && parameters.entryEmaPeriod >= 3 && parameters.entryEmaPeriod <= 30 &&
  Number.isInteger(parameters.entryPullbackMinutes) && parameters.entryPullbackMinutes >= 2 && parameters.entryPullbackMinutes <= 30 &&
  parameters.stopAtr1h > 0 && parameters.targetRiskMultiple >= 1.25 && parameters.maxEntryExtensionAtr > 0 && parameters.minAtr1hFraction < parameters.maxAtr1hFraction && parameters.recoveryVolumeMultiplier >= 1 && parameters.maxConsecutiveStopLosses >= 1 && Number.isInteger(parameters.maxConsecutiveStopLosses);
