import { createHash } from 'crypto';

export const BTC_V6_REVISION = '2026-11-23.v6.3';

export interface BtcV6Parameters {
  revision: string;
  exitMode: 'TARGET_ONLY';
  targetFraction: number;
  minNetTargetFraction: number;
  trendEmaFast: number;
  trendEmaSlow: number;
  resistanceMinutes: number;
  breakoutAtr: number;
  maxBreakoutAtr: number;
  minImpulseAtr: number;
  minVolumeMultiple: number;
  minAtrFraction: number;
  maxAtrFraction: number;
}

export const DEFAULT_BTC_V6: Readonly<BtcV6Parameters> = {
  revision: BTC_V6_REVISION,
  exitMode: 'TARGET_ONLY',
  targetFraction: 0.004,
  minNetTargetFraction: 0.001,
  trendEmaFast: 9,
  trendEmaSlow: 21,
  resistanceMinutes: 20,
  breakoutAtr: 0.2,
  maxBreakoutAtr: 2.5,
  minImpulseAtr: 0.5,
  minVolumeMultiple: 1.5,
  minAtrFraction: 0.0002,
  maxAtrFraction: 0.012,
};

export const validV6Parameters = (p: BtcV6Parameters): boolean =>
  p.revision === BTC_V6_REVISION &&
  p.exitMode === 'TARGET_ONLY' &&
  Object.keys(p).every((key) => Object.hasOwn(DEFAULT_BTC_V6, key)) &&
  Object.keys(DEFAULT_BTC_V6).every((key) =>
    key === 'revision' || key === 'exitMode'
      ? true
      : typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] > 0,
  ) &&
  Number.isInteger(p.trendEmaFast) &&
  Number.isInteger(p.trendEmaSlow) &&
  p.trendEmaFast < p.trendEmaSlow &&
  Number.isInteger(p.resistanceMinutes) &&
  p.resistanceMinutes >= 15 &&
  p.resistanceMinutes <= 120 &&
  p.targetFraction <= 0.02 &&
  p.minNetTargetFraction < p.targetFraction &&
  p.breakoutAtr < p.maxBreakoutAtr &&
  p.minAtrFraction < p.maxAtrFraction;

export const v6ParametersHash = (parameters: BtcV6Parameters): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)))))
    .digest('hex');
