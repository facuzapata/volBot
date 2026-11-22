import { createHash } from 'crypto';

/** Fixed PAPER hypothesis; changing parameters requires a new revision and replay. */
export const BTC_V5_REVISION = '2026-11-22.v5.7';
/** Enough 5m candles for 100 complete 15m trend bars plus partial edge buckets. */
export const BTC_V5_FIVE_MINUTE_HISTORY = 320;

export interface BtcV5Parameters {
  revision: string;
  exitMode: 'STOP_TARGET' | 'TARGET_ONLY';
  trendMinutes: 15 | 60;
  horizonMinutes: number;
  trendEmaFast: number;
  trendEmaSlow: number;
  setupEmaFast: number;
  setupEmaSlow: number;
  reversionPeriod: number;
  reversionStdDev: number;
  setupPullbackBars: number;
  entryEmaPeriod: number;
  entryPullbackMinutes: number;
  stopAtr5m: number;
  swingBufferAtr: number;
  minStopFraction: number;
  targetRiskMultiple: number;
  minNetTargetFraction: number;
  maxTargetFraction: number;
  maxEntryExtensionAtr: number;
  minAtr5mFraction: number;
  maxAtr5mFraction: number;
  maxConsecutiveStopLosses: number;
  cooldownMinutes: number;
  stopCooldownMinutes: number;
  maxDailyEntries: number;
  maxCapitalLossFraction: number;
}

export const DEFAULT_BTC_V5: Readonly<BtcV5Parameters> = {
  revision: BTC_V5_REVISION,
  exitMode: 'TARGET_ONLY',
  trendMinutes: 15,
  horizonMinutes: 360,
  trendEmaFast: 20,
  trendEmaSlow: 50,
  setupEmaFast: 9,
  setupEmaSlow: 21,
  reversionPeriod: 20,
  reversionStdDev: 2,
  setupPullbackBars: 3,
  entryEmaPeriod: 9,
  entryPullbackMinutes: 5,
  stopAtr5m: 1.5,
  swingBufferAtr: 0.1,
  minStopFraction: 0.002,
  targetRiskMultiple: 1.25,
  minNetTargetFraction: 0.002,
  maxTargetFraction: 0.012,
  maxEntryExtensionAtr: 1,
  minAtr5mFraction: 0.0005,
  maxAtr5mFraction: 0.004,
  maxConsecutiveStopLosses: 2,
  cooldownMinutes: 15,
  stopCooldownMinutes: 60,
  maxDailyEntries: 6,
  maxCapitalLossFraction: 0.02,
};

export const v5ParametersHash = (parameters: BtcV5Parameters): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))),
      ),
    )
    .digest('hex');
