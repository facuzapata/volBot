const fs=require('fs'),assert=require('assert/strict'),E=require('./engine.cjs'),IO=require('./io.cjs');
const {ROOT,read,write}=IO,{csv}=require('../signal-research/math.cjs');
function main(){
 const f=read(ROOT+'/plan.json');IO.check(f);const p=f.plan,s=read(ROOT+'/summary.json'),runs=IO.files(ROOT+'/runs').filter(p=>p.endsWith('.json')).map(file=>({file,r:read(file)}));
 const protectedBefore=read('reports/btc-v3/before.json');for(const path of ['docker-compose.yml','src/strategy/services/ai-analysis.service.ts','src/strategy/services/multi-user-strategy.service.ts'])assert.equal(IO.sha(path),protectedBefore.hashes[path]);
 const expected=30+21+90+30+3+4;assert.equal(runs.length,expected);assert.equal(s.attemptCount,expected);assert.equal(s.entriesEnabled,false);assert.equal(s.liveTradingEnabled,false);assert.equal(s.finalConsumed,false);
 assert.deepEqual(p.limits,{drawdown:0.05,exposure:0.8,riskPerTrade:0.005,dailyLoss:0.03});assert.equal(p.capital,500);assert.equal(p.candidates.length,7);
 const bars=IO.loadData(f),byTime=new Map(bars.map(b=>[b.openTime,b])),violations=[],imported=[];
 for(const {file,r}of runs){
  assert.equal(r.freezeHash,f.freezeHash);assert.equal(r.summary.candidateHash,E.canonicalHash(r.candidate));assert.equal(r.options.initialCapital,500);assert.equal(r.options.maxPositions,1);assert.equal(r.options.config.maxRiskPerTrade,.005);assert.equal(r.options.config.maxExposure,.8);assert.equal(r.options.config.dailyLossLimit,.03);
  assert.equal(r.summary.hash.dataset,r.datasetHash);assert.ok(Math.abs(r.summary.terminalLiquidationValue-500-r.summary.netUsdt)<1e-8);assert.ok(Math.abs(r.summary.netRealizedPnl+r.summary.unrealizedPnl+500-r.summary.equity)<1e-8);
  const spent=new Map();for(const fill of r.fills){
   assert.ok(fill.at<E.at(p.reserved.start));const t=Math.floor(fill.at/60000)*60000,prior=byTime.get(t-60000);assert.ok(prior);assert.equal(fill.liquiditySourceCloseTime,t-1);
   assert.ok(Math.abs(fill.liquidityCapacity-prior.volume*r.options.config.participationRate)<1e-8);spent.set(t,(spent.get(t)||0)+Number(fill.quantity));
  }
  for(const [t,qty]of spent)assert.ok(qty<=byTime.get(t-60000).volume*r.options.config.participationRate+1e-8,'Shared causal volume exceeded: '+file);
  for(const v of r.tradeRiskViolations){violations.push({file,candidate:r.summary.candidate,stage:r.summary.stage,cost:r.summary.costMultiplier,...v});assert.equal(r.summary.riskPass,false);}
  for(const [field,limit,kind]of [['maxDrawdown',.05,'MAX_DRAWDOWN'],['maxDailyLoss',.03,'MAX_DAILY_LOSS'],['maxExposure',.80000001,'MAX_EXPOSURE']])if(r.summary[field]>limit){violations.push({file,candidate:r.summary.candidate,stage:r.summary.stage,cost:r.summary.costMultiplier,kind,observed:r.summary[field],limit:kind==='MAX_EXPOSURE'?.8:limit,at:null});assert.equal(r.summary.riskPass,false);}
  if(r.summary.riskPass){assert.ok(r.summary.maxDrawdown<=.05);assert.ok(r.summary.maxDailyLoss<=.03);assert.ok(r.summary.maxExposure<=.80000001);}
  for(const pos of r.trades.filter(p=>p.status==='CLOSED')){const cap=Number(pos.executionRisk?.equityQuote)*.005;if(-Number(pos.realizedPnl)>cap+1e-8){assert.equal(r.summary.riskPass,false);assert.ok(r.tradeRiskViolations.some(v=>v.positionId===pos.id&&v.kind==='REALIZED_TRADE_LOSS'));}}
  if(r.summary.days<365)assert.equal(r.summary.annualizedReturn,null);
  if(r.reusedFrom){assert.equal(IO.sha(r.reusedFrom.path),r.reusedFrom.sha256);const old=read(r.reusedFrom.path);assert.deepEqual(r.fills,old.fills);assert.deepEqual(r.trades,old.trades);assert.equal(r.summary.netUsdt,old.summary.netUsdt);assert.equal(r.summary.hash.minuteEquity,old.summary.hash.minuteEquity);imported.push(file);}
 }
 for(const fold of s.foldSelections){assert.ok(fold.model.trainedThrough<E.at(fold.fold.trainEndExclusive));assert.equal(E.at(fold.fold.start)-E.at(fold.fold.trainEndExclusive),6*E.DAY);assert.ok(fold.training.every(r=>r.period.endExclusive===fold.fold.trainEndExclusive));if(fold.selected!=='USDT')assert.ok(fold.training.some(r=>r.candidate===fold.selected&&!r.failures.length));}
 const before=read(ROOT+'/operational-before.json'),after=read(ROOT+'/operational-after.json');assert.equal(before.stateHash,after.stateHash);assert.equal(after.approved,0);assert.equal(after.allPaused,true);assert.equal(after.inventoryRows,0);
 assert.equal(fs.existsSync(ROOT+'/final-started.json'),false);assert.equal(fs.existsSync(ROOT+'/final-manifest.json'),false);assert.ok(f.inputs.every(m=>m.month<'2025-04'));
 const test=read(ROOT+'/tests.json'),evidence=read(ROOT+'/test-evidence.json');assert.equal(test.numFailedTests,0);assert.equal(test.numPassedTests,evidence.unitPassed);assert.equal(evidence.researchPassed,11);assert.equal(evidence.integrationPassed,14);assert.equal(evidence.typecheck,true);assert.equal(evidence.lint,true);
 // Repeat one observed full-year imported replay; this is not a new model selection or final test.
 const source=read(ROOT+'/runs/development--p2-vol-economy--1.json'),cache=E.enrich(E.features(bars,4)),records=read(ROOT+'/calibration.json').records,models=E.modelBank(records,p);
 const input=bars.filter(b=>b.openTime>=E.at(p.development.start)-30*E.DAY&&b.openTime<E.at(p.development.endExclusive));
 const replay=E.simulate({bars:input,variant:p.candidates.find(v=>v.id==='p2-vol-economy'),plan:p,period:p.development,cost:1,cache,models});
 assert.deepEqual(replay.report.fills,source.fills);assert.deepEqual(JSON.parse(JSON.stringify(replay.report.trades)),source.trades);assert.deepEqual(replay.report.balance,source.balance);assert.equal(replay.summary.hash.minuteEquity,source.summary.hash.minuteEquity);assert.equal(replay.summary.netUsdt,source.summary.netUsdt);
 // Mutating unseen suffixes must not change earlier 4h features, confirmation or diagnostic inputs.
 const sample=bars.slice(0,30*1440),cut=25*1440,a=E.enrich(E.features(sample.slice(0,cut),4)),changed=E.enrich(E.features(sample.map((b,i)=>i<cut?b:{...b,open:b.open*3,high:b.high*3,low:b.low*3,close:b.close*3}),4));
 assert.ok(a.size>50);for(const [t,value]of a)assert.deepEqual(changed.get(t),value);
 fs.writeFileSync(ROOT+'/risk-violations.csv',csv(violations));
 const docs=['docs/net-optimization-phase2.md','docs/pullback-4h-research.md','docs/momentum-1h-research.md','docs/walk-forward-validation.md','docs/strategy-candidate-selection.md'];
 for(const path of docs)assert.ok(fs.statSync(path).size>1000);
 IO.check(f);const result={at:new Date().toISOString(),freezeHash:f.freezeHash,status:s.status,completedExperiments:expected,importedFullReplays:imported.length,newFullReplays:expected-imported.length,reproducibilityAuditReplays:1,fullYearFillsTradesBalanceAndMinuteEquityIdentical:true,priorResearchFilesUnchanged:true,originalAlgorithmsUnchanged:true,causalLiquidityVerifiedAllFills:true,futureMutationPrefixInvariant:true,embargoDays:6,observedEvaluation:true,finalConsumed:false,entriesEnabled:false,liveTradingEnabled:false,allOperationalAccountsPaused:true,operationalStateHash:after.stateHash,approved:0,unitPassed:evidence.unitPassed,researchPassed:11,integrationPassed:14,riskViolationRows:violations.length,seeds:{calibration:p.seed,dailyBootstrap:123456},deliverableHashes:Object.fromEntries([...docs,...IO.files(ROOT).filter(p=>/\.(csv|json|ndjson)$/.test(p)&&!p.endsWith('verification.json')),...IO.files('scripts/net-optimization-phase2')].filter(p=>!p.includes('__pycache__')).map(p=>[p,IO.sha(p)]))};
 result.environment={node:process.version,platform:process.platform,architecture:process.arch,packageLockHash:IO.sha('package-lock.json'),packageJsonHash:IO.sha('package.json')};
 write(ROOT+'/verification.json',result);console.log(JSON.stringify({...result,deliverableHashes:undefined}));
}
if(require.main===module)main();
