// Offline research only. No Nest providers, credentials, approval writes or exchange APIs.
const {createHash}=require('crypto');
const {StrategyEngine}=require('../../dist/v2/strategy/strategy-engine');
const {RiskPolicy}=require('../../dist/v2/risk/risk-policy');
const {PaperExecutionAdapter}=require('../../dist/v2/execution/paper-execution.adapter');
const {BacktestingEngine,statistics}=require('../../dist/v2/backtesting/backtesting.engine');
const {DEFAULT_SIMULATION,isPositionOpen,isOrderOpen}=require('../../dist/v2/domain/model');
const {executionPrice,floorStep}=require('../../dist/v2/execution/pricing');
const I=require('../../dist/utils/indicators');
const {blockBootstrap,holm}=require('../signal-research/math.cjs');
const DAY=86400000;
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');

function features(minutes,hours){
 const step=hours*3600000, bars=[],map=new Map();let bucket=[];
 for(const c of minutes){
  const t=Math.floor(c.openTime/step)*step;
  if(bucket.length&&Math.floor(bucket[0].openTime/step)*step!==t)bucket=[];
  bucket.push(c);
  if(c.closeTime!==t+step-1)continue;
  if(bucket.length===hours*60&&bucket[0].openTime===t){
   const b={...c,openTime:t,open:bucket[0].open,high:Math.max(...bucket.map(x=>x.high)),low:Math.min(...bucket.map(x=>x.low)),volume:bucket.reduce((a,x)=>a+x.volume,0)};
   bars.push(b);
   if(bars.length>=60){
    const a=bars.slice(-100),cl=a.map(x=>x.close),prev=a.slice(0,-1),p=prev.at(-1);
    const ema20=I.calculateEMA(cl,20),ema50=I.calculateEMA(cl,50),atr=I.calculateATR(a,14),bb=I.calculateBollingerBands(cl,20,2);
    const mean=cl.slice(-20).reduce((n,x)=>n+x,0)/20;
    map.set(c.closeTime,{b,p,ema20,ema50,atr,bb,mean,rsi:I.calculateRSI(cl,14),
     high20:Math.max(...prev.slice(-20).map(x=>x.high)),volume20:prev.slice(-20).reduce((n,x)=>n+x.volume,0)/20,
     momentum:b.close/a.at(-13).close-1,priorMomentum:p.close/a.at(-14).close-1,
     prevEma20:I.calculateEMA(prev.map(x=>x.close),20)});
   }
  }
  bucket=[];
 }
 return map;
}
class ResearchStrategy extends StrategyEngine{
 constructor(variant,cache){super();this.variant=variant;this.cache=cache;}
 invalidated(){return false;}
 evaluate(history,_slot,config){
  const c=history['1m'].at(-1),f=c&&this.cache.get(c.closeTime);if(!f||!f.atr||!f.bb)return null;
  const {b,p,ema20,ema50,atr,rsi,high20,volume20,mean}=f,v=this.variant;
  const up=ema20>ema50&&b.close>ema50;
  const ranging=Math.abs(ema20/ema50-1)<0.01;
  const breakout=up&&b.close>high20&&b.volume>volume20*1.1;
  const reversion=ranging&&b.close<f.bb.lower&&rsi<35&&b.close>ema50*0.95;
  const tests={trend:up&&p.close<=f.prevEma20&&b.close>ema20,
   pullback:up&&b.low<=ema20&&b.close>ema20&&b.close>b.open,
   breakout,momentum:up&&f.momentum>0.01&&f.priorMomentum<=0.01,
   reversion,adaptive:up&&!ranging?breakout:reversion};
  if(!tests[v.family])return null;
  const stopPrice=b.close-v.stopAtr*atr;
  let targetPrice=b.close+v.stopAtr*atr*v.rewardRisk;
  if(v.family==='reversion'||v.family==='adaptive'&&ranging)targetPrice=Math.min(targetPrice,mean);
  const cost=2*config.feeRate+(config.spreadBps+2*config.slippageBps)/10000;
  if(stopPrice<=0||targetPrice/b.close-1<=cost+0.0005)return null;
  return {id:hash(`${v.id}:${c.closeTime}`),strategy:'trend-reference',strategyRevision:`research-net-usdt-1:${v.id}`,symbol:'BTCUSDT',candleTime:c.closeTime,
   referencePrice:b.close,atr,swingLow:stopPrice,regime:up?'up':ranging?'range':'down',conditions:{[v.family]:true},
   config:{...config,maxHoldingMs:v.holdHours*3600000},protection:{stopPrice,targetPrice,horizonMs:v.holdHours*3600000,timeframe:`${v.hours}h`}};
 }
}
class SizedRisk extends RiskPolicy{
 constructor(plan){super();this.plan=plan;}
 reserve(s,signal,at){
  const e=Number(s.account.available)+Number(s.account.reserved)+s.positions.reduce((n,p)=>n+Number(p.quantity)*signal.referencePrice,0);
  const c=signal.config,dist=1-signal.protection.stopPrice/signal.referencePrice;
  const cost=2*c.feeRate+(c.spreadBps+2*c.slippageBps)/10000;
  const exposure=s.positions.reduce((n,p)=>n+Number(p.quantity)*signal.referencePrice,Number(s.account.reserved));
  s.account.usdtPerTrade=Math.max(0,Math.min(Number(s.account.available),e*c.maxExposure-exposure,e*this.plan.execution.sizingRisk/(dist+cost))).toFixed(12);
  return super.reserve(s,signal,at);
 }
}
class ResearchPaper extends PaperExecutionAdapter{
 constructor(plan,{archive=true,controls=true}={}){super();this.plan=plan;this.archive=archive;this.controls=controls;this.archived={positions:[],orders:[],fills:[],ledger:[]};this.peak=plan.capital;this.lastEquity=plan.capital;this.dayStart=plan.capital;this.day='';this.maxDailyLoss=0;this.maxExposure=0;this.halted=false;this.dailyHalted=false;this.riskExits=0;}
 onCandle(s,c,...rest){
  this.state=s;this.lastPrice=c.close;
  const day=new Date(c.openTime).toISOString().slice(0,10);
  if(day!==this.day){this.day=day;this.dayStart=this.lastEquity;this.dailyHalted=false;}
  if(this.controls)s.account.entriesEnabled=!this.halted&&!this.dailyHalted;
  super.onCandle(s,c,...rest);
  let e=this.equity(s,c.close).toNumber();this.peak=Math.max(this.peak,e);
  const loss=Math.max(0,1-e/this.dayStart),dd=1-e/this.peak;
  this.maxDailyLoss=Math.max(this.maxDailyLoss,loss);
  const exposure=s.positions.reduce((n,p)=>n+Number(p.quantity)*c.close,Number(s.account.reserved));
  this.maxExposure=Math.max(this.maxExposure,e>0?exposure/e:1);
  if(this.controls&&(dd>=this.plan.execution.drawdownExit||loss>=this.plan.execution.dailyExit)){
   this.halted ||= dd>=this.plan.execution.drawdownExit;this.dailyHalted=true;s.account.entriesEnabled=false;
   for(const o of s.orders.filter(o=>o.side==='BUY'&&isOrderOpen(o)))this.cancel(s,o.id,c.closeTime);
   for(const p of s.positions.filter(isPositionOpen)){
    const o=this.requestExit(s,p.id,c.closeTime,this.halted?'RESEARCH_DRAWDOWN':'RESEARCH_DAILY');
    if(o){this.riskExits++;this.execute(s,o.id,c.close,c.closeTime,rest[2],'CLOSE');}
   }
   e=this.equity(s,c.close).toNumber();
   this.maxDailyLoss=Math.max(this.maxDailyLoss,Math.max(0,1-e/this.dayStart));
  }
  this.lastEquity=e;
  if(this.archive){
   const done=new Set(s.positions.filter(p=>['CLOSED','REJECTED'].includes(p.status)&&Number(p.quantity)===0&&!s.orders.some(o=>o.positionId===p.id&&isOrderOpen(o))).map(p=>p.id));
   for(const k of ['positions','orders','fills','ledger']){
    const take=x=>done.has(k==='positions'?x.id:x.positionId);
    this.archived[k].push(...s[k].filter(take));s[k]=s[k].filter(x=>!take(x));
   }
  }
 }
 finish(report){
  for(const k of ['positions','orders','fills','ledger']){
   this.state[k]=[...this.archived[k],...this.state[k]];
   report[k==='positions'?'trades':k]=this.state[k];
  }
  report.metrics={...statistics(this.state,this.lastPrice,report.equityCurve),maxSimultaneous:report.metrics.maxSimultaneous};
  report.researchRisk={maxDailyLoss:this.maxDailyLoss,maxExposure:this.maxExposure,drawdownHalted:this.halted,riskExitAttempts:this.riskExits};
  return report;
 }
}
function config(plan,multiplier=1){return {...DEFAULT_SIMULATION,feeRate:plan.execution.feeRate*multiplier,spreadBps:plan.execution.spreadBps*multiplier,slippageBps:plan.execution.slippageBps*multiplier,participationRate:plan.execution.participationRate,maxRiskPerTrade:plan.limits.riskPerTrade,maxExposure:plan.limits.exposure,dailyLossLimit:plan.limits.dailyLoss,maxStopPercent:plan.execution.maxStopPercent,trailing:false,invalidationExit:false};}
function summarize(report,bars,start,end,plan,variant,multiplier){
 const c=report.options.config,last=bars.at(-1),sell=executionPrice(last.close,'SELL',c).toNumber();
 const qty=report.trades.reduce((n,p)=>n+Number(p.quantity),0),tradable=floorStep(qty,c.stepSize).toNumber();
 const sellable=tradable>=c.minQty&&tradable*sell>=c.minNotional?tradable:0;
 const terminal=Number(report.balance.available)+Number(report.balance.reserved)+sellable*sell*(1-c.feeRate);
 const pnl=terminal-plan.capital;
 const daily=[],quarters=new Map();let prev=plan.capital;
 for(let i=0;i<report.equityCurve.length;i++){
  const t=start+i*60000,dt=new Date(t),q=dt.getUTCFullYear()+'-Q'+(Math.floor(dt.getUTCMonth()/3)+1);
  if((t+60000)%DAY===0||i===report.equityCurve.length-1){const eq=i===report.equityCurve.length-1?terminal:report.equityCurve[i];const value=eq-prev;daily.push({period:'continuous',day:dt.toISOString().slice(0,10),value});quarters.set(q,(quarters.get(q)||0)+value);prev=eq;}
 }
 const closed=report.trades.filter(p=>p.status==='CLOSED'),wins=closed.map(p=>Number(p.realizedPnl)).filter(x=>x>0).sort((a,b)=>b-a);
 const top3=wins.slice(0,3).reduce((a,x)=>a+x,0),gross=wins.reduce((a,x)=>a+x,0),losingQuarter=[...quarters.values()].filter(x=>x<0).reduce((n,x)=>n-x,0);
 const bootstrap=blockBootstrap(daily,{seed:123456,reps:plan.gates.bootstrapReps,daysPerBlock:plan.gates.blockDays});
 const days=(end-start)/DAY,continuous=report.dataQuality.gapCount===0&&report.equityCurve.length===(end-start)/60000;
 const riskPass=report.metrics.maxDrawdown<=plan.limits.drawdown&&report.researchRisk.maxDailyLoss<=plan.limits.dailyLoss&&report.researchRisk.maxExposure<=plan.limits.exposure+1e-8&&report.trades.every(p=>!p.executionRisk||!p.executionRisk.accepted||Number(p.executionRisk.estimatedNetStopLoss)<=Number(p.executionRisk.riskLimitQuote)+1e-8);
 return {candidate:variant.id,family:variant.family,costMultiplier:multiplier,netUsdt:pnl,terminalLiquidationValue:terminal,cash:Number(report.balance.available),reserved:Number(report.balance.reserved),remainingBtc:qty,estimatedExitCost:report.metrics.equity-terminal,...report.metrics,...report.researchRisk,riskPass,continuous,days,annualizedReturn:continuous&&days>=365?(terminal/plan.capital)**(365/days)-1:null,
  netWithoutBest3:pnl-top3,top3ProfitShare:gross?top3/gross:0,positiveQuarterFraction:[...quarters.values()].filter(x=>x>0).length/quarters.size,quarterNet:Object.fromEntries(quarters),bootstrap,score:pnl-0.25*losingQuarter-0.1*top3,daily,
  hash:{dataset:report.datasetHash,candidate:hash(variant),config:hash(c),minuteEquity:hash(report.equityCurve)},rejections:report.decisions.filter(d=>!d.accepted).reduce((a,d)=>(a[d.reason]=(a[d.reason]||0)+1,a),{})};
}
function run(bars,variant,plan,period,multiplier=1,cache){
 const start=Date.parse(period.start+'T00:00:00Z'),end=Date.parse(period.endExclusive+'T00:00:00Z');
 const paper=new ResearchPaper(plan),strategy=new ResearchStrategy(variant,cache||features(bars,variant.hours));
 const report=paper.finish(new BacktestingEngine(strategy,paper,new SizedRisk(plan)).run(bars,{strategy:'trend-reference',initialCapital:plan.capital,maxPositions:1,usdtPerTrade:30,config:config(plan,multiplier)},start,end-1));
 return {report,summary:summarize(report,bars,start,end,plan,variant,multiplier)};
}
function gates(s,plan,stage){
 const n=stage==='development'?plan.gates.developmentTrades:stage==='validation'?plan.gates.validationTrades:plan.gates.finalTrades;
 const reasons=[];
 if(!s.riskPass)reasons.push('RISK_LIMIT');if(!(s.netUsdt>0))reasons.push('NONPOSITIVE_NET');if(s.closedTrades<n)reasons.push('INSUFFICIENT_TRADES');
 if(!(s.netWithoutBest3>0))reasons.push('BEST_THREE_DEPENDENCE');if(s.top3ProfitShare>plan.gates.top3ProfitShare)reasons.push('PROFIT_CONCENTRATION');
 if(!(s.bootstrap.low>0))reasons.push('BOOTSTRAP_UNCERTAINTY');
 if(stage==='development'&&s.positiveQuarterFraction<plan.gates.positiveQuarterFraction)reasons.push('QUARTER_INSTABILITY');
 return reasons;
}
function benchmarks(bars,period,plan,multiplier=1){
 const start=Date.parse(period.start+'T00:00:00Z'),end=Date.parse(period.endExclusive+'T00:00:00Z'),index=bars.findIndex(c=>c.openTime===start),first=bars[index],prior=bars[index-1],c=config(plan,multiplier),last=bars.at(-1);
 return [0,0.8,1].map(allocation=>{
  const buy=executionPrice(first.open,'BUY',c).toNumber(),sell=executionPrice(last.close,'SELL',c).toNumber();
  const capacity=prior&&prior.closeTime===start-1?prior.volume*c.participationRate:0;
  const qty=floorStep(Math.min(plan.capital*allocation/(buy*(1+c.feeRate)),capacity),c.stepSize).toNumber();
  const tradable=qty*buy>=c.minNotional?qty:0,cash=plan.capital-tradable*buy*(1+c.feeRate);
  const exit=tradable*sell>=c.minNotional?tradable*sell*(1-c.feeRate):0,terminal=cash+exit;
  let peak=plan.capital,dd=0,day='',dayStart=plan.capital,prev=plan.capital,maxDailyLoss=0,maxExposure=0;
  for(let i=index;i<bars.length;i++){const b=bars[i],eq=cash+tradable*b.close,d=new Date(b.openTime).toISOString().slice(0,10);if(d!==day){day=d;dayStart=prev;}peak=Math.max(peak,eq);dd=Math.max(dd,1-eq/peak);maxDailyLoss=Math.max(maxDailyLoss,1-eq/dayStart);maxExposure=Math.max(maxExposure,tradable*b.close/eq);prev=eq;}
  dd=Math.max(dd,1-terminal/peak);maxDailyLoss=Math.max(maxDailyLoss,1-terminal/dayStart);
  // Passive BTC has no protective stop; neither BTC benchmark qualifies under risk-per-trade.
  return {candidate:allocation===0?'USDT':`BTC-hold-${allocation*100}`,allocation,actualInitialExposure:tradable*buy/plan.capital,costMultiplier:multiplier,netUsdt:terminal-plan.capital,terminalLiquidationValue:terminal,cash,remainingBtc:tradable,maxDrawdown:dd,maxDailyLoss,maxExposure,riskPass:allocation===0,annualizedReturn:(end-start)>=365*DAY?(terminal/plan.capital)**(365*DAY/(end-start))-1:null};
 });
}
module.exports={features,ResearchStrategy,SizedRisk,ResearchPaper,run,summarize,gates,config,benchmarks,hash,holm};
