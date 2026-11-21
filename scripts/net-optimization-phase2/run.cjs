const fs=require('fs'),E=require('./engine.cjs'),IO=require('./io.cjs');
const {ROOT,read,write}=IO,{csv}=require('../signal-research/math.cjs');
function screen(rows,plan,minTrades=30){const p=E.holm(rows.map(s=>s.bootstrap.p??1));return rows.map((s,i)=>({...s,holmP:p[i],failures:[...E.closedGate(s,plan,minTrades),...(p[i]>plan.gates.familyWiseAlpha?['MULTIPLE_TEST_UNCERTAINTY']:[])]}));}
function periodBars(all,period){return all.filter(b=>b.openTime>=E.at(period.start)-30*E.DAY&&b.openTime<E.at(period.endExclusive));}
function slim(report){return {simulatorRevision:report.simulatorRevision,options:report.options,dataQuality:report.dataQuality,executionPolicy:report.executionPolicy,datasetHash:report.datasetHash,trades:report.trades,orders:report.orders,fills:report.fills,ledger:report.ledger,decisions:report.decisions,balance:report.balance,tradeRiskViolations:report.tradeRiskViolations,hourlyEquity:report.equityCurve.filter((_,i)=>i%60===59)};}
function main(){
 if(process.argv[2]==='freeze')return IO.freeze();
 const f=read(ROOT+'/plan.json');IO.check(f);const p=f.plan,all=IO.loadData(f),four=E.enrich(E.features(all,4)),one=E.features(all,1),records=E.labels(all,four,p),bank=E.modelBank(records,p);
 write(ROOT+'/calibration.json',{records,monthlyModels:[...bank],seed:p.seed});
 const momentum={id:'momentum-1h',family:'momentum',hours:1,stopAtr:2,rewardRisk:3,holdHours:48,change:'original'},v2={id:'btc-v2',family:'reference',hours:1},v3={id:'btc-v3',family:'reference',hours:1};
 const variants=[...p.candidates,momentum,v2,v3],v3Model=read('reports/btc-v3/calibration-final.json');
 console.log('Precomputing causal BTC-V2 technical signals; execution remains scenario-specific');
 let v2Cache;
 const cacheFile=ROOT+'/v2-signals.json';if(fs.existsSync(cacheFile)){const c=read(cacheFile);if(c.freezeHash!==f.freezeHash)throw Error('Signal cache mismatch');v2Cache=new Map(c.signals);}else{v2Cache=E.buildV2Cache(all,p);write(cacheFile,{freezeHash:f.freezeHash,signals:[...v2Cache]});}
 const attempts=[],summaries=[];
 function evaluate(stage,period,v,cost,models=bank,extra={}){
  const key=`${stage}--${v.id}--${cost}${extra.slippageMultiplier?'-slip-'+extra.slippageMultiplier:''}`,file=`${ROOT}/runs/${key}.json`;
  if(fs.existsSync(file)){const r=read(file);if(r.freezeHash!==f.freezeHash)throw Error('Run mismatch');summaries.push(r.summary);return r.summary;}
  const priorFile=`reports/net-optimization-phase2-attempt-v1/runs/${key}.json`;
  if(fs.existsSync(priorFile)){
   const r=read(priorFile),prior=read('reports/net-optimization-phase2-attempt-v1/plan.json'),{version:pv,...oldPlan}=prior.plan,{version:nv,technicalRevision,...newPlan}=p;
   if(E.canonicalHash(oldPlan)!==E.canonicalHash(newPlan)||E.canonicalHash(r.candidate)!==E.canonicalHash(v))throw Error('Cannot import changed financial experiment');
   const originalResultHash=IO.sha(priorFile);r.reusedFrom={path:priorFile,sha256:originalResultHash,freezeHash:r.freezeHash,reason:'Metadata-only canonical fingerprint correction; original executed trajectory retained'};
   r.freezeHash=f.freezeHash;r.summary.candidateHash=E.canonicalHash(v);r.summary.hash.candidate=r.summary.candidateHash;write(file,r);summaries.push(r.summary);
   fs.appendFileSync(ROOT+'/attempts.ndjson',JSON.stringify({key,state:'IMPORTED_COMPLETED_REPLAY',source:priorFile,originalResultHash,at:new Date().toISOString()})+'\n');return r.summary;
  }
  fs.mkdirSync(ROOT+'/runs',{recursive:true});fs.appendFileSync(ROOT+'/attempts.ndjson',JSON.stringify({key,state:'STARTED',at:new Date().toISOString(),freezeHash:f.freezeHash})+'\n');
  const bars=periodBars(all,period),cache=v.hours===4?four:one,t=Date.now();
  try{const {report,summary}=E.simulate({bars,variant:v,plan:p,period,cost,cache,models,v2Cache,v3Model,...extra});summary.stage=stage;summary.period=period;
   write(file,{freezeHash:f.freezeHash,candidate:v,summary,...slim(report)});summaries.push(summary);
   fs.appendFileSync(ROOT+'/attempts.ndjson',JSON.stringify({key,state:'COMPLETED',resultHash:IO.sha(file),at:new Date().toISOString()})+'\n');
   console.log(JSON.stringify({stage,id:v.id,cost,net:summary.netUsdt,n:summary.closedTrades,risk:summary.riskPass,seconds:(Date.now()-t)/1000}));return summary;
  }catch(e){fs.appendFileSync(ROOT+'/attempts.ndjson',JSON.stringify({key,state:'FAILED',error:e.message,at:new Date().toISOString()})+'\n');throw e;}
 }
 function refs(stage,period){const bars=periodBars(all,period);return p.costs.flatMap(cost=>E.benchmarks(bars,period,p,cost).map(s=>({...s,stage,period,reference:true})));}
 const development=[];for(const v of variants)for(const cost of p.costs)development.push(evaluate('development',p.development,v,cost));
 const windows=[],foldSelections=[],foldModels=new Map();
 for(const fold of p.folds){
  const trainPeriod={start:fold.trainStart,endExclusive:fold.trainEndExclusive},valPeriod={start:fold.start,endExclusive:fold.endExclusive};
  const m=E.fitModel(records,E.at(fold.trainStart),E.at(fold.trainEndExclusive),p);foldModels.set(fold.id,m);
  const train=p.candidates.map(v=>evaluate(fold.id+'-train',trainPeriod,v,1));
  const screened=screen(train,p),eligible=screened.filter(s=>!s.failures.length).sort((a,b)=>b.netUsdt-a.netUsdt||a.candidate.localeCompare(b.candidate));
  const selection={fold,selected:eligible[0]?.candidate??'USDT',training:screened,model:m,selectionUsesOnlyTraining:true};
  const selectionFile=`${ROOT}/${fold.id}-selection.json`;if(fs.existsSync(selectionFile)&&E.hash(read(selectionFile))!==E.hash(selection))throw Error('Fold selection changed');write(selectionFile,selection);foldSelections.push(selection);
  // The entire set is evaluated for a descriptive comparison, without changing the prior selection.
  for(const v of variants)for(const cost of p.costs)windows.push(evaluate(fold.id+'-evaluation',valPeriod,v,cost,m));
 }
 function modelAt(t){const fold=p.folds.find(fold=>t>=E.at(fold.start)&&t<E.at(fold.endExclusive));return fold&&foldModels.get(fold.id);}
 function dynamicVariant(v,selected=false,cost=1){
  const lookup=new Map();for(const fold of p.folds){
   const id=selected?foldSelections.find(s=>s.fold.id===fold.id).selected:v.id;
   const spec=variants.find(v=>v.id===id);
   lookup.set(fold.id,spec?spec.change&&spec.change!=='original'?new E.PhaseStrategy(spec,spec.hours===4?four:one,p,foldModels.get(fold.id)):new E.ResearchStrategy(spec,spec.hours===4?four:one):null);
  }
  return {invalidated:()=>false,evaluate(h,slot,cfg){const time=h['1m'].at(-1)?.closeTime,fold=p.folds.find(fold=>time>=E.at(fold.start)&&time<E.at(fold.endExclusive));return lookup.get(fold?.id)?.evaluate(h,slot,cfg)??null;}};
 }
 const continuous=[];
 for(const v of variants)for(const cost of p.costs){const override=v.id.startsWith('btc-')?undefined:dynamicVariant(v,false,cost);continuous.push(evaluate('continuous',p.continuous,v,cost,null,{strategyOverride:override}));}
 for(const cost of p.costs)evaluate('selected-policy',p.continuous,{id:'selected-policy',hours:4,family:'portfolio'},cost,null,{strategyOverride:dynamicVariant(null,true,cost)});
 for(const stage of p.searchBudget.additionalSlippageReplay.periods)for(const slip of p.searchBudget.additionalSlippageReplay.slippageMultipliers){const period=stage==='development'?p.development:p.continuous;evaluate('slippage-'+stage,period,momentum,1,bank,{slippageMultiplier:slip});}
 const devScreen=screen(development.filter(r=>r.costMultiplier===1&&!r.candidate.startsWith('btc-')),p),contScreen=screen(continuous.filter(r=>r.costMultiplier===1&&!r.candidate.startsWith('btc-')),p,p.gates.continuousTrades);
 const candidates=contScreen.filter(s=>p.candidates.some(v=>v.id===s.candidate)).map(s=>{
  const fail=[...s.failures],dev=devScreen.find(d=>d.candidate===s.candidate),evals=windows.filter(r=>r.candidate===s.candidate);
  if(dev.failures.length)fail.push('DEVELOPMENT_REJECTED');if(Object.keys(s.closedByQuarter).length!==3||Object.values(s.closedByQuarter).some(n=>n<p.gates.validationTrades))fail.push('WINDOW_SAMPLE');
  if(s.positiveQuarterFraction<p.gates.positiveQuarterFraction)fail.push('TEMPORAL_INSTABILITY');
  for(const cost of p.costs){const c=continuous.find(r=>r.candidate===s.candidate&&r.costMultiplier===cost),w=evals.filter(r=>r.costMultiplier===cost);if(!c.riskPass||c.netUsdt<=0||w.some(r=>!r.riskPass)||w.filter(r=>r.netUsdt>0).length<2)fail.push('COST_OR_WINDOW_'+cost);}
  return {...s,failures:[...new Set(fail)],qualified:!fail.length};
 });
 const benchmarks=[...refs('development',p.development),...p.folds.flatMap(fold=>refs(fold.id+'-evaluation',{start:fold.start,endExclusive:fold.endExclusive})),...refs('continuous',p.continuous)];
 const qualified=candidates.filter(c=>c.qualified).sort((a,b)=>b.netUsdt-a.netUsdt),summary={freezeHash:f.freezeHash,status:qualified.length?'CANDIDATE_FROZEN_PENDING_INDEPENDENT_EVIDENCE':'NO_QUALIFIED_STRATEGY',development:devScreen,continuousCandidates:candidates,continuousReferences:continuous.filter(c=>!p.candidates.some(v=>v.id===c.candidate)),walkForward:windows,foldSelections,selectedPolicy:summaries.filter(s=>s.stage==='selected-policy'),slippage:summaries.filter(s=>s.stage.startsWith('slippage-')),benchmarks,qualified:qualified.map(c=>c.candidate),contamination:p.contamination,entriesEnabled:false,liveTradingEnabled:false,finalConsumed:false,attemptCount:summaries.length};
 if(qualified.length)write(ROOT+'/candidate-freeze.json',{parentFreeze:f.freezeHash,candidate:variants.find(v=>v.id===qualified[0].candidate),evidence:qualified[0],models:[...foldModels],codeHashes:f.sourceHashes,finalConsumed:false});
 write(ROOT+'/summary.json',summary);
 const flat=summaries.map(({daily,...s})=>s);fs.writeFileSync(ROOT+'/experiments.csv',csv(flat));fs.writeFileSync(ROOT+'/walk-forward-results.csv',csv(flat.filter(s=>s.stage.startsWith('wf')||s.stage==='continuous'||s.stage==='selected-policy')));fs.writeFileSync(ROOT+'/cost-sensitivity.csv',csv(flat.filter(s=>!s.stage.endsWith('-train'))));fs.writeFileSync(ROOT+'/strategy-comparison.csv',csv([...flat.filter(s=>!s.stage.endsWith('-train')),...benchmarks]));
 IO.check(f);console.log(JSON.stringify({status:summary.status,runs:summaries.length,qualified:summary.qualified,finalConsumed:false}));
}
if(require.main===module)main();module.exports={screen,periodBars};
