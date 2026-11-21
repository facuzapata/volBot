// Descriptive diagnosis only: never read by selection, strategy or calibration.
const fs=require('fs'),E=require('./engine.cjs'),IO=require('./io.cjs'),{csv}=require('../signal-research/math.cjs');
const {ROOT,read,write}=IO;
const mean=a=>a.length?a.reduce((n,x)=>n+x,0)/a.length:null;
function describe(a){const x=a.filter(Number.isFinite);return {n:x.length,mean:mean(x),median:E.quantile(x,.5),p10:E.quantile(x,.1),p90:E.quantile(x,.9)};}
function correlation(a,b){if(a.length<3)return null;const x=mean(a),y=mean(b),cov=a.reduce((n,v,i)=>n+(v-x)*(b[i]-y),0),sx=a.reduce((n,v)=>n+(v-x)**2,0),sy=b.reduce((n,v)=>n+(v-y)**2,0);return sx&&sy?cov/Math.sqrt(sx*sy):null;}
function main(){
 const freeze=read(ROOT+'/plan.json');IO.check(freeze);const bars=IO.loadData(freeze),index=new Map(bars.map((b,i)=>[b.openTime,i])),maps={4:E.enrich(E.features(bars,4)),1:E.features(bars,1)},signals=[],trades=[],groups=[];
 function forward(time,hours,entryPrice){const i=index.get(time),n=hours*60;if(i===undefined||i+n>bars.length)return {complete:false,reason:'right-censored'};const a=bars.slice(i,i+n),price=entryPrice??a[0].open;return {complete:true,returnPct:(a.at(-1).close/price-1)*100,mfePct:(Math.max(...a.map(b=>b.high))/price-1)*100,maePct:(1-Math.min(...a.map(b=>b.low))/price)*100};}
 const dailyBtc=new Map();let prior;
 for(const b of bars)if((b.closeTime+1)%E.DAY===0){const day=new Date(b.openTime).toISOString().slice(0,10);if(prior)dailyBtc.set(day,b.close/prior-1);prior=b.close;}
 function historical(stage,id){const file=`reports/net-optimization/diagnostic-${stage}-${id}-1.json`,r=read(file);return r.reusedFrozenResult?read(r.reusedFrozenResult):r;}
 for(const id of ['pullback-4h','momentum-1h'])for(const [stage,period]of [['development',freeze.plan.development],['validation',{start:'2025-01-01',endExclusive:'2025-04-01'}]]){
  const r=historical(stage,id),map=maps[id==='pullback-4h'?4:1],start=E.at(period.start),end=E.at(period.endExclusive),sg=[],tr=[];
  for(const [time,f]of map){if(time<start||time>=end)continue;const eligible=id==='pullback-4h'?f.original:f.ema20>f.ema50&&f.b.close>f.ema50&&f.momentum>.01&&f.priorMomentum<=.01;if(!eligible)continue;
   const row={strategy:id,stage,at:time,day:new Date(time).toISOString().slice(0,10),atrFraction:f.atr/f.b.close,referencePrice:f.b.close,
    ...(f.diagnostic||{regime:Math.abs(f.ema20/f.ema50-1)<.01?'range':'up'}),forward24h:forward(time+1,24),forward120h:forward(time+1,120)};sg.push(row);signals.push(row);
  }
  for(const p of r.trades||[]){if(!(Number(p.entryQuantity)>0))continue;const fills=r.fills.filter(f=>f.positionId===p.id),buy=fills.filter(f=>f.side==='BUY'),sell=fills.filter(f=>f.side==='SELL');if(!buy.length)continue;
   const entry=buy[0].at,exit=p.closedAt??end-1,i=index.get(Math.floor(entry/60000)*60000),j=index.get(Math.floor(exit/60000)*60000),held=bars.slice(i,j+1),price=Number(p.averageEntry),f=map.get(p.openedAt-1),costs=2*p.config.feeRate+(p.config.spreadBps+2*p.config.slippageBps)/10000;
   const row={strategy:id,stage,positionId:p.id,entry,exit,status:p.status,netRealizedPnl:Number(p.realizedPnl),holdingHours:(exit-entry)/3600000,entryPrice:price,entryNotional:Number(p.entryQuote),commissions:fills.reduce((n,f)=>n+Number(f.commissionQuote??f.commission),0),
    spread:fills.reduce((n,f)=>n+Number(f.spreadCostQuote||0),0),slippage:fills.reduce((n,f)=>n+Number(f.slippageCostQuote||0),0),exitReason:p.exitReason,
    mfeUpperPct:held.length?(Math.max(...held.map(b=>b.high))/price-1)*100:null,maeUpperPct:held.length?(1-Math.min(...held.map(b=>b.low))/price)*100:null,
    stopDistancePct:(1-Number(p.plannedStop??p.stopLoss)/Number(p.signalReferencePrice))*100,targetDistancePct:(Number(p.plannedTarget??p.takeProfit)/Number(p.signalReferencePrice)-1)*100,
    targetCostRatio:(Number(p.plannedTarget??p.takeProfit)/Number(p.signalReferencePrice)-1)/costs,stopCostRatio:(1-Number(p.plannedStop??p.stopLoss)/Number(p.signalReferencePrice))/costs,
    ...(f?.diagnostic||{regime:Math.abs((f?.ema20||1)/(f?.ema50||1)-1)<.01?'range':'up'})};tr.push(row);trades.push(row);
  }
  const days=(end-start)/E.DAY,closed=tr.filter(t=>t.status==='CLOSED'),daily=r.summary.daily.filter(d=>dailyBtc.has(d.day)),x=daily.map(d=>dailyBtc.get(d.day)),y=daily.map(d=>d.value/500);
  groups.push({strategy:id,stage,period,net:r.summary.netUsdt,closedTrades:closed.length,rawSignals:sg.length,signalsPer30Days:sg.length/days*30,
   commissions:r.summary.totalCommissions,commissionPerClosedTrade:closed.length?r.summary.totalCommissions/closed.length:null,averageNetPerClosedTrade:r.summary.expectancy,
   winRate:r.summary.winRate,profitFactor:r.summary.profitFactor,maxDrawdown:r.summary.maxDrawdown,drawdownHalted:r.summary.drawdownHalted,
   netWithoutBest3:r.summary.netWithoutBest3,top3ProfitShare:r.summary.top3ProfitShare,quarterNet:r.summary.quarterNet,btcDailyCorrelation:correlation(x,y),
   distributions:Object.fromEntries(['holdingHours','netRealizedPnl','commissions','mfeUpperPct','maeUpperPct','stopDistancePct','targetDistancePct','targetCostRatio','stopCostRatio','atrFraction','depthAtr','distanceEma20Atr','distanceEma50Atr','slope3Atr','pullbackBars','pullbackVolumeRatio','recoveryVolumeRatio','belowHighAtr'].map(k=>[k,describe(tr.map(t=>t[k]))])),
   byRegime:Object.fromEntries([...new Set(tr.map(t=>t.regime))].map(regime=>{const a=tr.filter(t=>t.regime===regime);return [regime,{trades:a.length,realizedPnl:a.reduce((n,t)=>n+t.netRealizedPnl,0),meanHoldingHours:mean(a.map(t=>t.holdingHours))}];})),
   forward24h:describe(sg.filter(s=>s.forward24h.complete).map(s=>s.forward24h.returnPct)),forward120h:describe(sg.filter(s=>s.forward120h.complete).map(s=>s.forward120h.returnPct)),censored120h:sg.filter(s=>!s.forward120h.complete).length,
   exitReasons:closed.reduce((a,t)=>(a[t.exitReason]=(a[t.exitReason]||0)+1,a),{})});
 }
 const result={freezeHash:freeze.freezeHash,diagnosticOnly:true,source:'Phase1 exact original 2024 and Jan-Mar2025 replays; no reoptimization',groups,definitions:{mfeMae:'Upper bounds from complete OHLC holding bars including exit minute, not executable prices or risk breaches',pullbackBars:'Consecutive preceding 4h closes below EMA20, excluding current recovery bar',pullbackVolumeRatio:'Average preceding three closed 4h volumes / preceding 20-bar mean; proxy, not tick-volume within a pullback',slope3Atr:'EMA20 change over three 4h bars / current closed ATR',depthAtr:'Previous 20-bar high minus low of current and preceding five 4h bars / current ATR',btcDailyCorrelation:'Pearson of daily marked USDT PnL/initial500 against BTC close-to-close returns; descriptive, no causal identification',forward:'Next minute open to exact horizon close; overlapping raw signals, not implementable simultaneous portfolio'}};
 write(ROOT+'/diagnostics.json',result);fs.writeFileSync(ROOT+'/signal-features.csv',csv(signals));fs.writeFileSync(ROOT+'/trade-diagnostics.csv',csv(trades));console.log(JSON.stringify(groups.map(g=>({id:g.strategy,stage:g.stage,signals:g.rawSignals,net:g.net,hold:g.distributions.holdingHours.median,targetCosts:g.distributions.targetCostRatio.median,correlation:g.btcDailyCorrelation}))));
}
if(require.main===module)main();
