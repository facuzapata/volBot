import { createHash } from 'crypto';
import type { MarketHistory, Technical } from './strategy-engine';
import { Candle, MarketSignal, SimulationConfig } from '../domain/model';
import { BtcV3Parameters, DEFAULT_BTC_V3, BTC_V3_REVISION, v3ParametersHash } from './btc-v3.config';
import { executionPrice, floorStep } from '../execution/pricing';

export interface V3Assessment {
  at:number;decision:'BUY'|'NO_TRADE';reason:string;structuralEligible:boolean;
  conditions:Record<string,boolean>;features?:{atr5m:number;atr5mFraction:number;pullbackAtr:number;range5m:number;range1m:number;stopPrice:number;targetPrice:number;breakEven:number};
  signal?:MarketSignal;
}
const rangePosition=(bars:Candle[],price:number)=>{const hi=Math.max(...bars.map(c=>c.high)),lo=Math.min(...bars.map(c=>c.low));return hi>lo?(price-lo)/(hi-lo):1};
export class BtcV3Strategy {
  constructor(private readonly technical:(bars:Candle[])=>Technical|null){}
  assess(input:MarketHistory,c:SimulationConfig):V3Assessment{
    const last=input['1m'].at(-1),at=last?.closeTime??0,p={...DEFAULT_BTC_V3,...c.btcV3};
    const no=(reason:string,conditions:Record<string,boolean>={},features?:V3Assessment['features'],structuralEligible=false):V3Assessment=>({at,decision:'NO_TRADE',reason,conditions,features,structuralEligible});
    if(!last)return no('MISSING_CLOSED_DATA');
    const h=Object.fromEntries((['1m','5m','1h'] as const).map(tf=>[tf,input[tf].filter(b=>b.closeTime<=at).slice(-100)])) as MarketHistory;
    for(const [tf,step]of [['1m',60000],['5m',300000],['1h',3600000]] as const){const bars=h[tf];if(bars.length<50+p.trendSlopeHours||bars.at(-1)!.closeTime!==Math.floor((at+1)/step)*step-1||bars.some((b,i)=>i>0&&b.openTime!==bars[i-1].openTime+step))return no('MISSING_OR_UNALIGNED_DATA');}
    const one=this.technical(h['1m']),five=this.technical(h['5m']),hour=this.technical(h['1h']),priorHour=this.technical(h['1h'].slice(0,-p.trendSlopeHours));
    if(!one||!five||!hour||!priorHour)return no('MISSING_INDICATORS');
    const currentFive=h['5m'].at(-1)!,previousFive=h['5m'].at(-2)!,prevMinute=h['1m'].at(-2)!;
    const high=Math.max(...h['5m'].slice(-p.pullbackLookback5m-1,-1).map(b=>b.high));
    const atr=five.atr,atrFraction=atr/last.close,pullback=(high-currentFive.close)/atr;
    const r5=rangePosition(h['5m'].slice(-20),currentFive.close),r1=rangePosition(h['1m'],last.close);
    const stop=Math.min(...h['5m'].slice(-p.swingLookback5m).map(b=>b.low))-p.swingBufferAtr*atr;
    const stopPrice=Math.min(stop,last.close-p.stopAtr5m*atr),targetPrice=last.close+p.targetAtr5m*atr;
    const buy=executionPrice(last.close,'BUY',c),requiredSell=buy.mul(1+c.feeRate).div(1-c.feeRate).div(c.tickSize).ceil().mul(c.tickSize);
    const breakEven=requiredSell.div(1-(c.spreadBps/2+c.slippageBps)/10000).div(last.close).minus(1).toNumber();
    const conditions:Record<string,boolean>={primaryTrend:hour.ema12>hour.ema26&&hour.sma21>hour.sma50&&h['1h'].at(-1)!.close>hour.sma21&&hour.sma21>priorHour.sma21,pullback:pullback>=p.minPullbackAtr&&pullback<=p.maxPullbackAtr,recovery5m:currentFive.close>currentFive.open&&currentFive.close>previousFive.close,notExtended:r5<=p.maxRangePosition5m&&r1<=p.maxRangePosition1m,volatility:atrFraction>=p.minAtr5mFraction&&atrFraction<=p.maxAtr5mFraction,recovery1m:last.close>last.open&&last.close>prevMinute.high,stopGeometry:stopPrice>0&&stopPrice<last.close&&(last.close-stopPrice)/last.close<=c.maxStopPercent};
    const features={atr5m:atr,atr5mFraction:atrFraction,pullbackAtr:pullback,range5m:r5,range1m:r1,stopPrice,targetPrice,breakEven};
    const structuralEligible=Object.values(conditions).every(Boolean);
    if(!structuralEligible)return no(Object.keys(conditions).filter(k=>!conditions[k]).map(k=>'NO_'+k.toUpperCase()).join('|'),conditions,features);
    const model=c.btcV3Calibration;
    if(!model||model.revision!==BTC_V3_REVISION)return no('NO_CALIBRATION',conditions,features,true);
    if(model.parametersHash!==v3ParametersHash(p)||model.horizonMinutes!==p.horizonMinutes)return no('CALIBRATION_PARAMETERS_MISMATCH',conditions,features,true);
    if(model.trainedThrough>=at)return no('CALIBRATION_NOT_PRIOR',conditions,features,true);
    const bin=model.bins.find(b=>atrFraction>=b.low&&atrFraction<b.high);
    if(!bin||bin.samples<p.minCalibrationSamples||bin.days<p.minCalibrationDays||![bin.meanReturnLower95,bin.mfeP25,bin.meanReturn].every(Number.isFinite))return no('INSUFFICIENT_CALIBRATION',conditions,features,true);
    if(bin.meanReturnLower95<=breakEven+p.economicMargin||bin.mfeP25<=breakEven+p.economicMargin)return no('NO_NET_EDGE_ESTIMATE',conditions,features,true);
    conditions.calibratedEconomics=true;
    const id=createHash('sha256').update(`btc-v3:${BTC_V3_REVISION}:BTCUSDT:${at}`).digest('hex');
    const signal:MarketSignal={id,strategy:'btc-v3',strategyRevision:BTC_V3_REVISION,symbol:'BTCUSDT',candleTime:at,referencePrice:last.close,atr,swingLow:stopPrice,regime:'up',conditions,config:{...c,btcV3:p},protection:{stopPrice:floorStep(stopPrice,c.tickSize).toNumber(),targetPrice,horizonMs:p.horizonMinutes*60000,timeframe:'5m'},forecast:{calibrationId:model.id,sampleCount:bin.samples,expectedGrossReturn:bin.meanReturn,expectedGrossLower95:bin.meanReturnLower95,favorablePotentialP25:bin.mfeP25,roundTripBreakEven:breakEven}};
    return{at,decision:'BUY',reason:'CALIBRATED_PULLBACK_RECOVERY',conditions,features,structuralEligible:true,signal};
  }
}
export function validV3Parameters(p:BtcV3Parameters):boolean {
  return p.revision===BTC_V3_REVISION&&Object.entries(p).every(([k,v])=>k==='revision'||typeof v==='number'&&Number.isFinite(v)&&v>=0)&&p.horizonMinutes>=5&&p.horizonMinutes<=1440&&p.pullbackLookback5m>=2&&p.pullbackLookback5m<=40&&Number.isInteger(p.pullbackLookback5m)&&p.trendSlopeHours>=1&&p.trendSlopeHours<=10&&Number.isInteger(p.trendSlopeHours)&&p.swingLookback5m>=2&&p.swingLookback5m<=40&&Number.isInteger(p.swingLookback5m)&&p.maxRangePosition1m<=1&&p.maxRangePosition5m<=1&&p.minPullbackAtr<p.maxPullbackAtr&&p.minAtr5mFraction<p.maxAtr5mFraction&&p.stopAtr5m>0&&p.targetAtr5m>0&&p.minCalibrationSamples>=20&&p.minCalibrationDays>=5;
}
