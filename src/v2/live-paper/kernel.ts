import Decimal from 'decimal.js';
import {newAccount,PaperExecutionAdapter} from '../execution/paper-execution.adapter';
import {RiskPolicy} from '../risk/risk-policy';
import {executionPrice,floorStep} from '../execution/pricing';
import {causalLiquidity} from '../execution/causal-liquidity';
import {isOrderOpen,isPositionOpen,ExchangeOrder} from '../domain/model';
import {statistics} from '../backtesting/backtesting.engine';
import {BOT_IDS,Bot,BotId,Experiment,ExperimentConfig,FeedState,KernelInput,Observation,Quote,fingerprint} from './model';
import {frozenSignal} from './strategies';
const num=(v:string|number)=>Number(v);
export class ProspectiveKernel {
 private readonly autoRecoveryReasons=new Set(['RECOVERED_AFTER_OUTAGE','DEPENDENCY_OR_FEED_UNSAFE','FEED_OR_DEPENDENCY_UNSAFE','STALE_OR_INVALID_QUOTE']);
 constructor(readonly paper=new PaperExecutionAdapter(),private readonly risk=new RiskPolicy()){}
 create(id:string,ownerId:string,config:ExperimentConfig,now:number):Experiment{
  const bots=Object.fromEntries(BOT_IDS.map(bot=>[bot,{id:bot,s:newAccount(`${id}:${bot}`,ownerId,500,1,30),paused:true,reason:'NOT_STARTED',hardHalt:false,peak:500,maxDrawdown:0,maxDailyLoss:0,maxExposure:0,day:'',dayStart:500,lastEquity:500}])) as Record<BotId,Bot>;
  return {id,ownerId,config,configHash:fingerprint(config),phase:'PREPARED',createdAt:now,lastCandle:0,lastQuoteAt:0,bots,passive:{cash:500,btc:0,cost:0,fees:0,spread:0,slippage:0,usedMinute:0,used:0,peak:500,maxDrawdown:0,maxExposure:0}};
 }
 reconcile(bot:Bot):void{
  const s=bot.s;this.paper.assertInvariants(s);
  const cost=s.positions.reduce((n,p)=>n.plus(p.remainingCost),new Decimal(0)),realized=s.positions.reduce((n,p)=>n.plus(p.realizedPnl),new Decimal(0));
  if(new Decimal(s.account.available).plus(s.account.reserved).plus(cost).minus(s.account.initialCapital).minus(realized).abs().gt(1e-7))throw Error('LEDGER_COST_RECONCILIATION');
  const quoteLedger=s.ledger.filter(l=>l.asset==='USDT'),cash=quoteLedger.reduce((n,l)=>n.plus(l.availableDelta),new Decimal(s.account.initialCapital)),reserved=quoteLedger.reduce((n,l)=>n.plus(l.reservedDelta),new Decimal(0));
  if(cash.minus(s.account.available).abs().gt(1e-7)||reserved.minus(s.account.reserved).abs().gt(1e-7))throw Error('LEDGER_BALANCE_RECONCILIATION');
  const bought=s.fills.filter(f=>f.side==='BUY').reduce((n,f)=>n.plus(f.quantity).minus(f.commissionAsset==='BTC'?f.commission:0),new Decimal(0)),sold=s.fills.filter(f=>f.side==='SELL').reduce((n,f)=>n.plus(f.quantity),new Decimal(0)),held=s.positions.reduce((n,p)=>n.plus(p.quantity),new Decimal(0));
  if(bought.minus(sold).minus(held).abs().gt(1e-9))throw Error('LEDGER_BTC_RECONCILIATION');
 }
 pause(e:Experiment,id:BotId,reason:string):void{const b=e.bots[id];b.paused=true;b.reason=reason;b.pending=undefined;b.s.account.entriesEnabled=false;for(const o of b.s.orders.filter(o=>o.side==='BUY'&&isOrderOpen(o)))this.paper.cancel(b.s,o.id,e.lastQuoteAt||Date.now());}
 effective(e:Experiment,q:Quote,feed:FeedState){return {...e.config.execution,...feed.filters,spreadBps:Math.max(e.config.execution.spreadBps,(q.ask-q.bid)/((q.ask+q.bid)/2)*10000)};}
 metrics(e:Experiment,b:Bot,q:Quote,feed:FeedState){
  const s=b.s,c=this.effective(e,q,feed),mid=(q.ask+q.bid)/2,price=executionPrice(mid,'SELL',c).toNumber(),base=statistics(s,mid),qty=s.positions.reduce((n,p)=>n+num(p.quantity),0);
  const value=s.positions.reduce((n,p)=>{const amount=floorStep(p.quantity,c.stepSize).toNumber();return n+(amount>=c.minQty&&amount*price>=c.minNotional?amount*price*(1-c.feeRate):0);},0),remaining=s.positions.reduce((n,p)=>n+num(p.remainingCost),0),equity=num(s.account.available)+num(s.account.reserved)+value;
  return {...base,capital:500,equity,available:num(s.account.available),reserved:num(s.account.reserved),btc:qty,netRealizedPnl:base.netRealizedPnl,unrealizedPnl:value-remaining,netPnl:equity-500,returnPercent:(equity/500-1)*100,spread:s.fills.reduce((n,f)=>n+num(f.spreadCostQuote||0),0),slippage:s.fills.reduce((n,f)=>n+num(f.slippageCostQuote||0),0),wins:s.positions.filter(p=>p.status==='CLOSED'&&num(p.realizedPnl)>0).length,losses:s.positions.filter(p=>p.status==='CLOSED'&&num(p.realizedPnl)<0).length,drawdown:b.peak>0?1-equity/b.peak:0,maxDrawdown:b.maxDrawdown,maxDailyLoss:b.maxDailyLoss,maxExposure:b.maxExposure,asOf:q.receivedAt,priceSource:'observed bid/ask; conservative estimated liquidation',paused:b.paused,pauseReason:b.reason,lastSignal:b.lastSignal,lastTrade:s.fills.at(-1)??null};
 }
 validQuote(q:Quote,now:number,c:ExperimentConfig):boolean{return q.id===`BTCUSDT:${q.sequence}`&&Number.isSafeInteger(q.sequence)&&q.sequence>0&&[q.bid,q.ask,q.bidQty,q.askQty,q.receivedAt,q.exchangeTime].every(Number.isFinite)&&Math.min(q.bid,q.ask,q.bidQty,q.askQty)>0&&q.ask>=q.bid&&now>=q.receivedAt&&now-q.receivedAt<=c.feed.quoteMaxAgeMs&&Math.abs(q.receivedAt-q.exchangeTime)<=c.feed.tradeMaxAgeMs;}
 apply(e:Experiment,input:KernelInput):Observation[]{
  const {quote:q,now,feed,prior,history}=input,events:Observation[]=[];
  if(e.config.mode!=='PAPER'||fingerprint(e.config)!==e.configHash)throw Error('CONFIGURATION_TAMPERED');
  if(!this.validQuote(q,now,e.config))return [{kind:'quote_rejected',at:now,data:{reason:'STALE_OR_INVALID_QUOTE',quoteId:q.id}}];
  if(e.lastQuoteAt>=q.receivedAt)return [];
  if(!e.startedAt||['PREPARED','AUTHORIZED','STOPPED','ENDED'].includes(e.phase))return [];
  const outage=e.lastQuoteAt>0&&q.receivedAt-e.lastQuoteAt>e.config.feed.outageMs;
  e.lastQuoteAt=q.receivedAt;
  const healthy=feed.connected&&feed.marketReady&&feed.redis&&feed.kafka&&now-feed.lastCandleAt<90000&&now-feed.updatedAt<5000;
  const filtersChanged=fingerprint(feed.filters)!==fingerprint({stepSize:e.config.execution.stepSize,tickSize:e.config.execution.tickSize,minQty:e.config.execution.minQty,minNotional:e.config.execution.minNotional});
  if(e.endsAt&&now>=e.endsAt&&e.phase==='RUNNING'){e.phase='STOPPING';for(const id of BOT_IDS)this.pause(e,id,'EXPERIMENT_FINISHED');events.push({kind:'experiment_expired',at:now,data:{scheduledEnd:e.endsAt}});}
  if(outage||!healthy||filtersChanged)e.recoveryHealthySince=undefined;
  else {e.recoveryHealthySince??=now;if(now-e.recoveryHealthySince>=e.config.feed.recoveryStableMs)for(const id of BOT_IDS){const b=e.bots[id];if(b.paused&&!b.hardHalt&&this.autoRecoveryReasons.has(b.reason)){b.paused=false;b.reason='';events.push({kind:'entries_auto_resumed',bot:id,at:now,data:{stableMs:now-e.recoveryHealthySince}});}}}
  for(const id of BOT_IDS){
   const b=e.bots[id];this.reconcile(b);
   if(outage||!healthy||filtersChanged){this.pause(e,id,filtersChanged?'FILTER_CHANGE_REVIEW_REQUIRED':outage?'RECOVERED_AFTER_OUTAGE':'DEPENDENCY_OR_FEED_UNSAFE');events.push({kind:'entries_paused',bot:id,at:now,data:{reason:b.reason}});}
  }
  // Every recovered candle advances the checkpoint, but can never create a retrospective buy.
  const fresh=history.at(-1);
  if(fresh&&fresh.closeTime>e.lastCandle){
   e.lastCandle=fresh.closeTime;
   for(const id of BOT_IDS){const b=e.bots[id],signal=frozenSignal(history,id,e.config,e.id),spec=e.config.strategies[id];
    if((fresh.closeTime+1)%(spec.hours*3600000)!==0)continue;
    const eligible=!!signal&&healthy&&!outage&&!filtersChanged&&!b.paused&&e.phase==='RUNNING'&&fresh.closeTime>=e.startedAt&&now-fresh.closeTime<=e.config.feed.candleSignalMaxAgeMs;
    b.lastSignal={at:fresh.closeTime,knownAt:now,decision:eligible?'BUY':'NO_TRADE',reason:!signal?'STRUCTURE_OR_WARMUP':!eligible?'PAUSED_OR_STALE':'ELIGIBLE'};
    if(eligible)b.pending={signal:signal!,knownAt:now};events.push({kind:'signal',bot:id,at:now,data:{...b.lastSignal,signal:eligible?signal:undefined}});
   }
  }
  const minute=Math.floor(q.receivedAt/60000)*60000,base=causalLiquidity(minute,prior,e.config.execution.participationRate,input.usedVolume);
  const cap=Math.min(Math.max(0,base.capacity-base.used),Math.min(q.bidQty,q.askQty)*e.config.feed.bookParticipation),budget={...base,capacity:base.used+cap};
  for(const id of BOT_IDS){const b=e.bots[id],s=b.s,day=new Date(now).toISOString().slice(0,10);
   if(day!==b.day){b.day=day;b.dayStart=b.lastEquity;s.account.day=day;s.account.dayPnl='0';s.account.dayStartEquity=b.dayStart.toFixed(12);}
   let metric=this.metrics(e,b,q,feed);b.peak=Math.max(b.peak,metric.equity);const dd=1-metric.equity/b.peak,daily=Math.max(0,1-metric.equity/b.dayStart),exposure=(num(s.account.reserved)+metric.btc*(q.bid+q.ask)/2)/Math.max(metric.equity,1e-12);
   b.maxDrawdown=Math.max(b.maxDrawdown,dd);b.maxDailyLoss=Math.max(b.maxDailyLoss,daily);b.maxExposure=Math.max(b.maxExposure,exposure);
   const unprotected=s.positions.some(p=>num(p.quantity)>0&&(!(num(p.stopLoss)>0)||!Number.isFinite(num(p.stopLoss))));
   if(dd>=e.config.limits.drawdownExit||daily>=e.config.limits.dailyExit||exposure>e.config.limits.maxExposure||unprotected){b.hardHalt||=dd>=e.config.limits.drawdownExit||unprotected;this.pause(e,id,unprotected?'UNPROTECTED_POSITION':dd>=e.config.limits.drawdownExit?'DRAWDOWN_LIMIT':daily>=e.config.limits.dailyExit?'DAILY_LOSS_LIMIT':'EXPOSURE_LIMIT');events.push({kind:'risk_limit',bot:id,at:now,data:{reason:b.reason,dd,daily,exposure}});}
   const authorized=e.authorization?.scope==='PAPER_ONLY'&&!e.authorization.revokedAt&&e.authorization.configHash===e.configHash;
   s.account.entriesEnabled=!!authorized&&e.phase==='RUNNING'&&!b.paused&&!b.hardHalt&&healthy&&!filtersChanged&&!outage;
   if(!authorized)this.pause(e,id,'PAPER_AUTHORIZATION_REQUIRED');
   if(b.pending&&s.account.entriesEnabled&&q.receivedAt>b.pending.knownAt+e.config.feed.minLatencyMs){const sig=b.pending.signal;b.pending=undefined;
    const equity=metric.equity,dist=1-sig.protection!.stopPrice/sig.referencePrice,c=this.effective(e,q,feed),cost=2*c.feeRate+(c.spreadBps+2*c.slippageBps)/10000;
    const liquidationExposureCap=equity*c.maxExposure/(1+2*cost);
    s.account.usdtPerTrade=Math.max(0,Math.min(num(s.account.available),liquidationExposureCap-num(s.account.reserved)-metric.btc*sig.referencePrice,equity*e.config.limits.targetRisk/(dist+cost))).toFixed(12);
    const result=this.risk.reserve(s,sig,now);if(!result.accepted)events.push({kind:'order_rejected',bot:id,at:now,data:{reason:result.reason,signalId:sig.id}});
   }
   for(const o of s.orders.filter(o=>o.side==='BUY'&&isOrderOpen(o)))if(s.account.entriesEnabled)this.execute(e,b,o,q,feed,budget,events);else this.paper.cancel(s,o.id,now);
   for(const p of s.positions.filter(isPositionOpen)){
    if(!(num(p.quantity)>0))continue;
    const exitReason=['STOPPING','ENDED_WITH_DUST'].includes(e.phase)?'EXPERIMENT_STOP':b.hardHalt||['DAILY_LOSS_LIMIT','EXPOSURE_LIMIT','UNPROTECTED_POSITION'].includes(b.reason)?b.reason:q.bid<=num(p.stopLoss)?'STOP_LOSS':q.bid>=num(p.takeProfit)?'TAKE_PROFIT':now-p.openedAt>=p.config.maxHoldingMs?'TIME_STOP':null;
    if(exitReason){const o=this.paper.requestExit(s,p.id,now,exitReason);if(o)this.execute(e,b,o,q,feed,budget,events);}
    else for(const o of s.orders.filter(o=>o.positionId===p.id&&o.side==='SELL'&&isOrderOpen(o)))this.execute(e,b,o,q,feed,budget,events);
   }
   for(const p of s.positions.filter(p=>p.status==='CLOSED'))if(-num(p.realizedPnl)>num(p.executionRisk?.equityQuote||0)*e.config.limits.maxRisk+1e-8){b.hardHalt=true;this.pause(e,id,'REALIZED_TRADE_RISK_BREACH');}
   metric=this.metrics(e,b,q,feed);const postExposure=(num(s.account.reserved)+metric.btc*(q.bid+q.ask)/2)/Math.max(metric.equity,1e-12);b.maxExposure=Math.max(b.maxExposure,postExposure);
   if(postExposure>.8||1-metric.equity/b.peak>=.04||1-metric.equity/b.dayStart>=.025){b.hardHalt||=1-metric.equity/b.peak>=.04;this.pause(e,id,postExposure>.8?'EXPOSURE_LIMIT':'POST_FILL_LOSS_LIMIT');for(const p of s.positions.filter(isPositionOpen)){const o=this.paper.requestExit(s,p.id,now,b.reason);if(o)this.execute(e,b,o,q,feed,budget,events);}metric=this.metrics(e,b,q,feed);}
   b.lastEquity=metric.equity;b.peak=Math.max(b.peak,metric.equity);b.maxDrawdown=Math.max(b.maxDrawdown,1-metric.equity/b.peak);b.maxDailyLoss=Math.max(b.maxDailyLoss,1-metric.equity/b.dayStart);b.lastMetrics={...metric,maxDrawdown:b.maxDrawdown,maxDailyLoss:b.maxDailyLoss,maxExposure:b.maxExposure};this.reconcile(b);
  }
  this.passive(e,input,cap);
  if(['STOPPING','ENDED_WITH_DUST'].includes(e.phase)){
   const remaining=BOT_IDS.flatMap(id=>e.bots[id].s.positions.filter(p=>isPositionOpen(p)&&num(p.quantity)>0));
   if(!remaining.length){e.phase='ENDED';e.endedAt??=now;}
   else if(remaining.every(p=>{const qty=floorStep(p.quantity,feed.filters.stepSize).toNumber();return qty<feed.filters.minQty||qty*q.bid<feed.filters.minNotional;})){e.phase='ENDED_WITH_DUST';e.endedAt??=now;}
  }
  return events;
 }
 private execute(e:Experiment,b:Bot,o:ExchangeOrder,q:Quote,feed:FeedState,budget:ReturnType<typeof causalLiquidity>,events:Observation[]){
  const p=b.s.positions.find(p=>p.id===o.positionId)!;
  if(o.side==='BUY'&&(num(p.plannedStop??p.stopLoss)>=q.bid||num(p.plannedTarget??p.takeProfit)<=q.ask||(q.ask-q.bid)/((q.ask+q.bid)/2)*10000>e.config.feed.maxSpreadBps)){this.paper.cancel(b.s,o.id,q.receivedAt);events.push({kind:'order_rejected',bot:b.id,at:q.receivedAt,data:{orderId:o.id,reason:'BOOK_CROSSED_PROTECTION_OR_SPREAD'}});return;}
  const original=p.config,before=b.s.fills.length;p.config={...p.config,...this.effective(e,q,feed),maxHoldingMs:original.maxHoldingMs};
  try{this.paper.execute(b.s,o.id,(q.bid+q.ask)/2,q.receivedAt,budget,'DECISION');}finally{p.config=original;}
  if(o.status==='REJECTED')events.push({kind:'order_rejected',bot:b.id,at:q.receivedAt,data:{orderId:o.id,reason:o.rejection,executionRisk:o.executionRisk}});
  for(const fill of b.s.fills.slice(before))events.push({kind:'fill',bot:b.id,at:q.receivedAt,data:{fill,quote:q,effectiveConfig:{...this.effective(e,q,feed)},source:'PUBLIC_BOOK_TICKER',simulated:true}});
 }
 private passive(e:Experiment,input:KernelInput,cap:number){const {quote:q,feed,now}=input,p=e.passive,c=this.effective(e,q,feed),mid=(q.bid+q.ask)/2,minute=Math.floor(now/60000)*60000;if(p.usedMinute!==minute){p.usedMinute=minute;p.used=0;}
  if(e.phase==='RUNNING'&&e.startedAt&&q.receivedAt>e.startedAt+e.config.feed.minLatencyMs&&p.cash>=c.minNotional){const price=executionPrice(mid,'BUY',c).toNumber(),prior=input.prior,volume=prior?.openTime===minute-60000?prior.volume*c.participationRate:0,qty=floorStep(Math.min(p.cash/(price*(1+c.feeRate)),Math.max(0,volume-p.used),cap),c.stepSize).toNumber();
   if(qty>=c.minQty&&qty*price>=c.minNotional){const fee=qty*price*c.feeRate;p.cash-=qty*price+fee;p.btc+=qty;p.cost+=qty*price+fee;p.fees+=fee;p.spread+=qty*mid*c.spreadBps/20000;p.slippage+=qty*mid*c.slippageBps/10000;p.used+=qty;p.startedAt??=now;}
  }
  const sellQty=floorStep(p.btc,c.stepSize).toNumber(),sellPrice=executionPrice(mid,'SELL',c).toNumber(),equity=p.cash+(sellQty>=c.minQty&&sellQty*sellPrice>=c.minNotional?sellQty*sellPrice*(1-c.feeRate):0);p.lastEquity=equity;p.asOf=now;p.peak=Math.max(p.peak,equity);p.maxDrawdown=Math.max(p.maxDrawdown,1-equity/p.peak);p.maxExposure=Math.max(p.maxExposure,equity>0?p.btc*mid/equity:0);
 }
}
