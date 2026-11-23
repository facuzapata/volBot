import { createHash } from 'crypto';
import * as indicators from '../../utils/indicators';
import { MarketSignal, SimulationConfig } from '../domain/model';
import { floorStep } from '../execution/pricing';
import type { MarketHistory } from './strategy-engine';
import { BTC_V6_REVISION, DEFAULT_BTC_V6 } from './btc-v6.config';
import { strategyConfiguration } from './versions';

export interface V6Assessment {
  at: number;
  decision: 'BUY' | 'NO_TRADE';
  reason: string;
  conditions: Record<string, boolean>;
  features?: Record<string, number | string>;
  signal?: MarketSignal;
}

/** Aggressive same-minute crypto momentum entry. PAPER only, target-only. */
export class BtcV6Strategy {
  assess(history: MarketHistory, input: SimulationConfig): V6Assessment {
    const config = strategyConfiguration('btc-v6', input);
    const p = { ...DEFAULT_BTC_V6, ...config.btcV6 };
    const last = history['1m'].at(-1), at = last?.closeTime ?? 0;
    const no = (reason: string, conditions: Record<string, boolean> = {}, features?: V6Assessment['features']): V6Assessment =>
      ({ at, decision: 'NO_TRADE', reason, conditions, features });
    if (!last) return no('MISSING_DATA');
    const minutes = history['1m'].filter((bar) => bar.closeTime <= at).slice(-100);
    const currentFiveOpen = Math.floor(last.openTime / 300000) * 300000;
    const fives = history['5m'].filter((bar) => bar.closeTime < currentFiveOpen).slice(-100);
    if (minutes.length < p.resistanceMinutes + 1 || fives.length < 50) return no('MISSING_DATA');
    const atr = indicators.calculateATR(fives, 14);
    const fast = indicators.calculateEMA(fives.map((bar) => bar.close), p.trendEmaFast);
    const slow = indicators.calculateEMA(fives.map((bar) => bar.close), p.trendEmaSlow);
    if (atr === null || fast === null || slow === null) return no('MISSING_INDICATORS');
    const previous = minutes.at(-2)!;
    const resistance = Math.max(...minutes.slice(-(p.resistanceMinutes + 1), -1).map((bar) => bar.high));
    const averageVolume = minutes.slice(-21, -1).reduce((sum, bar) => sum + bar.volume, 0) / 20;
    const volumeMultiple = averageVolume > 0 ? last.volume / averageVolume : 0;
    const impulseAtr = (last.close - previous.close) / atr;
    const breakoutDistanceAtr = (last.close - resistance) / atr;
    const trendStrength = fast / slow - 1;
    const targetPrice = floorStep(last.close * (1 + p.targetFraction), config.tickSize).toNumber();
    const impact = (config.spreadBps / 2 + config.slippageBps) / 10000;
    const netTargetFraction =
      (targetPrice * (1 - impact) * (1 - config.feeRate) - last.close * (1 + impact) * (1 + config.feeRate)) /
      last.close;
    const conditions: Record<string, boolean> = {
      fastTrend: fast > slow && trendStrength >= p.minTrendStrength,
      shortBreakout: previous.close <= resistance &&
        last.close >= resistance + p.breakoutAtr * atr &&
        breakoutDistanceAtr <= p.maxBreakoutAtr,
      cryptoImpulse: last.close > last.open && last.close > previous.high && impulseAtr >= p.minImpulseAtr,
      relativeVolume: volumeMultiple >= p.minVolumeMultiple,
      volatility: atr / last.close >= p.minAtrFraction && atr / last.close <= p.maxAtrFraction,
      costCoverage: netTargetFraction >= p.minNetTargetFraction,
      targetRoom: targetPrice > last.close,
      recoveryQuality: last.close > previous.high,
    };
    const failed = Object.keys(conditions).filter((key) => !conditions[key]);
    const features = {
      model: 'CRYPTO_MOMENTUM_BREAKOUT', atr5m: atr, atrFraction: atr / last.close,
      ema5mFast: fast, ema5mSlow: slow, trendStrength, resistancePrice: resistance,
      breakoutDistanceAtr, impulseAtr, volumeMultiple, targetPrice, netTargetFraction,
    };
    if (failed.length)
      return no(failed.map((key) => `NO_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`).join('|'), conditions, features);
    const signal: MarketSignal = {
      id: createHash('sha256').update(`btc-v6:${BTC_V6_REVISION}:BTCUSDT:${at}`).digest('hex'),
      strategy: 'btc-v6', strategyRevision: BTC_V6_REVISION, symbol: 'BTCUSDT', candleTime: at,
      referencePrice: last.close, atr, swingLow: 0, regime: 'up', conditions,
      config: { ...config, btcV6: p },
      protection: { stopPrice: 0, targetPrice, horizonMs: 0, timeframe: '5m', exitMode: 'TARGET_ONLY' },
    };
    return { at, decision: 'BUY', reason: 'CRYPTO_MOMENTUM_BREAKOUT', conditions, features, signal };
  }
}
