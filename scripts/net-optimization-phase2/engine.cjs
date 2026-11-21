// Isolated research adapters: reuse execution, indicators, accounting, aggregation and personal controls.
const fs=require('fs'),E=require('../net-optimization/engine.cjs');
const {BacktestingEngine,CandleAggregator}=require('../../dist/v2/backtesting/backtesting.engine');
const {StrategyEngine}=require('../../dist/v2/strategy/strategy-engine');
const {RiskPolicy}=require('../../dist/v2/risk/risk-policy');
const {strategyConfiguration}=require('../../dist/v2/strategy/versions');
const {blockBootstrap,seedOf,quantile}=require('../signal-research/math.cjs');
const DAY=86400000,at=s=>Date.parse(s+'T00:00:00Z');
const {canonicalHash}=require('./canonical.cjs');
function enrich(map){
 const rows=[...map.values()];
 rows.forEach((f,i)=>{
  const prior=rows.slice(Math.max(0,i-12),i),last3=prior.slice(-3),low= Math.min(f.b.low,...prior.slice(-5).map(x=>x.b.low));
  f.original=f.ema20>f.ema50&&f.b.close>f.ema50&&f.b.low<=f.ema20&&f.b.close>f.ema20&&f.b.close>f.b.open;
  let duration=0;for(let j=prior.length-1;j>=0&&prior[j].b.close<=prior[j].ema20;j--)duration++;
  f.diagnostic={depthAtr:(f.high20-low)/f.atr,distanceEma20Atr:(f.b.close-f.ema20)/f.atr,distanceEma50Atr:(f.b.close-f.ema50)/f.atr,
   slope3Atr:i>=3?(f.ema20-rows[i-3].ema20)/f.atr:null,atrFraction:f.atr/f.b.close,pullbackBars:duration,
   pullbackVolumeRatio:last3.length?last3.reduce((n,x)=>n+x.b.volume,0)/last3.length/f.volume20:null,
   recoveryVolumeRatio:last3.length?f.b.volume/(last3.reduce((n,x)=>n+x.b.volume,0)/last3.length):null,
   belowHighAtr:(f.high20-f.b.close)/f.atr,recoveredPriorHigh:f.b.close>f.p.high,
   regime:Math.abs(f.ema20/f.ema50-1)<0.01?'range':f.ema20>f.ema50?'up':'down'};
  f.confirmed=!!rows[i-1]?.original&&f.b.close>f.p.high&&f.ema20>f.ema50&&f.b.close>f.ema20;
 });return map;
}
function labels(bars,map,plan){
 const index=new Map(bars.map((b,i)=>[b.openTime,i])),rows=[];let lastEnd=0;
 for(const [time,f]of map){if(!f.original||time<lastEnd)continue;const i=index.get(time+1),n=plan.economicModel.horizonHours*60;
  const complete=i!==undefined&&i+n<=bars.length;const end=time+n*60000;
  rows.push({at:time,labelEnd:end,day:new Date(time).toISOString().slice(0,10),atrFraction:f.atr/f.b.close,complete,
   value:complete?bars[i+n-1].close/bars[i].open-1:null});lastEnd=end;
 }return rows;
}
function fitModel(records,start,cutoff,plan){
 const use=records.filter(r=>r.complete&&r.at>=start&&r.labelEnd<cutoff),bounds=plan.economicModel.atrBins;
 const bins=bounds.slice(0,-1).map((low,i)=>{
  const high=bounds[i+1],rows=use.filter(r=>r.atrFraction>=low&&r.atrFraction<high);
  const ci=blockBootstrap(rows.map(r=>({period:'training',day:r.day,value:r.value})),{seed:seedOf(`${plan.seed}:${cutoff}:${i}`),reps:plan.gates.bootstrapReps,daysPerBlock:plan.gates.blockDays});
  return {low,high,samples:rows.length,days:ci.days,blocks:ci.blocks??0,mean:ci.mean,lower:ci.low,upper:ci.high};
 });
 const m={trainingStart:start,cutoff,trainedThrough:use.length?Math.max(...use.map(r=>r.labelEnd)):0,trainingHash:E.hash(use),bins};return {...m,id:E.hash(m)};
}
function modelBank(records,plan){
 const bank=new Map();for(let year=2023;year<=2025;year++)for(let month=0;month<12;month++){
  const t=Date.UTC(year,month,1);if(t>at(plan.reserved.start))continue;
  const cutoff=t-plan.embargoDays*DAY;bank.set(new Date(t).toISOString().slice(0,7),fitModel(records,cutoff-plan.economicModel.lookbackDays*DAY,cutoff,plan));
 }return bank;
}
function economicAllowed(f,model,config,plan){
 if(!model||model.trainedThrough>=f.b.closeTime||model.cutoff>f.b.closeTime)return false;
 const b=model.bins.find(b=>f.atr/f.b.close>=b.low&&f.atr/f.b.close<b.high),p=plan.economicModel;
 return !!b&&b.samples>=p.minSamples&&b.days>=p.minDays&&b.blocks>=p.minBlocks&&b.lower>2*config.feeRate+(config.spreadBps+2*config.slippageBps)/10000+p.margin;
}
class PhaseStrategy extends E.ResearchStrategy{
 constructor(v,cache,plan,models){super(v,cache);this.plan=plan;this.models=models;this.signalCount=0;this.abstentions={};}
 evaluate(history,slot,cfg){
  const c=history['1m'].at(-1),f=c&&this.cache.get(c.closeTime),v=this.variant;if(!f)return null;
  let eligible=v.change==='confirmation'?f.confirmed:f.original;
  if(!eligible)return null;
  let reason;
  if(v.change==='extension'&&(f.diagnostic.distanceEma20Atr>v.maxExtensionAtr||f.diagnostic.belowHighAtr<v.minBelowHighAtr))reason='EXTENSION';
  const costs=2*cfg.feeRate+(cfg.spreadBps+2*cfg.slippageBps)/10000;
  if(v.change==='volatility'&&(f.atr/f.b.close<v.minAtrFraction||f.atr/f.b.close>v.maxAtrFraction||v.stopAtr*v.rewardRisk*f.atr/f.b.close/costs<v.minTargetCostRatio))reason='VOLATILITY_ECONOMY';
  const model=this.models instanceof Map?this.models.get(new Date(c.closeTime).toISOString().slice(0,7)):this.models;
  if(v.change==='learned'&&!economicAllowed(f,model,cfg,this.plan))reason='UNCALIBRATED_EDGE';
  if(reason){this.abstentions[reason]=(this.abstentions[reason]||0)+1;return null;}
  const config={...cfg,maxHoldingMs:v.holdHours*3600000};
  if(v.change==='trailing'){config.trailing=true;config.atrMultiplier=v.trailAtr;config.trailingActivation=v.activateAtr*f.atr/f.b.close;}
  const stop=f.b.close-v.stopAtr*f.atr,target=f.b.close+v.stopAtr*v.rewardRisk*f.atr;
  if(stop<=0||target/f.b.close-1<=costs+0.0005)return null;
  this.signalCount++;
  return {id:E.hash(`${v.id}:${c.closeTime}`),strategy:'trend-reference',strategyRevision:`phase2-1:${v.id}`,symbol:'BTCUSDT',candleTime:c.closeTime,referencePrice:f.b.close,atr:f.atr,swingLow:stop,regime:f.diagnostic.regime,conditions:{pullback:true},config,
   protection:{stopPrice:stop,targetPrice:target,horizonMs:v.holdHours*3600000,timeframe:'4h'}};
 }
}
class GeneralSizedRisk extends RiskPolicy{
 constructor(plan){super();this.plan=plan;}
 reserve(s,signal,t){
  if(signal.protection)return new E.SizedRisk(this.plan).reserve(s,signal,t);
  const c=signal.config,price=signal.referencePrice,e=Number(s.account.available)+Number(s.account.reserved)+s.positions.reduce((n,p)=>n+Number(p.quantity)*price,0);
  const dist=c.stopModel==='ATR_ONLY'?signal.atr*c.atrMultiplier/price:Math.max(signal.atr*c.atrMultiplier/price,(price-signal.swingLow)/price);
  const costs=2*c.feeRate+(c.spreadBps+2*c.slippageBps)/10000,exposure=s.positions.reduce((n,p)=>n+Number(p.quantity)*price,Number(s.account.reserved));
  s.account.usdtPerTrade=Math.max(0,Math.min(Number(s.account.available),e*c.maxExposure-exposure,e*this.plan.execution.sizingRisk/(dist+costs))).toFixed(12);
  return super.reserve(s,signal,t);
 }
}
class AuditedPaper extends E.ResearchPaper{
 constructor(plan,opts){super(plan,opts);this.markViolations=new Map();}
 onCandle(s,c,...rest){super.onCandle(s,c,...rest);
  for(const p of s.positions){const eq=Number(p.executionRisk?.equityQuote);if(!(eq>0)||!(Number(p.quantity)>0))continue;
   const markPnl=Number(p.realizedPnl)+Number(p.quantity)*c.close-Number(p.remainingCost);
   if(-markPnl>eq*this.plan.limits.riskPerTrade+1e-8&&!this.markViolations.has(p.id))this.markViolations.set(p.id,{positionId:p.id,at:c.closeTime,loss:-markPnl,cap:eq*this.plan.limits.riskPerTrade,kind:'MARKED_TRADE_LOSS'});
  }
 }
 finish(report){const r=super.finish(report);r.tradeRiskViolations=[...this.markViolations.values(),...r.trades.filter(p=>p.status==='CLOSED'&&Number(p.executionRisk?.equityQuote)>0&&-Number(p.realizedPnl)>Number(p.executionRisk.equityQuote)*this.plan.limits.riskPerTrade+1e-8).map(p=>({positionId:p.id,at:p.closedAt,loss:-Number(p.realizedPnl),cap:Number(p.executionRisk.equityQuote)*this.plan.limits.riskPerTrade,kind:'REALIZED_TRADE_LOSS'}))];return r;}
}
function buildV2Cache(bars,plan){
 const strategy=new StrategyEngine(),agg=new CandleAggregator(),h={'1m':[],'5m':[],'1h':[]},signals=new Map(),cfg={...E.config(plan),invalidationExit:true,maxStopPercent:0.02};
 for(const c of bars){for(const b of[c,...agg.push(c)]){h[b.timeframe].push(b);h[b.timeframe]=h[b.timeframe].slice(-100);}const signal=strategy.evaluate(h,'btc-v2',cfg);if(signal)signals.set(c.closeTime,signal);}
 return signals;
}
class CachedV2 extends StrategyEngine{
 constructor(cache){super();this.cache=cache;}
 evaluate(h,_s,c){const signal=this.cache.get(h['1m'].at(-1)?.closeTime);if(!signal||!(c.takeProfit>2*c.feeRate+(c.spreadBps+2*c.slippageBps)/10000))return null;return {...signal,config:{...c}};}
}
function closedGate(s,plan,minTrades=30){
 const fail=[];if(!s.riskPass)fail.push('RISK_LIMIT');if(!(s.netUsdt>0))fail.push('NONPOSITIVE_NET');if(s.closedTrades<minTrades)fail.push('INSUFFICIENT_TRADES');if(!(s.netWithoutBest3>0))fail.push('BEST_THREE_DEPENDENCE');if(s.top3ProfitShare>plan.gates.top3ProfitShare)fail.push('PROFIT_CONCENTRATION');if(!(s.bootstrap.low>0))fail.push('BOOTSTRAP_UNCERTAINTY');return fail;
}
function simulate({bars,variant,plan,period,cost=1,cache,models,v2Cache,v3Model,strategyOverride,slippageMultiplier}){
 const start=at(period.start),end=at(period.endExclusive);if(start>=at(plan.reserved.start)||end>at(plan.reserved.start)||bars.some(b=>b.closeTime>=at(plan.reserved.start)))throw Error('RESERVED_DATA_FORBIDDEN');
 let config=E.config(plan,cost),strategy,slot='trend-reference';
 if(variant.id==='btc-v2'||variant.id==='btc-v3'){
  slot=variant.id;config={...config,invalidationExit:true,maxStopPercent:0.02};
  if(slot==='btc-v3'){config=strategyConfiguration(slot,config);if(v3Model&&v3Model.trainedThrough<start)config.btcV3Calibration=v3Model;strategy=new StrategyEngine();}
  else strategy=new CachedV2(v2Cache);
 }else strategy=variant.change&&variant.change!=='original'?new PhaseStrategy(variant,cache,plan,models):new E.ResearchStrategy(variant,cache);
 if(slippageMultiplier!==undefined)config.slippageBps=plan.execution.slippageBps*slippageMultiplier;
 if(strategyOverride)strategy=strategyOverride;
 const paper=new AuditedPaper(plan),engine=new BacktestingEngine(strategy,paper,new GeneralSizedRisk(plan));
 const report=paper.finish(engine.run(bars,{strategy:slot,initialCapital:plan.capital,maxPositions:1,usdtPerTrade:30,config},start,end-1));
 const summary=E.summarize(report,bars,start,end,plan,variant,cost);
 const sum=k=>report.fills.reduce((n,f)=>n+Number(f[k]||0),0);
 summary.phase2TradeRiskViolations=report.tradeRiskViolations.length;summary.riskPass&&=report.tradeRiskViolations.length===0;
 summary.spreadCost=sum('spreadCostQuote');summary.slippageCost=sum('slippageCostQuote');summary.roundingCost=sum('roundingCostQuote');
 summary.fillCount=report.fills.length;summary.fillPathHash=E.hash(report.fills.map(f=>[f.side,f.at,f.referencePrice,f.quantity,f.price]));
 summary.abstentions=strategy.abstentions||{};summary.candidateHash=canonicalHash(variant);summary.hash.candidate=summary.candidateHash;summary.modelHash=models?E.hash(models instanceof Map?[...models]:models):null;
 summary.closedByQuarter=report.trades.filter(p=>p.status==='CLOSED').reduce((a,p)=>{const d=new Date(p.closedAt),q=`${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`;a[q]=(a[q]||0)+1;return a;},{});
 return {report,summary};
}
module.exports={...E,canonicalHash,DAY,at,enrich,labels,fitModel,modelBank,economicAllowed,PhaseStrategy,GeneralSizedRisk,AuditedPaper,buildV2Cache,CachedV2,closedGate,simulate,quantile};
