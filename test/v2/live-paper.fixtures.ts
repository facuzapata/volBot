import {Candle,DEFAULT_SIMULATION} from '../../src/v2/domain/model';
import {BOT_IDS,Experiment,FeedState,Quote,experimentConfig} from '../../src/v2/live-paper/model';
import {ProspectiveKernel} from '../../src/v2/live-paper/kernel';
export function liveFixture(){
 const n=24000,start=Date.UTC(2024,0,1),history:Candle[]=Array.from({length:n},(_,i)=>{const p=10000+i*.01+(i>=n-60?(i-(n-60))*2.6:0);return {symbol:'BTCUSDT',timeframe:'1m',openTime:start+i*60000,closeTime:start+i*60000+59999,open:p,high:p+1,low:p-1,close:p+.005,volume:1000};});
 history[n-1].low=10000;
 const time=history.at(-1)!.closeTime,filters={stepSize:DEFAULT_SIMULATION.stepSize,tickSize:DEFAULT_SIMULATION.tickSize,minQty:DEFAULT_SIMULATION.minQty,minNotional:DEFAULT_SIMULATION.minNotional},config=experimentConfig(filters),kernel=new ProspectiveKernel();
 const e=kernel.create('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',config,time-1000);
 e.authorization={scope:'PAPER_ONLY',at:time-1000,by:e.ownerId,configHash:e.configHash};e.phase='RUNNING';e.startedAt=time-1000;e.endsAt=e.startedAt+30*86400000;e.lastQuoteAt=e.startedAt;e.lastCandle=history.at(-2)!.closeTime;for(const id of BOT_IDS){e.bots[id].paused=false;e.bots[id].reason='';}
 function quote(sequence:number,at=time+sequence*1000,mid=history.at(-1)!.close+1,depth=100):Quote{return {id:`BTCUSDT:${sequence}`,sequence,bid:mid-1,ask:mid+1,bidQty:depth,askQty:depth,receivedAt:at,exchangeTime:at-10};}
 function feed(q:Quote):FeedState{return {connected:true,marketReady:true,redis:true,kafka:true,filters,filtersAt:q.receivedAt,updatedAt:q.receivedAt,lastTradeAt:q.exchangeTime,lastQuoteAt:q.receivedAt,lastCandleAt:history.at(-1)!.closeTime,error:null};}
 function apply(state:Experiment,q:Quote,usedVolume=0,override?:Partial<FeedState>){const minute=Math.floor(q.receivedAt/60000)*60000;return kernel.apply(state,{quote:q,now:q.receivedAt,feed:{...feed(q),...override},history:history.filter(c=>c.closeTime<q.receivedAt),prior:history.find(c=>c.openTime===minute-60000),usedVolume});}
 return {history,time,e,kernel,quote,feed,apply,filters};
}
