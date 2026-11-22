import { createHash } from 'crypto';

/**
 * Frozen V5 research candidate. It replaces neither V4 nor its evidence.
 * Parameters may only change through a new revision and a new replay.
 */
export const BTC_V5_REVISION = '2026-11-22.v5.1';

export interface BtcV5Parameters {
  revision: string;
  horizonMinutes: number;
  trendEmaFast: number;
  trendEmaSlow: number;
  hourStructureLookback: number;
  fifteenBreakoutLookback: number;
  entryEmaPeriod: number;
  entryPullbackMinutes: number;
  stopAtr1h: number;
  swingBufferAtr: number;
  targetRiskMultiple: number;
  maxEntryExtensionAtr: number;
  minAtr1hFraction: number;
  maxAtr1hFraction: number;
  recoveryVolumeMultiplier: number;
  maxConsecutiveStopLosses: number;
}

export const DEFAULT_BTC_V5: Readonly<BtcV5Parameters> = {
  revision: BTC_V5_REVISION,
  horizonMinutes: 4320,
  trendEmaFast: 20,
  trendEmaSlow: 50,
  hourStructureLookback: 6,
  fifteenBreakoutLookback: 6,
  entryEmaPeriod: 9,
  entryPullbackMinutes: 5,
  stopAtr1h: 1.5,
  swingBufferAtr: 0.1,
  targetRiskMultiple: 2.5,
  maxEntryExtensionAtr: 0.8,
  minAtr1hFraction: 0.001,
  maxAtr1hFraction: 0.05,
  recoveryVolumeMultiplier: 1.1,
  maxConsecutiveStopLosses: 2,
};

export const v5ParametersHash = (parameters: BtcV5Parameters): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)))))
    .digest('hex');
