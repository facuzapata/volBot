const fs=require('fs'),crypto=require('crypto');
const {StrategyEngine}=require('../../dist/v2/strategy/strategy-engine');
const {CandleAggregator}=require('../../dist/v2/backtesting/backtesting.engine');
const {strategyConfiguration}=require('../../dist/v2/strategy/versions');
const {BTC_V3_REVISION,v3ParametersHash}=require('../../dist/v2/strategy/btc-v3.config');
const {validCandle}=require('../../dist/v2/market/public-market.client');
const {forward,blockBootstrap,quantile,seedOf}=require('../signal-research/math.cjs');
const plan=JSON.parse(fs.readFileSync('docs/btc-v3-plan.json'));const frozen=JSON.parse(fs.readFileSync('reports/btc-v3/initial-freeze.json'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const technicalChanges=Object.entries(frozen.sourceHashes).filter(([p,h])=>sha(fs.readFileSync(p))!==h).map(([p])=>p);
if(technicalChanges.length&&!process.argv.includes('--technical-refit'))throw new Error('Code changed after initial freeze; document technical correction explicitly: '+technicalChanges.join(','));
if(technicalChanges.length)fs.writeFileSync('reports/btc-v3/technical-amendments.json',JSON.stringify({beforeFinalOos:true,changedSource:technicalChanges,thresholdsUnchanged:true,reasons:['Recheck queued BUY pause/owner status','Bind calibration to full parameter hash and horizon; synchronize holding horizon','Bootstrap seed and training provenance depend only on prior selected training records'],calibrationLabelsReusedWithoutSelection:true},null,2));
const config=strategyConfiguration('btc-v3'),manifest=JSON.parse(fs.readFileSync('reports/research-manifest.json'));
const cached=process.argv.includes('--refit-metadata')?JSON.parse(fs.readFileSync('reports/btc-v3/calibration-records.json')):null;
const records=cached?.records??[],datasets=cached?.datasets??[];
for(const month of cached?[]:plan.calibration.trainingPeriods){
 const period=manifest.find(p=>p.month===month),file=`reports/research-data/${month}.json`,bars=JSON.parse(fs.readFileSync(file)).filter(validCandle),index=new Map(bars.map((c,i)=>[c.openTime,i]));datasets.push({period:month,sha256:sha(fs.readFileSync(file))});
 let engine=new StrategyEngine(),agg=new CandleAggregator(),history={'1m':[],'5m':[],'1h':[]},previous,lastLabelEnd=0,structural=0;
 for(const c of bars){
  if(previous!==undefined&&c.openTime!==previous+60000){history={'1m':[],'5m':[],'1h':[]};agg=new CandleAggregator();engine=new StrategyEngine()}previous=c.openTime;
  for(const x of [c,...agg.push(c)]){history[x.timeframe].push(x);history[x.timeframe]=history[x.timeframe].slice(-100)}
  engine.evaluate(history,'btc-v3',config);const a=engine.lastV3Assessment;
  if(c.openTime<period.start||!a?.structuralEligible)continue;structural++;
  const entryTime=c.closeTime+1;if(entryTime<=lastLabelEnd)continue;
  const o=forward(bars,index,entryTime,plan.horizonMinutes);if(!o.complete||o.endTime>=period.end)continue;
  records.push({period:month,at:c.closeTime,entryTime,labelEnd:o.endTime,day:new Date(c.closeTime).toISOString().slice(0,10),atrFraction:a.features.atr5mFraction,returnFraction:o.returnPct/100,mfeFraction:o.mfePct/100});lastLabelEnd=o.endTime;
 }
 console.log(`${month}: structural minutes=${structural}, nonoverlapping calibration labels=${records.filter(r=>r.period===month).length}`);
}
function modelBefore(cutoff){
 const use=records.filter(r=>r.labelEnd<cutoff),bounds=plan.calibration.atr5mFractionBins;
 const trainingHash=sha(JSON.stringify({datasets:datasets.filter(d=>manifest.find(p=>p.month===d.period).end<=cutoff),records:use}));
 const bins=bounds.slice(0,-1).map((low,i)=>{const high=bounds[i+1],rows=use.filter(r=>r.atrFraction>=low&&r.atrFraction<high),ci=blockBootstrap(rows.map(r=>({period:r.period,day:r.day,value:r.returnFraction})),{seed:seedOf(plan.calibration.seed+':'+trainingHash+':'+i),reps:plan.calibration.replicates});return{low,high,samples:rows.length,days:new Set(rows.map(r=>r.day)).size,meanReturn:ci.mean??0,meanReturnLower95:ci.low??0,mfeP25:quantile(rows.map(r=>r.mfeFraction),.25)??0}});
 const model={revision:BTC_V3_REVISION,parametersHash:v3ParametersHash(config.btcV3),horizonMinutes:config.btcV3.horizonMinutes,trainedThrough:use.length?Math.max(...use.map(r=>r.labelEnd)):0,trainingHash,bins};return{id:sha(JSON.stringify(model)),...model};
}
const versions=Object.fromEntries([...manifest.map(p=>[p.month,p.start]),['2025-01-original',Date.UTC(2025,0,1)]].map(([month,start])=>[month,modelBefore(start)]));
const final=modelBefore(Date.UTC(2024,2,1));
fs.writeFileSync('reports/btc-v3/calibration-records.json',JSON.stringify({datasets,records,planHash:frozen.planHash},null,2));
fs.writeFileSync('reports/btc-v3/calibration-walk-forward.json',JSON.stringify(versions,null,2));
fs.writeFileSync('reports/btc-v3/calibration-final.json',JSON.stringify(final,null,2));
console.log(JSON.stringify({finalModel:final.id,totalLabels:records.length,bins:final.bins}));
