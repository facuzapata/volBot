import {Candle,MarketSignal} from '../domain/model';
import * as I from '../../utils/indicators';
import {BotId,ExperimentConfig,fingerprint} from './model';
/** Identical 100 closed-bar window, simple RSI/ATR/EMA definitions and warmup as frozen research. */
export function aggregate(minutes:Candle[],hours:number):Candle[]{
 const step=hours*3600000,output:Candle[]=[];let bucket:Candle[]=[];
 for(const c of minutes){const start=Math.floor(c.openTime/step)*step;if(bucket.length&&Math.floor(bucket[0].openTime/step)*step!==start)bucket=[];bucket.push(c);
  if(c.closeTime!==start+step-1)continue;
  if(bucket.length===hours*60&&bucket[0].openTime===start&&bucket.every((b,i)=>b.openTime===start+i*60000))output.push({...c,openTime:start,open:bucket[0].open,high:Math.max(...bucket.map(b=>b.high)),low:Math.min(...bucket.map(b=>b.low)),volume:bucket.reduce((n,b)=>n+b.volume,0)});bucket=[];
 }return output;
}
export function frozenSignal(minutes:Candle[],id:BotId,config:ExperimentConfig,experimentId:string):MarketSignal|null{
 const v=config.strategies[id],bars=aggregate(minutes,v.hours),lastMinute=minutes.at(-1),b=bars.at(-1);
 if(bars.length<60||!b||b.closeTime!==lastMinute?.closeTime)return null;
 const a=bars.slice(-100),cl=a.map(b=>b.close),ema20=I.calculateEMA(cl,20)!,ema50=I.calculateEMA(cl,50)!,atr=I.calculateATR(a,14)!;
 const up=ema20>ema50&&b.close>ema50;
 const eligible=id==='pullback-4h'?up&&b.low<=ema20&&b.close>ema20&&b.close>b.open:up&&b.close/a.at(-13)!.close-1>.01&&a.at(-2)!.close/a.at(-14)!.close-1<=.01;
 const c={...config.execution,maxHoldingMs:v.holdHours*3600000},stop=b.close-v.stopAtr*atr,target=b.close+v.stopAtr*atr*v.rewardRisk,cost=2*c.feeRate+(c.spreadBps+2*c.slippageBps)/10000;
 if(!eligible||!(atr>0)||stop<=0||target/b.close-1<=cost+.0005)return null;
 return {id:fingerprint({experimentId,id,at:b.closeTime}),strategy:'trend-reference',strategyRevision:`frozen-net-usdt-1:${id}`,symbol:'BTCUSDT',candleTime:b.closeTime,referencePrice:b.close,atr,swingLow:stop,regime:'up',conditions:{[id]:true},config:c,protection:{stopPrice:stop,targetPrice:target,horizonMs:c.maxHoldingMs,timeframe:v.hours===4?'4h':'1h'}};
}
