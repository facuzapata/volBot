import { createHash } from 'crypto';
import * as indicators from '../../utils/indicators';
import { floorStep } from '../execution/pricing';
import { Candle, MarketSignal, SimulationConfig } from '../domain/model';
import type { MarketHistory } from './strategy-engine';
import {
  BtcV5Parameters,
  BTC_V5_REVISION,
  DEFAULT_BTC_V5,
  BTC_V5_FIVE_MINUTE_HISTORY,
} from './btc-v5.config';
import { strategyConfiguration } from './versions';
import { fifteenMinuteCloses, TrendClose } from './fifteen-minute-bars';

export interface V5Assessment {
  at: number;
  decision: 'BUY' | 'NO_TRADE';
  reason: string;
  conditions: Record<string, boolean>;
  features?: {
    atr5m: number;
    atrFraction: number;
    trendTimeframe: '15m' | '1h';
    trendEmaFast: number;
    trendEmaSlow: number;
    ema1hFast?: number;
    ema1hSlow?: number;
    ema5mFast: number;
    ema5mSlow: number;
    entryEma: number;
    stopPrice: number;
    targetPrice: number;
    rewardRisk: number;
    netRewardRisk: number;
    estimatedRoundTripCostFraction: number;
    netTargetFraction: number;
    bandLower: number;
    bandMiddle: number;
    bandUpper: number;
    minimumTargetPrice: number;
    stopLossEnabled: boolean;
    referenceStopPrice: number;
  };
  signal?: MarketSignal;
}

const MINUTE = 60000;

/** PAPER hypothesis: 15m trend, confirmed 5m oversold recovery, 1m entry. */
export class BtcV5Strategy {
  private trendCache?: { first: Candle; last: Candle; length: number; closes: TrendClose[] };
  assess(input: MarketHistory, config: SimulationConfig): V5Assessment {
    config = strategyConfiguration('btc-v5', config);
    const last = input['1m'].at(-1);
    const at = last?.closeTime ?? 0;
    const p = { ...DEFAULT_BTC_V5, ...config.btcV5 };
    const targetOnly = p.exitMode === 'TARGET_ONLY';
    const no = (
      reason: string,
      conditions: Record<string, boolean> = {},
      features?: V5Assessment['features'],
    ): V5Assessment => ({ at, decision: 'NO_TRADE', reason, conditions, features });
    if (!last) return no('MISSING_CLOSED_DATA');
    if (!validV5Parameters(p)) return no('INVALID_BTC_V5_CONFIG');
    const hours = input['1h'].filter((bar) => bar.closeTime <= at).slice(-100);
    const fiveSource = input['5m']
      .filter((bar) => bar.closeTime <= at)
      .slice(-BTC_V5_FIVE_MINUTE_HISTORY);
    const fives = fiveSource.slice(-100);
    const minutes = input['1m'].filter((bar) => bar.closeTime <= at).slice(-100);
    const aligned = (bars: readonly Pick<Candle, 'openTime' | 'closeTime'>[], step: number) =>
      bars.every(
        (bar, index) =>
          bar.openTime % step === 0 &&
          bar.closeTime === bar.openTime + step - 1 &&
          (index === 0 || bar.openTime === bars[index - 1].openTime + step),
      );
    if (
      fives.length <
        Math.max(p.setupEmaSlow + 1, p.reversionPeriod + 1, 15, p.setupPullbackBars + 1) ||
      minutes.length < p.entryEmaPeriod + p.entryPullbackMinutes + 1 ||
      !aligned(fiveSource, 5 * MINUTE) ||
      !aligned(minutes, MINUTE) ||
      at - fives.at(-1)!.closeTime >= 5 * MINUTE
    )
      return no('MISSING_OR_UNALIGNED_DATA');
    let trend: readonly TrendClose[] = hours;
    if (p.trendMinutes === 15) {
      // Closed market candles are immutable; reuse the aggregate within the same 5m bar.
      const cached = this.trendCache;
      const closes =
        cached &&
        cached.first === fiveSource[0] &&
        cached.last === fiveSource.at(-1) &&
        cached.length === fiveSource.length
          ? cached.closes
          : fifteenMinuteCloses(fiveSource).slice(-100);
      this.trendCache = {
        first: fiveSource[0],
        last: fiveSource.at(-1)!,
        length: fiveSource.length,
        closes,
      };
      trend = closes;
    }
    const trendStep = p.trendMinutes * MINUTE;
    if (
      trend.length < p.trendEmaSlow + 1 ||
      !aligned(trend, trendStep) ||
      at - trend.at(-1)!.closeTime >= trendStep
    )
      return no('MISSING_OR_UNALIGNED_DATA');
    const ema = (bars: readonly Pick<Candle, 'close'>[], period: number) =>
      indicators.calculateEMA(
        bars.map((bar) => bar.close),
        period,
      )!;
    const trendEmaFast = ema(trend, p.trendEmaFast);
    const trendEmaSlow = ema(trend, p.trendEmaSlow);
    const ema5mFast = ema(fives, p.setupEmaFast);
    const ema5mSlow = ema(fives, p.setupEmaSlow);
    const entryEma = ema(minutes, p.entryEmaPeriod);
    const atr = indicators.calculateATR(fives, 14);
    // Freeze the range before the recovery candle. It cannot move the target in its own favor.
    const bands = indicators.calculateBollingerBands(
      fives.slice(0, -1).map((bar) => bar.close),
      p.reversionPeriod,
      p.reversionStdDev,
    );
    if (
      atr === null ||
      atr <= 0 ||
      !bands ||
      ![trendEmaFast, trendEmaSlow, ema5mFast, ema5mSlow, entryEma].every(Number.isFinite)
    )
      return no('MISSING_INDICATORS');
    const entryPrice = last.close;
    const setupWindow = fives.slice(-p.setupPullbackBars);
    const minuteWindow = minutes.slice(-(p.entryPullbackMinutes + 1), -1);
    const swingLow = Math.min(...fives.slice(-p.setupPullbackBars).map((bar) => bar.low));
    const stopPrice = floorStep(
      Math.min(
        swingLow - p.swingBufferAtr * atr,
        entryPrice - Math.max(p.stopAtr5m * atr, p.minStopFraction * entryPrice),
      ),
      config.tickSize,
    ).toNumber();
    const riskPerUnit = entryPrice - stopPrice;
    const impact = (config.spreadBps / 2 + config.slippageBps) / 10000;
    // Charge impact on both sides, including target exits. Execution rechecks actual fills and rounding.
    const entryCost = entryPrice * (1 + impact) * (1 + config.feeRate);
    const sellFactor = (1 - impact) * (1 - config.feeRate);
    const netStopLoss = entryCost - stopPrice * sellFactor;
    const requiredProfit = Math.max(
      p.targetRiskMultiple * netStopLoss,
      entryPrice * p.minNetTargetFraction,
    );
    const minimumTargetPrice = (entryCost + requiredProfit) / sellFactor + 2 * config.tickSize;
    // Do not invent a farther target to make the reward/risk test pass.
    const targetPrice = floorStep(
      Math.min(bands.upper, entryPrice * (1 + p.maxTargetFraction)),
      config.tickSize,
    ).toNumber();
    const netTarget = targetPrice * sellFactor - entryCost;
    const netRewardRisk = netStopLoss > 0 ? netTarget / netStopLoss : 0;
    const five = fives.at(-1)!;
    const conditions: Record<string, boolean> = {
      [p.trendMinutes === 15 ? 'trend15m' : 'trend1h']:
        trendEmaFast > trendEmaSlow && trend.at(-1)!.close > trendEmaSlow,
      oversoldReclaim5m:
        Math.min(...setupWindow.map((bar) => bar.low)) <= bands.lower &&
        five.close > bands.lower &&
        five.close > five.open &&
        five.close > fives.at(-2)!.close,
      recovery1m:
        last.close > last.open &&
        last.close > minutes.at(-2)!.high &&
        last.close > entryEma &&
        Math.min(...minuteWindow.map((bar) => bar.low)) <= entryEma,
      notExtended:
        entryPrice > bands.lower &&
        entryPrice < bands.middle &&
        Math.abs(entryPrice - five.close) <= p.maxEntryExtensionAtr * atr,
      volatility: atr / entryPrice >= p.minAtr5mFraction && atr / entryPrice <= p.maxAtr5mFraction,
      [targetOnly ? 'referenceGeometry' : 'stopGeometry']:
        stopPrice > 0 &&
        stopPrice < entryPrice &&
        riskPerUnit / entryPrice <= config.maxStopPercent,
      costCoverage:
        netTarget / entryPrice >= p.minNetTargetFraction &&
        targetPrice <= entryPrice * (1 + p.maxTargetFraction),
      [targetOnly ? 'referenceRewardRisk' : 'rewardRisk']: netRewardRisk >= p.targetRiskMultiple,
      targetRoom: targetPrice >= minimumTargetPrice,
      // Retained for the post-loss quality gate in RiskPolicy.
      recoveryQuality: five.close > five.open && last.close > minutes.at(-2)!.high,
    };
    const features = {
      atr5m: atr,
      atrFraction: atr / entryPrice,
      trendTimeframe: p.trendMinutes === 15 ? ('15m' as const) : ('1h' as const),
      trendEmaFast,
      trendEmaSlow,
      ...(p.trendMinutes === 60 ? { ema1hFast: trendEmaFast, ema1hSlow: trendEmaSlow } : {}),
      ema5mFast,
      ema5mSlow,
      entryEma,
      stopPrice: targetOnly ? 0 : stopPrice,
      targetPrice,
      rewardRisk: riskPerUnit > 0 ? (targetPrice - entryPrice) / riskPerUnit : 0,
      netRewardRisk,
      estimatedRoundTripCostFraction: (entryCost - entryPrice * sellFactor) / entryPrice,
      netTargetFraction: netTarget / entryPrice,
      bandLower: bands.lower,
      bandMiddle: bands.middle,
      bandUpper: bands.upper,
      minimumTargetPrice,
      stopLossEnabled: !targetOnly,
      referenceStopPrice: stopPrice,
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
    const id = createHash('sha256').update(`btc-v5:${BTC_V5_REVISION}:BTCUSDT:${at}`).digest('hex');
    const signal: MarketSignal = {
      id,
      strategy: 'btc-v5',
      strategyRevision: BTC_V5_REVISION,
      symbol: 'BTCUSDT',
      candleTime: at,
      referencePrice: entryPrice,
      atr,
      swingLow: stopPrice,
      regime: 'up',
      conditions,
      config: { ...config, btcV5: p },
      protection: {
        stopPrice: targetOnly ? 0 : stopPrice,
        targetPrice,
        horizonMs: targetOnly ? 0 : p.horizonMinutes * MINUTE,
        timeframe: '5m',
        exitMode: p.exitMode,
      },
    };
    return {
      at,
      decision: 'BUY',
      reason: 'OVERSOLD_RECLAIM_5M_RECOVERY_1M',
      conditions,
      features,
      signal,
    };
  }
}

export const validV5Parameters = (p: BtcV5Parameters): boolean =>
  p.revision === BTC_V5_REVISION &&
  ['STOP_TARGET', 'TARGET_ONLY'].includes(p.exitMode) &&
  [15, 60].includes(p.trendMinutes) &&
  Object.keys(DEFAULT_BTC_V5).every(
    (key) =>
      key === 'revision' ||
      key === 'exitMode' ||
      (typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] >= 0),
  ) &&
  Object.keys(p).every((key) => Object.hasOwn(DEFAULT_BTC_V5, key)) &&
  Number.isInteger(p.horizonMinutes) &&
  p.horizonMinutes >= 15 &&
  p.horizonMinutes <= 360 &&
  [p.trendEmaFast, p.trendEmaSlow, p.setupEmaFast, p.setupEmaSlow, p.entryEmaPeriod].every(
    (n) => Number.isInteger(n) && n >= 3 && n <= 50,
  ) &&
  p.trendEmaFast < p.trendEmaSlow &&
  p.setupEmaFast < p.setupEmaSlow &&
  Number.isInteger(p.reversionPeriod) &&
  p.reversionPeriod >= 10 &&
  p.reversionPeriod <= 50 &&
  p.reversionStdDev >= 1 &&
  p.reversionStdDev <= 3 &&
  Number.isInteger(p.setupPullbackBars) &&
  p.setupPullbackBars >= 2 &&
  p.setupPullbackBars <= 12 &&
  Number.isInteger(p.entryPullbackMinutes) &&
  p.entryPullbackMinutes >= 2 &&
  p.entryPullbackMinutes <= 30 &&
  p.stopAtr5m > 0 &&
  p.minStopFraction > 0 &&
  p.minStopFraction < p.maxTargetFraction &&
  p.targetRiskMultiple >= 1.25 &&
  p.minNetTargetFraction > 0 &&
  p.maxTargetFraction <= 0.02 &&
  p.maxEntryExtensionAtr > 0 &&
  p.minAtr5mFraction > 0 &&
  p.minAtr5mFraction < p.maxAtr5mFraction &&
  Number.isInteger(p.maxConsecutiveStopLosses) &&
  p.maxConsecutiveStopLosses >= 1 &&
  Number.isInteger(p.cooldownMinutes) &&
  p.cooldownMinutes >= 1 &&
  Number.isInteger(p.stopCooldownMinutes) &&
  p.stopCooldownMinutes >= p.cooldownMinutes &&
  Number.isInteger(p.maxDailyEntries) &&
  p.maxDailyEntries >= 1 &&
  p.maxDailyEntries <= 24 &&
  p.maxCapitalLossFraction > 0 &&
  p.maxCapitalLossFraction <= 0.02;
