import { createHash } from 'crypto';
import { floorStep } from '../execution/pricing';
import { Candle, MarketSignal, SimulationConfig } from '../domain/model';
import type { MarketHistory, Technical } from './strategy-engine';
import { BtcV4Parameters, BTC_V4_REVISION, DEFAULT_BTC_V4 } from './btc-v4.config';

export interface V4Assessment {
  at: number;
  decision: 'BUY' | 'NO_TRADE';
  reason: string;
  conditions: Record<string, boolean>;
  features?: { atr5m: number; atr5mFraction: number; pullbackAtr: number; range5m: number; range1m: number; stopPrice: number; targetPrice: number; rewardRisk: number };
  signal?: MarketSignal;
}

const rangePosition = (bars: Candle[], price: number) => {
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  return high > low ? (price - low) / (high - low) : 1;
};

/** A frozen trend/pullback candidate. It is PAPER-only until independently validated. */
export class BtcV4Strategy {
  constructor(private readonly technical: (bars: Candle[]) => Technical | null) {}

  assess(input: MarketHistory, config: SimulationConfig): V4Assessment {
    const last = input['1m'].at(-1);
    const at = last?.closeTime ?? 0;
    const parameters = { ...DEFAULT_BTC_V4, ...config.btcV4 };
    const no = (reason: string, conditions: Record<string, boolean> = {}, features?: V4Assessment['features']): V4Assessment => ({ at, decision: 'NO_TRADE', reason, conditions, features });
    if (!last) return no('MISSING_CLOSED_DATA');
    const history = Object.fromEntries((['1m', '5m', '1h'] as const).map((timeframe) => [timeframe, input[timeframe].filter((bar) => bar.closeTime <= at).slice(-100)])) as MarketHistory;
    for (const [timeframe, interval] of [['1m', 60000], ['5m', 300000], ['1h', 3600000]] as const) {
      const bars = history[timeframe];
      if (bars.length < 50 + parameters.trendSlopeHours || bars.at(-1)!.closeTime !== Math.floor((at + 1) / interval) * interval - 1 || bars.some((bar, index) => index > 0 && bar.openTime !== bars[index - 1].openTime + interval))
        return no('MISSING_OR_UNALIGNED_DATA');
    }
    const one = this.technical(history['1m']);
    const five = this.technical(history['5m']);
    const hour = this.technical(history['1h']);
    const priorHour = this.technical(history['1h'].slice(0, -parameters.trendSlopeHours));
    if (!one || !five || !hour || !priorHour) return no('MISSING_INDICATORS');
    const currentFive = history['5m'].at(-1)!;
    const previousFive = history['5m'].at(-2)!;
    const priorMinute = history['1m'].at(-2)!;
    const pullbackHigh = Math.max(...history['5m'].slice(-parameters.pullbackLookback5m - 1, -1).map((bar) => bar.high));
    const pullbackAtr = (pullbackHigh - currentFive.close) / five.atr;
    const atrFraction = five.atr / last.close;
    const range5m = rangePosition(history['5m'].slice(-20), currentFive.close);
    const range1m = rangePosition(history['1m'].slice(-20), last.close);
    const structuralStop = Math.min(...history['5m'].slice(-parameters.swingLookback5m).map((bar) => bar.low)) - parameters.swingBufferAtr * five.atr;
    const stopPrice = Math.min(structuralStop, last.close - parameters.stopAtr5m * five.atr);
    const riskPerUnit = last.close - stopPrice;
    // Price the target after estimated round-trip quote commissions, so the
    // configured reward/risk multiple is net of those commissions rather than
    // a misleading gross chart distance.
    const marketImpact = (config.spreadBps / 2 + config.slippageBps) / 10000;
    const entryCostPerUnit = last.close * (1 + marketImpact) * (1 + config.feeRate);
    const stopProceedsPerUnit = stopPrice * (1 - marketImpact) * (1 - config.feeRate);
    // Leave two ticks of room for protective price rounding during execution.
    const targetPrice = (entryCostPerUnit + parameters.targetRiskMultiple * (entryCostPerUnit - stopProceedsPerUnit)) / (1 - config.feeRate) + 2 * config.tickSize;
    const conditions: Record<string, boolean> = {
      primaryTrend: hour.ema12 > hour.ema26 && hour.sma21 > hour.sma50 && history['1h'].at(-1)!.close > hour.sma21 && hour.sma21 > priorHour.sma21,
      pullback: pullbackAtr >= parameters.minPullbackAtr && pullbackAtr <= parameters.maxPullbackAtr,
      recovery5m: currentFive.close > currentFive.open && currentFive.close > previousFive.close,
      recovery1m: last.close > last.open && last.close > priorMinute.high,
      notExtended: range5m <= parameters.maxRangePosition5m && range1m <= parameters.maxRangePosition1m,
      volatility: atrFraction >= parameters.minAtr5mFraction && atrFraction <= parameters.maxAtr5mFraction,
      stopGeometry: stopPrice > 0 && stopPrice < last.close && riskPerUnit / last.close <= config.maxStopPercent,
      rewardRisk: targetPrice > last.close && (targetPrice - last.close) / riskPerUnit >= parameters.targetRiskMultiple,
    };
    const features = { atr5m: five.atr, atr5mFraction: atrFraction, pullbackAtr, range5m, range1m, stopPrice, targetPrice, rewardRisk: riskPerUnit > 0 ? (targetPrice - last.close) / riskPerUnit : 0 };
    const failed = Object.keys(conditions).filter((key) => !conditions[key]);
    if (failed.length) return no(failed.map((key) => `NO_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`).join('|'), conditions, features);
    const id = createHash('sha256').update(`btc-v4:${BTC_V4_REVISION}:BTCUSDT:${at}`).digest('hex');
    const signal: MarketSignal = {
      id,
      strategy: 'btc-v4',
      strategyRevision: BTC_V4_REVISION,
      symbol: 'BTCUSDT',
      candleTime: at,
      referencePrice: last.close,
      atr: five.atr,
      swingLow: stopPrice,
      regime: 'up',
      conditions,
      config: { ...config, btcV4: parameters },
      protection: { stopPrice: floorStep(stopPrice, config.tickSize).toNumber(), targetPrice: floorStep(targetPrice, config.tickSize).toNumber(), horizonMs: parameters.horizonMinutes * 60000, timeframe: '5m' },
    };
    return { at, decision: 'BUY', reason: 'TREND_PULLBACK_RECOVERY', conditions, features, signal };
  }
}

export const validV4Parameters = (parameters: BtcV4Parameters): boolean =>
  parameters.revision === BTC_V4_REVISION &&
  Object.entries(parameters).every(([key, value]) => key === 'revision' || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) &&
  Number.isInteger(parameters.trendSlopeHours) && parameters.trendSlopeHours >= 1 && parameters.trendSlopeHours <= 10 &&
  Number.isInteger(parameters.pullbackLookback5m) && parameters.pullbackLookback5m >= 3 && parameters.pullbackLookback5m <= 40 &&
  parameters.minPullbackAtr < parameters.maxPullbackAtr && parameters.stopAtr5m > 0 && parameters.targetRiskMultiple >= 1.25 && parameters.maxConsecutiveStopLosses >= 1 && Number.isInteger(parameters.maxConsecutiveStopLosses);
