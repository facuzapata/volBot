const fs=require('fs'),crypto=require('crypto');
const {StrategyEngine,STRATEGY_REVISION}=require('../../dist/v2/strategy/strategy-engine');
const {BacktestingEngine,CandleAggregator}=require('../../dist/v2/backtesting/backtesting.engine');
const {DEFAULT_SIMULATION}=require('../../dist/v2/domain/model');
const {validCandle}=require('../../dist/v2/market/public-market.client');
const {MINUTE,mean,seedOf,sample,forward,matchControls,csv}=require('./math.cjs');
const {costEntry,costExit,breakEven}=require('./costs.cjs');
const plan=JSON.parse(fs.readFileSync('docs/signal-research-plan.json'));
const month=process.argv[2];if(!plan.periods.includes(month))throw new Error('Period is not registered');
const root=`reports/signal-research-v1/${month}`;fs.mkdirSync(root,{recursive:true});
const original=month==='2025-01-original';
const period=original?{start:Date.UTC(2025,0,1),end:Date.UTC(2025,0,8),split:'original-diagnostic'}:JSON.parse(fs.readFileSync('reports/research-manifest.json')).find(p=>p.month===month);
const input=original?'reports/btcusdt-1m.json':`reports/research-data/${month}.json`;
const raw=JSON.parse(fs.readFileSync(input)),bars=raw.filter(validCandle).sort((a,b)=>a.openTime-b.openTime),index=new Map(bars.map((c,i)=>[c.openTime,i]));
const techKeys=['sma9','sma21','sma50','ema12','ema26','rsi','atr','volumeMA','macd','signal','histogram'];
class Recorder extends StrategyEngine{
 constructor(){super();this.technicalByTimeframe={}}
 calculateTechnical(b){const t=super.calculateTechnical(b);if(t)this.technicalByTimeframe[b.at(-1).timeframe]=t;return t}
}
let engine=new Recorder(),agg=new CandleAggregator(),h={'1m':[],'5m':[],'1h':[]},prevTime,eligible=false,momentum=false,pullback=false;
const candidates=[],cases=[],alternatives={'D-momentum':[],'E-pullback':[]},minuteMap=new Map;let consecutiveGreen=0;
for(let i=0;i<bars.length;i++){
 const c=bars[i];if(prevTime!==undefined&&c.openTime!==prevTime+MINUTE){engine=new Recorder();agg=new CandleAggregator();h={'1m':[],'5m':[],'1h':[]};eligible=momentum=pullback=false;consecutiveGreen=0}prevTime=c.openTime;
 for(const x of [c,...agg.push(c)]){h[x.timeframe].push(x);h[x.timeframe]=h[x.timeframe].slice(-100)}
 const sig=engine.evaluate(h,'btc-v2',DEFAULT_SIMULATION),a=engine.lastAssessment;
 consecutiveGreen=c.close>c.open?consecutiveGreen+1:0;
 const t=engine.technicalByTimeframe['1m'];
 if(!a||!t){eligible=!!sig;continue}
 const prior=n=>{const b=bars[i-n];return b&&b.openTime===c.openTime-n*MINUTE&&h['1m'].length>n?(c.close/b.close-1)*100:null};
 const recent=n=>h['1m'].slice(-n);
 const range=n=>{const b=recent(n);if(b.length<n)return{};const hi=Math.max(...b.map(c=>c.high)),lo=Math.min(...b.map(c=>c.low));return{high:hi,low:lo,distanceHighPct:(c.close/hi-1)*100,distanceLowPct:(c.close/lo-1)*100,position:hi===lo?.5:(c.close-lo)/(hi-lo)}};
 const r20=range(20),r50=range(50),r100=range(100),previous5=minuteMap.get(c.openTime-5*MINUTE);
 const returns=recent(31).slice(1).map((b,j)=>Math.log(b.close/recent(31)[j].close));const rm=mean(returns);
 const volatility30=returns.length===30?Math.sqrt(returns.reduce((n,v)=>n+(v-rm)**2,0)/returns.length)*100:null;
 const atrPct=t.atr/c.close*100;
 const f={id:`${month}:${c.closeTime}`,period:month,originalSplit:period.split,analysisStatus:'exploratory',signalTime:c.closeTime,entryTime:c.openTime+MINUTE,signalPrice:c.close,day:new Date(c.closeTime).toISOString().slice(0,10),hourUTC:new Date(c.closeTime).getUTCHours(),hour4:Math.floor(new Date(c.closeTime).getUTCHours()/4),atrBucket:plan.matching.ATRpercentBuckets.filter(b=>atrPct>=b).length,
  primaryTrend:a.conditions.primaryTrend,confirmation:a.conditions.confirmation,rsiEntry:a.conditions.rsiEntry,macdEntry:a.conditions.macdEntry,candle:a.conditions.candle,volume:a.conditions.volume,structure:a.conditions.structure,eligible:!!sig,regime:a.regime,
  close5m:h['5m'].at(-1)?.closeTime,close1h:h['1h'].at(-1)?.closeTime,atrPct,volatility30Pct:volatility30,prior5Pct:prior(5),prior15Pct:prior(15),prior30Pct:prior(30),prior60Pct:prior(60),
  high20:r20.high,low20:r20.low,high50:r50.high,low50:r50.low,high100:r100.high,low100:r100.low,distanceHigh20Pct:r20.distanceHighPct,distanceHigh50Pct:r50.distanceHighPct,distanceHigh100Pct:r100.distanceHighPct,distanceLow100Pct:r100.distanceLowPct,rangePosition100:r100.position,
  consecutiveGreen,volumeRaw:c.volume,volumeRatio:t.volumeMA?c.volume/t.volumeMA:null,priceSma9Pct:(c.close/t.sma9-1)*100,priceSma21Pct:(c.close/t.sma21-1)*100,priceEma12Pct:(c.close/t.ema12-1)*100,
  sma9Slope5Pct:previous5?(t.sma9/previous5.sma9-1)*100:null,sma21Slope5Pct:previous5?(t.sma21/previous5.sma21-1)*100:null,ema12Slope5Pct:previous5?(t.ema12/previous5.ema12-1)*100:null,ema26Slope5Pct:previous5?(t.ema26/previous5.ema26-1)*100:null,histogramDelta5:previous5?t.histogram-previous5.histogram:null,
  ...Object.fromEntries(techKeys.map(k=>[k,t[k]])),...Object.fromEntries(['1h','5m'].flatMap(tf=>techKeys.map(k=>[`${tf}_${k}`,engine.technicalByTimeframe[tf]?.[k]])))};
 const rsiValues=[];for(let j=1;j<=20;j++){const p=minuteMap.get(c.openTime-j*MINUTE);if(p)rsiValues.push(p.rsi)}
 f.rsiRecentMin=rsiValues.length?Math.min(...rsiValues):null;f.rsiRecentMax=rsiValues.length?Math.max(...rsiValues):null;f.rsiRangePosition=f.rsiRecentMax>f.rsiRecentMin?(t.rsi-f.rsiRecentMin)/(f.rsiRecentMax-f.rsiRecentMin):null;
 f.lateExhaustion=r100.position>=.8&&f.prior15Pct>0&&f.histogramDelta5!==null&&f.histogramDelta5<0;
 f.emitted=!!sig&&!eligible&&c.openTime>=period.start&&c.openTime<period.end;f.signalId=f.emitted?sig.id:null;
 const dm=a.conditions.primaryTrend&&f.prior15Pct>.2,ep=a.conditions.primaryTrend&&c.close<t.sma21&&f.prior5Pct<0;
 if(c.openTime>=period.start&&c.openTime<period.end){candidates.push(f);if(f.emitted)cases.push(f);if(dm&&!momentum)alternatives['D-momentum'].push(f);if(ep&&!pullback)alternatives['E-pullback'].push(f)}
 minuteMap.set(c.openTime,f);eligible=!!sig;momentum=dm;pullback=ep;
}
console.log(`${month}: extracted ${candidates.length} eligible-history minutes, ${cases.length} emitted signals`);
// Replay unchanged engine independently of the feature recorder; never pass outcomes into it.
const report=new BacktestingEngine().run(bars,{strategy:'btc-v2',initialCapital:500,maxPositions:5,usdtPerTrade:30,allowDataGaps:!original},period.start,period.end-1);
fs.writeFileSync(root+'/baseline-replay.json',JSON.stringify(report));
const positions=new Map(report.trades.map(p=>[p.signalId,p]));const decisions=new Map(report.decisions.map(p=>[p.signalId,p]));
for(const f of cases){const p=positions.get(f.signalId),d=decisions.get(f.signalId);Object.assign(f,{positionId:p?.id,admission:d?.reason??'no next minute / no reservation',strategyStatus:p?.status,actualEntry:p?Number(p.averageEntry):null,actualStop:p?Number(p.stopLoss):null,actualTakeProfit:p?Number(p.takeProfit):null,actualExitReason:p?.exitReason,actualExitTime:p?.closedAt,actualNetPnl:p?Number(p.realizedPnl):null})}
const nonCases=candidates.filter(f=>!f.emitted);const pools={'A-random':nonCases,'B-uptrend':nonCases.filter(f=>f.primaryTrend),'C-trend-incomplete':nonCases.filter(f=>f.primaryTrend&&!f.eligible),...alternatives};
const matches=Object.fromEntries(Object.entries(pools).map(([g,p])=>[g,matchControls(cases,p,g,plan)]));
const components=Object.fromEntries(plan.indicatorComponents.map(k=>[`component-${k}`,sample(candidates.filter(f=>f[k]),1000,seedOf(`${plan.seed}:${month}:${k}`))]));
const observations=new Map;const add=f=>observations.set(f.id,f);cases.forEach(add);Object.values(matches).flat().flatMap(m=>m.controls).forEach(add);Object.values(components).flat().forEach(add);Object.values(alternatives).flat().forEach(add);
const outcomes={};let processed=0;
for(const f of observations.values()){
 const next=index.get(f.entryTime);const entry=next===undefined?null:bars[next].open;const cost=entry===null?null:costEntry(entry,f.entryTime);
 const e=cost?.positions[0];f.expectedNextOpen=entry;
 if(cost)Object.assign(f,{researchExecutedEntry:Number(e.averageEntry),researchQuantity:Number(e.entryQuantity),researchEntryCost:Number(e.remainingCost),researchEntryFee:Number(e.entryFees),researchEntrySpread:Number(cost.fills[0].spreadCostQuote),researchEntrySlippage:Number(cost.fills[0].slippageCostQuote),researchEntryRounding:Number(cost.fills[0].roundingCostQuote),...breakEven(e.quantity,e.remainingCost,entry)});
 outcomes[f.id]={};for(const horizon of plan.horizonsMinutes){const o=forward(bars,index,f.entryTime,horizon);if(o.complete&&cost){const exit=costExit(cost,o.close,o.endTime);o.netReturnPct=exit.netReturnPct;o.netPnl=exit.netPnl;o.sellFee=exit.sellFee;o.marketSellExecuted=exit.sellPrice;Object.assign(f,{[`return${horizon}mPct`]:o.returnPct,[`netMarketHold${horizon}mPct`]:o.netReturnPct,[`mfe${horizon}mPct`]:o.mfePct,[`mae${horizon}mPct`]:o.maePct,[`mfeTime${horizon}mMin`]:o.mfeTimeMin,[`mfeTime${horizon}mMax`]:o.mfeTimeMax,[`maeTime${horizon}mMin`]:o.maeTimeMin,[`maeTime${horizon}mMax`]:o.maeTimeMax});for(const threshold of plan.thresholdsPct.up)f[`hitUp${threshold}pctBy${horizon}m`]=o.mfePct>=threshold;for(const threshold of plan.thresholdsPct.down)f[`hitDown${threshold}pctBy${horizon}m`]=o.maePct>=threshold;}f[`complete${horizon}m`]=o.complete;outcomes[f.id][horizon]=o}
 if(++processed%2000===0)console.log(`${month}: outcomes ${processed}/${observations.size}`);
}
const stopRows=[];
for(const p of report.trades.filter(p=>p.exitReason==='STOP_LOSS')){
 const fills=report.fills.filter(f=>f.positionId===p.id),buys=fills.filter(f=>f.side==='BUY'),sells=fills.filter(f=>f.side==='SELL');const entry=Number(p.averageEntry),start=bars.findIndex(c=>c.openTime===Math.floor(p.openedAt/MINUTE)*MINUTE),end=index.get(Math.floor(p.closedAt/MINUTE)*MINUTE);if(start<0||end===undefined)throw new Error('Missing trade bar');
 const held=bars.slice(start,end+1),pre=held.slice(0,-1),beforeHigh=Math.max(entry,...pre.map(c=>c.high),held.at(-1).open),upperHigh=Math.max(beforeHigh,held.at(-1).high);
 const totalBuyCost=buys.reduce((n,f)=>n+Number(f.quote)+Number(f.commissionQuote??f.commission),0),q=buys.reduce((n,f)=>n+Number(f.quantity),0),reference=Number(buys[0].referencePrice??buys[0].price);
 const row={period:month,signalId:p.signalId,positionId:p.id,entryTime:p.openedAt,exitTime:p.closedAt,entry,exitExecuted:Number(sells.at(-1).price),stop:Number(p.stopLoss),tp:Number(p.takeProfit),atr:Number(p.atr),stopPct:p.stopDistance*100,stopATR:(entry-Number(p.stopLoss))/Number(p.atr),stopTimeLowerMinutes:Math.max(0,(bars[end].openTime-p.openedAt)/MINUTE),stopTimeUpperMinutes:(p.closedAt-p.openedAt)/MINUTE,within5m:(p.closedAt-p.openedAt)/MINUTE<=5,mfePreStopLowerPct:(beforeHigh/entry-1)*100,mfePreStopUpperPct:(upperHigh/entry-1)*100,netPnl:Number(p.realizedPnl),grossPnlPlusFees:Number(p.realizedPnl)+fills.reduce((n,f)=>n+Number(f.commissionQuote??f.commission),0),entryCost:totalBuyCost,entryFees:buys.reduce((n,f)=>n+Number(f.commissionQuote??f.commission),0),exitFees:sells.reduce((n,f)=>n+Number(f.commissionQuote??f.commission),0),spreadCost:fills.reduce((n,f)=>n+Number(f.spreadCostQuote??0),0),slippageCost:fills.reduce((n,f)=>n+Number(f.slippageCostQuote??0),0),roundingCost:fills.reduce((n,f)=>n+Number(f.roundingCostQuote??0),0),...breakEven(q,totalBuyCost,reference,p.config)};
 const afterTime=Math.floor(p.closedAt/MINUTE)*MINUTE+MINUTE;
 for(const hour of plan.stopCounterfactualHours){const endTime=afterTime+hour*60*MINUTE,after=bars.filter(c=>c.openTime>=afterTime&&c.openTime<endTime),complete=after.length===hour*60&&after.every((c,j)=>c.openTime===afterTime+j*MINUTE);const hit=after.find(c=>c.high>=Number(p.takeProfit));const low=after.length?Math.min(...after.map(c=>c.low)):null,high=after.length?Math.max(...after.map(c=>c.high)):null;
  Object.assign(row,{[`completeAfter${hour}h`]:complete,[`tpAfter${hour}h`]:hit?true:complete?false:null,[`postStopMfe${hour}hPct`]:complete?Math.max(0,(high/entry-1)*100):null,[`postStopMae${hour}hPct`]:complete?Math.max(0,(1-low/entry)*100):null,[`extraAdverseBeyondStop${hour}hPct`]:complete?Math.max(0,(Number(p.stopLoss)-low)/entry*100):null,[`returnFromExit${hour}hPct`]:complete?(after.at(-1).close/row.exitExecuted-1)*100:null});
  if(hit&&row.tpFirstTimeMin===undefined){row.tpFirstTimeMin=(hit.openTime-p.closedAt)/MINUTE;row.tpFirstTimeMax=(hit.closeTime-p.closedAt)/MINUTE}
 }
 row.netHeadroomAtPreStopMfeUpperPct=(upperHigh/row.breakEvenMarketReference-1)*100;stopRows.push(row);
}
if(original){const old=JSON.parse(fs.readFileSync('reports/btc-v2-report.json'));if(old.trades.length!==28||report.trades.length!==28||Math.abs(report.metrics.netRealizedPnl-old.metrics.netRealizedPnl)>1e-8)throw new Error('Original baseline changed');const windows=report.trades.map(p=>({positionId:p.id,signalId:p.signalId,entryTime:p.openedAt,signalTime:p.openedAt-1,marketWindow:bars.filter(c=>c.openTime>=p.openedAt-120*MINUTE&&c.openTime<=p.openedAt+120*MINUTE).map(c=>({relativeMinute:(c.openTime-p.openedAt)/MINUTE,...c,causalFeaturesAtClose:minuteMap.get(c.openTime)}))}));fs.writeFileSync(root+'/original-28-windows.json',JSON.stringify(windows))}
const correlationCounts={};const conditions=plan.indicatorComponents;for(const a of conditions)for(const b of conditions){const counts=[0,0,0,0];for(const f of candidates)counts[(f[a]?2:0)+(f[b]?1:0)]++;correlationCounts[`${a}|${b}`]=counts}
const matching=Object.fromEntries(Object.entries(matches).map(([g,ms])=>[g,ms.map(m=>({...m,controls:m.controls.map(f=>f.id)}))]));
const result={period:month,originalSplit:period.split,sourceSHA256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),input,quarantined:raw.length-bars.length,candidateMinutes:candidates.length,signalCount:cases.length,baselineMetrics:report.metrics,cases:cases.map(f=>f.id),observations:[...observations.values()],outcomes,matching,components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,v.map(f=>f.id)])),alternativeSignals:Object.fromEntries(Object.entries(alternatives).map(([k,v])=>[k,v.map(f=>f.id)])),componentPopulationCounts:Object.fromEntries(conditions.map(k=>[k,candidates.filter(f=>f[k]).length])),correlationCounts,stopRows};
fs.writeFileSync(root+'/analysis.json',JSON.stringify(result));fs.writeFileSync(root+'/entries.csv',csv(cases));fs.writeFileSync(root+'/stops.csv',csv(stopRows));
console.log(`${month}: completed signals=${cases.length}, sampled observations=${observations.size}, stops=${stopRows.length}, baseline net=${report.metrics.netRealizedPnl}`);

