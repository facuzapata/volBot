import { createHash } from 'crypto';
import * as indicators from '../../utils/indicators';
import { MarketSignal, SimulationConfig } from '../domain/model';
import { floorStep } from '../execution/pricing';
import type { MarketHistory } from './strategy-engine';
import { BTC_V5_REVISION } from './btc-v5.config';
import { fifteenMinuteCloses } from './fifteen-minute-bars';
import { strategyConfiguration } from './versions';

const MINUTE = 60000;
export const BTC_V5_JUMP_REVISION = BTC_V5_REVISION;

export interface V5JumpAssessment {
  at: number;
  decision: 'BUY' | 'NO_TRADE';
  reason: string;
  conditions: Record<string, boolean>;
  features?: {
    model: 'EXCEPTIONAL_JUMP';
    atr5m: number;
    atrFraction: number;
    trendEmaFast: number;
    trendEmaSlow: number;
    trendStrength: number;
    resistancePrice: number;
    breakoutDistanceAtr: number;
    impulseAtr: number;
    volumeMultiple: number;
    targetPrice: number;
    netTargetFraction: number;
  };
  signal?: MarketSignal;
}

/** Selective TARGET_ONLY entry for a first cross of an exceptional volume jump. */
export class BtcV5JumpStrategy {
  assess(input: MarketHistory, config: SimulationConfig): V5JumpAssessment {
    config = strategyConfiguration('btc-v5', config);
    const last = input['1m'].at(-1),
      at = last?.closeTime ?? 0;
    const no = (
      reason: string,
      conditions: Record<string, boolean> = {},
      features?: V5JumpAssessment['features'],
    ): V5JumpAssessment => ({ at, decision: 'NO_TRADE', reason, conditions, features });
    if (!last) return no('MISSING_CLOSED_DATA');
    if (config.btcV5?.exitMode !== 'TARGET_ONLY') return no('JUMP_REQUIRES_TARGET_ONLY');
    const minutes = input['1m'].filter((bar) => bar.closeTime <= at).slice(-100);
    const currentFiveOpen = Math.floor(last.openTime / (5 * MINUTE)) * 5 * MINUTE;
    const fiveSource = input['5m'].filter((bar) => bar.closeTime < currentFiveOpen).slice(-320);
    const fives = fiveSource.slice(-100);
    const trend = fifteenMinuteCloses(fiveSource).slice(-100);
    const volumeWindow = minutes.slice(-22, -2);
    if (
      minutes.length < 51 ||
      fives.length < 51 ||
      trend.length < 51 ||
      volumeWindow.length !== 20
    )
      return no('MISSING_JUMP_DATA');
    const atr = indicators.calculateATR(fives, 14);
    const trendEmaFast = indicators.calculateEMA(
      trend.map((bar) => bar.close),
      config.btcV5.trendEmaFast,
    );
    const trendEmaSlow = indicators.calculateEMA(
      trend.map((bar) => bar.close),
      config.btcV5.trendEmaSlow,
    );
    if (atr === null || trendEmaFast === null || trendEmaSlow === null)
      return no('MISSING_JUMP_INDICATORS');
    const previous = minutes.at(-2)!;
    const beforePrevious = minutes.at(-3)!;
    const resistance = Math.max(
      ...fives.slice(-config.btcV5.jumpResistanceBars).map((bar) => bar.high),
    );
    const averageVolume = volumeWindow.reduce((sum, bar) => sum + bar.volume, 0) / 20;
    const volumeMultiple = averageVolume > 0 ? previous.volume / averageVolume : 0;
    const breakoutDistanceAtr = (previous.close - resistance) / atr;
    const impulseAtr = (previous.close - beforePrevious.close) / atr;
    const trendStrength = trendEmaFast / trendEmaSlow - 1;
    const entryPrice = last.close;
    const impact = (config.spreadBps / 2 + config.slippageBps) / 10000;
    const entryCost = entryPrice * (1 + impact) * (1 + config.feeRate);
    const sellFactor = (1 - impact) * (1 - config.feeRate);
    const targetPrice = floorStep(
      entryPrice * (1 + config.btcV5.targetFraction),
      config.tickSize,
    ).toNumber();
    const netTarget = targetPrice * sellFactor - entryCost;
    const threshold = resistance + config.btcV5.jumpBreakoutAtr * atr;
    const conditions: Record<string, boolean> = {
      trendMomentum:
        trendEmaFast > trendEmaSlow &&
        trendStrength >= config.btcV5.jumpMinTrendStrength,
      firstBreakoutCross:
        beforePrevious.close < threshold &&
        previous.close >= threshold &&
        breakoutDistanceAtr <= config.btcV5.jumpMaxBreakoutAtr,
      exceptionalImpulse:
        previous.close > previous.open &&
        previous.close > beforePrevious.high &&
        impulseAtr >= config.btcV5.jumpMinImpulseAtr,
      exceptionalVolume: volumeMultiple >= config.btcV5.jumpMinVolumeMultiple,
      continuationConfirmation: last.close > previous.close && last.close > last.open,
      volatility:
        atr / entryPrice >= config.btcV5.minAtr5mFraction &&
        atr / entryPrice <= config.btcV5.maxAtr5mFraction,
      costCoverage:
        netTarget / entryPrice >= config.btcV5.minNetTargetFraction &&
        targetPrice <= entryPrice * (1 + config.btcV5.maxTargetFraction),
      targetRoom: targetPrice > entryPrice,
      recoveryQuality: last.close > previous.close,
    };
    const features: V5JumpAssessment['features'] = {
      model: 'EXCEPTIONAL_JUMP',
      atr5m: atr,
      atrFraction: atr / entryPrice,
      trendEmaFast,
      trendEmaSlow,
      trendStrength,
      resistancePrice: resistance,
      breakoutDistanceAtr,
      impulseAtr,
      volumeMultiple,
      targetPrice,
      netTargetFraction: netTarget / entryPrice,
    };
    const failed = Object.keys(conditions).filter((key) => !conditions[key]);
    if (failed.length)
      return no(
        failed
          .map((key) => `NO_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)
          .join('|'),
        conditions,
        features,
      );
    const signal: MarketSignal = {
      id: createHash('sha256')
        .update(`btc-v5:${BTC_V5_JUMP_REVISION}:BTCUSDT:${at}`)
        .digest('hex'),
      strategy: 'btc-v5',
      strategyRevision: BTC_V5_JUMP_REVISION,
      symbol: 'BTCUSDT',
      candleTime: at,
      referencePrice: entryPrice,
      atr,
      swingLow: 0,
      regime: 'up',
      conditions,
      config: { ...config },
      protection: {
        stopPrice: 0,
        targetPrice,
        horizonMs: 0,
        timeframe: '5m',
        exitMode: 'TARGET_ONLY',
      },
    };
    return {
      at,
      decision: 'BUY',
      reason: 'EXCEPTIONAL_VOLUME_JUMP_1M',
      conditions,
      features,
      signal,
    };
  }
}
