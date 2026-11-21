const fs=require('fs'),crypto=require('crypto');
const {BacktestingEngine}=require('../../dist/v2/backtesting/backtesting.engine');
const {BacktestingEngine:PreviousEngine}=require('../../reports/btc-v3/previous-runtime/v2/backtesting/backtesting.engine');
const {StrategyEngine}=require('../../dist/v2/strategy/strategy-engine');
const {configurationHash}=require('../../dist/v2/strategy/approval.service');
const {validCandle}=require('../../dist/v2/market/public-market.client');
const {csv,mean,quantile}=require('../signal-research/math.cjs');
const root='reports/btc-v3',plan=JSON.parse(fs.readFileSync('docs/btc-v3-plan.json'));
const manifests=JSON.parse(fs.readFileSync('reports/research-manifest.json'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const allPeriods=[{month:'2025-01-original',start:Date.UTC(2025,0,1),end:Date.UTC(2025,0,8),input:'reports/btcusdt-1m.json'},...manifests.map(p=>({...p,input:`reports/research-data/${p.month}.json`}))];
function summarize(report,period,variant,bars){
 const m=report.metrics,closed=report.trades.filter(p=>p.status==='CLOSED'),risks=report.orders.filter(o=>o.side==='BUY'&&o.executionRisk).map(o=>o.executionRisk),reasons={};
 for(const d of report.decisions.filter(d=>!d.accepted))reasons[d.reason]=(reasons[d.reason]??0)+1;
 for(const o of report.orders.filter(o=>o.status==='REJECTED'))reasons[o.rejection]=(reasons[o.rejection]??0)+1;
 const byTime=new Map(bars.map((c,i)=>[c.openTime,i])),mfe=[],mae=[];
 for(const p of report.trades.filter(p=>Number(p.entryQuantity)>0)){const fills=report.fills.filter(f=>f.positionId===p.id&&f.side==='BUY'),start=byTime.get(Math.floor(fills[0].at/60000)*60000),end=byTime.get(Math.floor((p.closedAt??report.lastTime)/60000)*60000);if(start===undefined||end===undefined)continue;let hi=Number(p.averageEntry),lo=hi;for(let i=start;i<=end;i++){hi=Math.max(hi,bars[i].high);lo=Math.min(lo,bars[i].low)}mfe.push((hi/Number(p.averageEntry)-1)*100);mae.push((1-lo/Number(p.averageEntry))*100)}
 return {period:period.month,split:period.split??'observed-exploratory',variant,strategy:report.strategy,strategyRevision:report.strategyRevision,simulatorRevision:report.simulatorRevision,datasetHash:report.datasetHash,configHash:configurationHash(report.strategy,report.strategyRevision,report.options.config,report.simulatorRevision),calibrationId:report.options.config.btcV3Calibration?.id??'',calibrationTrainedThrough:report.options.config.btcV3Calibration?.trainedThrough??'',closedTrades:m.closedTrades,wins:closed.filter(p=>Number(p.realizedPnl)>0).length,losses:closed.filter(p=>Number(p.realizedPnl)<0).length,flat:closed.filter(p=>Number(p.realizedPnl)===0).length,openPositions:m.openPositions,netRealizedPnl:m.netRealizedPnl,unrealizedPnl:m.unrealizedPnl,netEquityPnl:m.equity-500,returnPct:(m.equity/500-1)*100,maxDrawdownPct:m.maxDrawdown*100,profitFactor:m.profitFactor,expectancy:m.expectancy,winRatePct:m.winRate*100,totalCommissions:m.totalCommissions,spreadCost:report.fills.reduce((n,f)=>n+Number(f.spreadCostQuote??0),0),slippageCost:report.fills.reduce((n,f)=>n+Number(f.slippageCostQuote??0),0),roundingCost:report.fills.reduce((n,f)=>n+Number(f.roundingCostQuote??0),0),averageHoldingMinutes:m.averageHoldingMs/60000,mfeUpperMeanPct:mean(mfe),maeUpperMeanPct:mean(mae),mfeUpperMedianPct:quantile(mfe,.5),maeUpperMedianPct:quantile(mae,.5),maxEstimatedNetStopLoss:risks.length?Math.max(...risks.filter(r=>r.accepted).map(r=>Number(r.estimatedNetStopLoss)),0):null,riskAssessedEntries:risks.length,executionRejections:report.orders.filter(o=>o.status==='REJECTED').length,rejectionReasons:JSON.stringify(reasons),abstentions:JSON.stringify(report.abstentions??{}),capitalImmobilized:m.immobilizedCapital,maxSimultaneous:m.maxSimultaneous,regimes:JSON.stringify(m.regimes)};
}
function evaluate(period,model){
 const bars=JSON.parse(fs.readFileSync(period.input)).filter(validCandle),options={strategy:'btc-v2',initialCapital:500,maxPositions:5,usdtPerTrade:30,allowDataGaps:true},rows=[];
 const dir=`${root}/${period.split==='new-final-oos'?'final-oos':'observed'}/${period.month}`;fs.mkdirSync(dir,{recursive:true});
 for(const [variant,strategy,engine]of [['v2-previous-simulator','btc-v2',new PreviousEngine()],['v2-corrected-simulator','btc-v2',new BacktestingEngine()],['v3-corrected-simulator','btc-v3',new BacktestingEngine()],['trend-reference','trend-reference',new BacktestingEngine()]]){
  const config=strategy==='btc-v3'?{btcV3Calibration:model}:{};
  const report=engine.run(bars,{...options,strategy,config},period.start,period.end-1);
  fs.writeFileSync(`${dir}/${variant}.json`,JSON.stringify(report));
  rows.push(summarize(report,period,variant,bars));console.log(`${period.month} ${variant}: closed=${report.metrics.closedTrades}, net=${(report.metrics.equity-500).toFixed(6)}`);
 }
 rows.push({...rows[0],variant:'USDT-cash',strategy:'cash',strategyRevision:'not-applicable',simulatorRevision:rows[1].simulatorRevision,configHash:'not-applicable',closedTrades:0,wins:0,losses:0,flat:0,openPositions:0,netRealizedPnl:0,unrealizedPnl:0,netEquityPnl:0,returnPct:0,maxDrawdownPct:0,profitFactor:null,expectancy:0,winRatePct:0,totalCommissions:0,spreadCost:0,slippageCost:0,roundingCost:0,averageHoldingMinutes:0,mfeUpperMeanPct:null,maeUpperMeanPct:null,mfeUpperMedianPct:null,maeUpperMedianPct:null,maxEstimatedNetStopLoss:null,riskAssessedEntries:0,executionRejections:0,rejectionReasons:'{}',abstentions:'{}',capitalImmobilized:0,maxSimultaneous:0,regimes:'{}'});
 return rows;
}
function checkV2Compatibility(){
 const {StrategyEngine:OldStrategy}=require('../../reports/btc-v3/previous-runtime/v2/strategy/strategy-engine');const {CandleAggregator}=require('../../dist/v2/backtesting/backtesting.engine');
 const bars=JSON.parse(fs.readFileSync('reports/btcusdt-1m.json')),history={'1m':[],'5m':[],'1h':[]},agg=new CandleAggregator(),a=new StrategyEngine(),b=new OldStrategy();let checked=0,signals=0;
 for(const c of bars){for(const x of[c,...agg.push(c)]){history[x.timeframe].push(x);history[x.timeframe]=history[x.timeframe].slice(-100)}const x=a.evaluate(history,'btc-v2'),y=b.evaluate(history,'btc-v2');if(JSON.stringify(x)!==JSON.stringify(y))throw new Error('BTC-V2 signal behavior changed');checked++;if(x)signals++}
 fs.writeFileSync(root+'/v2-signal-compatibility.json',JSON.stringify({candlesChecked:checked,eligibleMinutes:signals,identicalSignals:true},null,2));
}
if(require.main===module){
 const mode=process.argv[2]??'observed';
 if(mode!=='observed')throw new Error('Final OOS is gated through run-final.cjs');
 checkV2Compatibility();
 const models=JSON.parse(fs.readFileSync(root+'/calibration-walk-forward.json'));
 const rows=[];for(const p of allPeriods){p.split='observed-exploratory';rows.push(...evaluate(p,models[p.month]));fs.writeFileSync(root+'/comparison-observed.csv',csv(rows));fs.writeFileSync(root+'/comparison-observed.json',JSON.stringify(rows,null,2))}
 console.log(`Observed evaluation complete: ${rows.length} comparison rows, no approvals`);
}
module.exports={evaluate,hash,allPeriods};
