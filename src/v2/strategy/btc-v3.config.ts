import { createHash } from 'crypto';
export const BTC_V3_REVISION='2026-11-20.v3.1';
export interface BtcV3Parameters {
  revision:string; horizonMinutes:number; pullbackLookback5m:number;
  minPullbackAtr:number; maxPullbackAtr:number; maxRangePosition5m:number; maxRangePosition1m:number;
  minAtr5mFraction:number; maxAtr5mFraction:number; trendSlopeHours:number;
  stopAtr5m:number; swingLookback5m:number; swingBufferAtr:number; targetAtr5m:number;
  economicMargin:number; minCalibrationSamples:number; minCalibrationDays:number;
}
export const DEFAULT_BTC_V3:Readonly<BtcV3Parameters>={revision:BTC_V3_REVISION,horizonMinutes:60,pullbackLookback5m:12,minPullbackAtr:.5,maxPullbackAtr:2.5,maxRangePosition5m:.75,maxRangePosition1m:.8,minAtr5mFraction:.001,maxAtr5mFraction:.015,trendSlopeHours:3,stopAtr5m:1.5,swingLookback5m:6,swingBufferAtr:.1,targetAtr5m:2,economicMargin:.0005,minCalibrationSamples:20,minCalibrationDays:5};
export interface CalibrationBin {low:number;high:number;samples:number;days:number;meanReturn:number;meanReturnLower95:number;mfeP25:number}
export interface BtcV3Calibration {id:string;revision:string;parametersHash:string;horizonMinutes:number;trainedThrough:number;trainingHash:string;bins:CalibrationBin[]}
export const v3ParametersHash=(p:BtcV3Parameters):string=>createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
