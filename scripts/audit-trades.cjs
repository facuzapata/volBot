const fs=require('fs');const crypto=require('crypto');
const {BacktestingEngine}=require('../dist/v2/backtesting/backtesting.engine');
const {StrategyEngine}=require('../dist/v2/strategy/strategy-engine');
const candles=JSON.parse(fs.readFileSync('reports/btcusdt-1m.json'));
const baseline=JSON.parse(fs.readFileSync('reports/audit-baseline/reports__btc-v2-report.json'));
const signals=new Map();class Recorder extends StrategyEngine{evaluate(h,s,c){const r=super.evaluate(h,s,c);if(r)signals.set(r.id,r);return r;}}
const corrected=new BacktestingEngine(new Recorder()).run(candles,baseline.options);
fs.writeFileSync('reports/btc-v2-corrected.json',JSON.stringify(corrected,null,2));
const index=new Map(candles.map((c,i)=>[c.openTime,i]));
const iso=t=>t===undefined?'':new Date(t).toISOString();
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]:null;
const rows=[];const differences=[];
for(const old of baseline.trades.filter(p=>p.status==='CLOSED')){
 const p=corrected.trades.find(p=>p.id===old.id);if(!p)throw new Error('Original position missing from corrected replay');
 const sig=signals.get(p.signalId);if(!sig)throw new Error('Original signal could not be reconstructed');
 const buys=corrected.fills.filter(f=>f.positionId===p.id&&f.side==='BUY');const sells=corrected.fills.filter(f=>f.positionId===p.id&&f.side==='SELL');
 const first=buys[0];const last=sells.at(-1);const start=index.get(Math.floor(first.at/60000)*60000);const end=index.get(Math.floor(last.at/60000)*60000);
 const bars=candles.slice(start,end+1);const entry=Number(p.averageEntry);const stop=Number(p.stopLoss),tp=Number(p.takeProfit);
 const firstBoundary=bars.find(c=>c.open>=tp||c.open<=stop||c.low<=stop||c.high>=tp);
 const expectedReason=firstBoundary?(firstBoundary.open>=tp?'TAKE_PROFIT':firstBoundary.open<=stop||firstBoundary.low<=stop?'STOP_LOSS':'TAKE_PROFIT'):'NO_BOUNDARY';
 const exitBar=candles[end];const pre=bars.slice(0,-1);const highBar=bars.reduce((a,b)=>b.high>a.high?b:a,bars[0]);
 const high=Math.max(entry,...bars.map(c=>c.high));const low=Math.min(entry,...bars.map(c=>c.low));
 const knownHigh=Math.max(entry,exitBar.open,...pre.map(c=>c.high));const knownLow=Math.min(entry,exitBar.open,expectedReason==='STOP_LOSS'?Math.min(stop,exitBar.open):entry,...pre.map(c=>c.low));
 const allFills=[...buys,...sells];const fee=allFills.reduce((n,f)=>n+Number(f.commissionQuote??f.commission),0);
 const changed=old.closedAt!==p.closedAt||old.exitReason!==p.exitReason||Math.abs(Number(old.realizedPnl)-Number(p.realizedPnl))>1e-9;
 if(changed||expectedReason!==p.exitReason)differences.push({positionId:p.id,changed,expectedReason,actualReason:p.exitReason});
 rows.push({signalId:p.signalId,positionId:p.id,strategyRevision:sig.strategyRevision,simulatorRevision:corrected.simulatorRevision,
  signalTime:iso(sig.candleTime),executionTime:iso(first.at),signalPrice:sig.referencePrice,expectedNextOpen:candles[start].open,
  executedEntry:entry,takeProfit:tp,stopLoss:stop,atrAtSignal:sig.atr,stopDistancePct:(1-stop/entry)*100,stopATR:(entry-stop)/sig.atr,
  btcGross:p.entryGrossQuantity??p.entryQuantity,btcNetAcquired:p.entryQuantity,buyFillCount:buys.length,sellFillCount:sells.length,
  commissionsQuote:fee,commissionAssets:[...new Set(allFills.map(f=>f.commissionAsset))].join('|'),spreadBps:p.config.spreadBps,slippageBps:p.config.slippageBps,
  spreadCost:allFills.reduce((n,f)=>n+Number(f.spreadCostQuote??0),0),slippageCost:allFills.reduce((n,f)=>n+Number(f.slippageCostQuote??0),0),roundingCost:allFills.reduce((n,f)=>n+Number(f.roundingCostQuote??0),0),
  exitTime:iso(last.at),exitReference:last.referencePrice,exitExecuted:last.price,exitReason:p.exitReason,independentReason:expectedReason,
  independentFirstBoundary:iso(firstBoundary?.closeTime),exitClassificationMatches:expectedReason===p.exitReason&&firstBoundary?.closeTime===p.closedAt,
  originalVsCorrectedChanged:changed,netPnl:Number(p.realizedPnl),grossPnl:Number(p.realizedPnl)+fee,
  mfeLowerPct:(knownHigh/entry-1)*100,mfeUpperPct:(high/entry-1)*100,maeLowerPct:(1-knownLow/entry)*100,maeUpperPct:(1-low/entry)*100,
  mfeUpperTimeFromEntryMin:(highBar.openTime-first.at)/60000,mfeUpperTimeFromEntryMax:(highBar.closeTime-first.at)/60000,
  tpProgressUpperPct:(high-entry)/(tp-entry)*100,barsToClose:bars.length,regime:p.regime,
  ambiguousExitBar:exitBar.low<=stop&&exitBar.high>=tp,openingBeyondTp:exitBar.open>=tp,openingBelowSl:exitBar.open<=stop,
  excursionPolicy:'OHLC bounds; exit-bar extremes may occur after exit; not exact tick excursions'});
}
const keys=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
fs.writeFileSync('reports/trades-audit.csv',[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
const metrics={rows:rows.length,differences,baseline:baseline.metrics,corrected:corrected.metrics,
 datasetHash:corrected.datasetHash,sourceDatasetSHA256:crypto.createHash('sha256').update(fs.readFileSync('reports/btcusdt-1m.json')).digest('hex'),
 distributions:Object.fromEntries(['mfeLowerPct','mfeUpperPct','maeLowerPct','maeUpperPct','stopDistancePct','stopATR','mfeUpperTimeFromEntryMin','barsToClose'].map(k=>[k,{min:Math.min(...rows.map(r=>r[k])),median:percentile(rows.map(r=>r[k]),.5),p90:percentile(rows.map(r=>r[k]),.9),max:Math.max(...rows.map(r=>r[k]))}])),
 nearTp80:rows.filter(r=>r.tpProgressUpperPct>=80).length,nearTp90:rows.filter(r=>r.tpProgressUpperPct>=90).length,
 ambiguous:rows.filter(r=>r.ambiguousExitBar).length,stopWithinRoundTripFee:rows.filter(r=>r.stopDistancePct<.2).length,
 costTotals:Object.fromEntries(['commissionsQuote','spreadCost','slippageCost','roundingCost'].map(k=>[k,rows.reduce((n,r)=>n+r[k],0)]))};
fs.writeFileSync('reports/trades-audit-summary.json',JSON.stringify(metrics,null,2));
console.log(JSON.stringify(metrics,null,2));
