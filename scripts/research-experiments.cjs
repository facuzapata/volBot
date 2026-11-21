// Preregistered, one-variable comparisons. This does not approve or enable any strategy.
const fs=require('fs');const crypto=require('crypto');
const {BacktestingEngine}=require('../dist/v2/backtesting/backtesting.engine');
const {StrategyEngine}=require('../dist/v2/strategy/strategy-engine');
const {SIMULATOR_REVISION}=require('../dist/v2/domain/model');
const {validCandle}=require('../dist/v2/market/public-market.client');
const {configurationHash}=require('../dist/v2/strategy/approval.service');
const allPeriods=JSON.parse(fs.readFileSync('reports/research-manifest.json'));
const monthArg=process.argv[2]; const manifest=monthArg?allPeriods.filter(p=>p.month===monthArg):allPeriods;
if(!manifest.length)throw new Error('Unknown registered period');
const output=name=>monthArg?`reports/experiments/${monthArg}/${name}`:`reports/${name}`;
if(monthArg)fs.mkdirSync(`reports/experiments/${monthArg}`,{recursive:true});
const variants=[
 ['A-current',{},'unchanged entry/exit parameters, corrected simulator'],
 ['B-atr-1.5',{stopModel:'ATR_ONLY',atrMultiplier:1.5},'replace structure+ATR by pure 1.5 ATR'],
 ['C-atr-2',{stopModel:'ATR_ONLY',atrMultiplier:2},'ATR-only family: multiplier 2 vs B'],
 ['D-atr-2.5',{stopModel:'ATR_ONLY',atrMultiplier:2.5},'ATR-only family: multiplier 2.5 vs B'],
 ['E-tp-0.006',{takeProfit:.006},'TP only: 0.6%'],['E-tp-0.008',{takeProfit:.008},'TP only: 0.8%'],
 ['E-tp-0.012',{takeProfit:.012},'TP only: 1.2%; TP1% is A'],
 ['F-1h-only',{confirmation5m:false},'remove only 5m confirmation; 1h remains mandatory'],
 ['H-without-time',{timeExit:false},'remove only time exit'],['H-without-invalidation',{invalidationExit:false},'remove only invalidation exit'],
 ['ablate-primary',{trendFilter:false},'remove only primary 1h entry filter'],
 ['ablate-rsi',{disabledConditions:['rsiEntry']},'remove only entry RSI filter'],
 ['ablate-macd',{disabledConditions:['macdEntry']},'remove only entry MACD histogram filter'],
 ['ablate-volume',{disabledConditions:['volume']},'remove only volume filter'],
 ['ablate-candle',{disabledConditions:['candle']},'remove only green/engulfing filter'],
 ['ablate-structure',{disabledConditions:['structure']},'remove only price/SMA21 structure filter'],
 ['cost-no-fee',{feeRate:0},'counterfactual: remove fees only'],
 ['cost-no-spread',{spreadBps:0},'counterfactual: remove spread only'],
 ['cost-no-slippage',{slippageBps:0},'counterfactual: remove slippage only'],
];
const csv=(rows)=>{const keys=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';return [keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n'};
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]:null;
function excursions(trades,bars){
 const map=new Map(bars.map((c,i)=>[c.openTime,i])); const mfes=[],maes=[];
 for(const p of trades.filter(p=>p.entryQuantity!=='0'&&Number(p.entryQuantity)>0)){
  const start=map.get(Math.floor(p.openedAt/60000)*60000);const end=map.get(Math.floor((p.closedAt??bars.at(-1).closeTime)/60000)*60000);
  if(start===undefined||end===undefined) continue;let hi=Number(p.averageEntry),lo=hi;
  for(let i=start;i<=end;i++){hi=Math.max(hi,bars[i].high);lo=Math.min(lo,bars[i].low);}
  mfes.push((hi/Number(p.averageEntry)-1)*100);maes.push((1-lo/Number(p.averageEntry))*100);
 }
 return {mfeUpperMedianPct:percentile(mfes,.5),maeUpperMedianPct:percentile(maes,.5)};
}
const rows=[];const conditions=[];let runIndex=0;
// The plan's final test is processed LAST, with exactly the same frozen variants.
for(const period of manifest){
 const originalBars=JSON.parse(fs.readFileSync(`reports/research-data/${period.month}.json`));
 const quarantined=originalBars.filter(c=>!validCandle(c));
 if(quarantined.length) fs.writeFileSync(`reports/research-data/${period.month}.quarantine.json`,JSON.stringify({reason:'invalid or shortened closed candle; do not repair OHLC/timestamps',bars:quarantined},null,2));
 const bars=originalBars.filter(validCandle);
 const active=bars.filter(c=>c.openTime>=period.start);const returns=active.slice(1).map((c,i)=>Math.log(c.close/active[i].close));
 const mean=returns.reduce((a,b)=>a+b,0)/returns.length;const vol=Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/returns.length)*Math.sqrt(1440)*100;
 const marketReturn=(active.at(-1).close/active[0].open-1)*100;
 for(const [name,config,change] of variants){
  class ObservedStrategy extends StrategyEngine { constructor(){super();this.counts={};this.eligible=0;this.total=0;} evaluate(h,s,c){const r=super.evaluate(h,s,c);const a=this.lastAssessment;if(a&&a.at>=period.start){this.total++;if(a.eligible)this.eligible++;for(const [key,value] of Object.entries(a.conditions)){this.counts[key]??={pass:0,fail:0};this.counts[key][value?'pass':'fail']++;}}return r;} }
  const strategy=new ObservedStrategy();const report=new BacktestingEngine(strategy).run(bars,{strategy:'btc-v2',initialCapital:500,maxPositions:5,usdtPerTrade:30,config,allowDataGaps:true},period.start,period.end-1);
  const m=report.metrics;const trips=report.trades.filter(p=>p.status==='CLOSED');
  const closedIds=new Set(trips.map(p=>p.id));
  const grossPnl=trips.reduce((n,p)=>n+Number(p.realizedPnl),0)+report.fills.filter(f=>closedIds.has(f.positionId)).reduce((n,f)=>n+Number(f.commissionQuote??f.commission),0);
  const row={period:period.month,split:period.split,variant:name,changedVariable:change,simulatorRevision:SIMULATOR_REVISION,
   datasetHash:report.datasetHash,configHash:configurationHash('btc-v2',report.strategyRevision,report.options.config),quarantinedBars:quarantined.length,
   marketReturnPct:marketReturn,marketDailyVolPct:vol,tradeMinutes:active.length,gaps:report.dataQuality.gapCount,
   trades:m.closedTrades,openPositions:m.openPositions,netRealizedPnl:m.netRealizedPnl,unrealizedPnl:m.unrealizedPnl,
   netEquityPnl:m.equity-500,returnPct:(m.equity/500-1)*100,maxDrawdownPct:m.maxDrawdown*100,
   profitFactor:m.profitFactor,expectancy:m.expectancy,winRatePct:m.winRate*100,commissions:m.totalCommissions,
   spreadCost:report.fills.reduce((n,f)=>n+Number(f.spreadCostQuote??0),0), slippageCost:report.fills.reduce((n,f)=>n+Number(f.slippageCostQuote??0),0), roundingCost:report.fills.reduce((n,f)=>n+Number(f.roundingCostQuote??0),0),
   grossPnlClosedPlusFees:grossPnl,capitalImmobilized:m.immobilizedCapital,maxSimultaneous:m.maxSimultaneous,
   averageHoldingMinutes:m.averageHoldingMs/60000,...excursions(report.trades,bars),eligibleBars:strategy.eligible,assessedBars:strategy.total,
   regimeBreakdown:JSON.stringify(m.regimes)};
  rows.push(row);
  if(name==='A-current') for(const [filter,counts] of Object.entries(strategy.counts)) conditions.push({period:period.month,split:period.split,filter,...counts,eligible:strategy.eligible,assessed:strategy.total});
  fs.writeFileSync(output('strategy-comparison.csv'),csv(rows));fs.writeFileSync(output('strategy-comparison.json'),JSON.stringify(rows,null,2));
  fs.writeFileSync(output('filter-diagnostics.json'),JSON.stringify(conditions,null,2));
  console.log(`${++runIndex}/${manifest.length*variants.length}: ${period.month} ${name} net=${row.netEquityPnl.toFixed(4)} closed=${m.closedTrades}`);
 }
 rows.push({ ...rows.at(-1),variant:'USDT-cash',changedVariable:'do not trade; same virtual starting capital', configHash:'not-applicable',trades:0,openPositions:0,netRealizedPnl:0,unrealizedPnl:0,netEquityPnl:0,returnPct:0,maxDrawdownPct:0,profitFactor:null,expectancy:0,winRatePct:0,commissions:0,spreadCost:0,slippageCost:0,roundingCost:0,grossPnlClosedPlusFees:0,capitalImmobilized:0,maxSimultaneous:0,averageHoldingMinutes:0,mfeUpperMedianPct:0,maeUpperMedianPct:0,eligibleBars:0,assessedBars:0,regimeBreakdown:'{}'});
 fs.writeFileSync(output('strategy-comparison.csv'),csv(rows));fs.writeFileSync(output('strategy-comparison.json'),JSON.stringify(rows,null,2));
}
fs.writeFileSync(output('experiment-variants.json'),JSON.stringify({simulatorRevision:SIMULATOR_REVISION,variants,aliases:{'E-tp-0.01':'A-current','G-1h-5m':'A-current'},selection:'none; no strategy approved'},null,2));
