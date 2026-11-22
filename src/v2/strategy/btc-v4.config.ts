import { createHash } from 'crypto';

export const BTC_V4_REVISION = '2026-11-22.v4.1';

export interface BtcV4Parameters {
  revision: string;
  horizonMinutes: number;
  trendSlopeHours: number;
  pullbackLookback5m: number;
  minPullbackAtr: number;
  maxPullbackAtr: number;
  swingLookback5m: number;
  swingBufferAtr: number;
  stopAtr5m: number;
  targetRiskMultiple: number;
  maxRangePosition5m: number;
  maxRangePosition1m: number;
  minAtr5mFraction: number;
  maxAtr5mFraction: number;
  maxConsecutiveStopLosses: number;
}

/** Frozen PAPER candidate. Changes require a new revision and separate replay. */
export const DEFAULT_BTC_V4: Readonly<BtcV4Parameters> = {
  revision: BTC_V4_REVISION,
  horizonMinutes: 240,
  trendSlopeHours: 3,
  pullbackLookback5m: 12,
  minPullbackAtr: 0.5,
  maxPullbackAtr: 1.8,
  swingLookback5m: 6,
  swingBufferAtr: 0.15,
  stopAtr5m: 1.5,
  targetRiskMultiple: 1.8,
  maxRangePosition5m: 0.72,
  maxRangePosition1m: 0.8,
  minAtr5mFraction: 0.001,
  maxAtr5mFraction: 0.012,
  maxConsecutiveStopLosses: 3,
};

export const v4ParametersHash = (parameters: BtcV4Parameters): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)))))
    .digest('hex');
