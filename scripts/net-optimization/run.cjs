const fs=require('fs'),path=require('path');
const E=require('./engine.cjs'),{csv}=require('../signal-research/math.cjs');
const ROOT='reports/net-optimization';
const fileHash=p=>E.hash(fs.readFileSync(p).toString());
function write(p,x){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(x,null,2));}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function freeze(){
 if(fs.existsSync(ROOT+'/freeze.json'))throw Error('Existing freeze must not be overwritten');
 const plan=JSON.parse(fs.readFileSync('scripts/net-optimization/plan.json'));
 const paths=[...files('scripts/net-optimization').filter(p=>!/(__pycache__|\.pyc$)/.test(p)),...files('dist/v2').filter(p=>p.endsWith('.js')),...files('dist/utils').filter(p=>p.endsWith('.js')),'scripts/signal-research/math.cjs','scripts/download-research.py'];
 const f={at:new Date().toISOString(),plan,hashes:Object.fromEntries(paths.map(p=>[p,fileHash(p)])),operationalPolicy:'offline only; no deployment; no automatic PAPER/live entries or approvals',holdoutAudit:{scope:'workspace and this session only',previousReports:'All observed intervals end before 2025-04-01; March 2025 is now selection data, not new OOS.'}};
 // Check raw candle datasets without trusting filenames. Exclude credentials and non-dataset reports.
 const known=['reports/btcusdt-1m.json',...files('reports/research-data').filter(p=>p.endsWith('.json')&&!p.includes('quarantine')),'reports/btc-v3/oos-data/2025-03.json'];
 f.holdoutAudit.coverage=known.map(p=>{const a=JSON.parse(fs.readFileSync(p));return {path:p,first:a[0].openTime,last:a.at(-1).closeTime};});
 if(f.holdoutAudit.coverage.some(x=>x.last>=Date.parse(plan.final.start)))throw Error('Holdout already overlaps known data');
 f.hash=E.hash(f);write(ROOT+'/freeze.json',f);console.log('Frozen plan and executable SHA256 '+f.hash);
}
function loadFreeze(){const f=JSON.parse(fs.readFileSync(ROOT+'/freeze.json'));for(const [p,h]of Object.entries(f.hashes))if(fileHash(p)!==h)throw Error('Frozen code changed: '+p);return f;}
function data(stage){const manifest=JSON.parse(fs.readFileSync(`${ROOT}/${stage}-manifest.json`));let bars=[];for(const m of manifest){if(fileHash(m.path)!==m.jsonSha256)throw Error('Dataset changed');bars.push(...JSON.parse(fs.readFileSync(m.path)));}return bars;}
function evaluate(stage,variants,multipliers,f){
 const bars=data(stage),cache=new Map(),rows=[];
 for(const v of variants){
  if(!cache.has(v.hours))cache.set(v.hours,E.features(bars,v.hours));
  for(const cost of multipliers){
   const target=`${ROOT}/${stage}/${v.id}-cost-${cost}.json`;
   if(fs.existsSync(target)){
    const saved=JSON.parse(fs.readFileSync(target));if(saved.freezeHash!==f.hash)throw Error('Mismatched result freeze');rows.push(saved.summary);continue;
   }
   const t=Date.now(),{summary,report}=E.run(bars,v,f.plan,f.plan[stage],cost,cache.get(v.hours));
   const output={freezeHash:f.hash,summary,researchCandidate:v,productionSlotIsMetadataOnly:'trend-reference; execution signal revision contains actual research candidate; never registered for approval',simulatorRevision:report.simulatorRevision,options:report.options,dataQuality:report.dataQuality,executionPolicy:report.executionPolicy,trades:report.trades,orders:report.orders,fills:report.fills,ledger:report.ledger,decisions:report.decisions,balance:report.balance,hourlyEquity:report.equityCurve.filter((_,i)=>i%60===59),minuteEquityHash:summary.hash.minuteEquity};
   write(target,output);rows.push(summary);console.log(JSON.stringify({stage,id:v.id,cost,netUsdt:summary.netUsdt,trades:summary.closedTrades,dd:summary.maxDrawdown,daily:summary.maxDailyLoss,risk:summary.riskPass,seconds:(Date.now()-t)/1000}));
  }
 }
 const benches=multipliers.flatMap(m=>E.benchmarks(bars,f.plan[stage],f.plan,m));write(`${ROOT}/${stage}/benchmarks.json`,benches);
 return {rows,benches};
}
function screen(rows,plan,stage){
 const adjusted=E.holm(rows.map(r=>r.bootstrap.p??1));
 return rows.map((r,i)=>({...r,holmP:adjusted[i],failures:[...E.gates(r,plan,stage),...(adjusted[i]>plan.gates.familyWiseAlpha?['MULTIPLE_TEST_UNCERTAINTY']:[])]}));
}
function main(){
 if(process.argv[2]==='freeze')return freeze();
 const f=loadFreeze(),plan=f.plan;
 const dev=evaluate('development',plan.variants,[1],f),devScreen=screen(dev.rows,plan,'development');
 write(ROOT+'/development-selection.json',devScreen);
 const selected=devScreen.filter(r=>!r.failures.length).sort((a,b)=>b.score-a.score||a.candidate.localeCompare(b.candidate)).slice(0,plan.searchBudget.validationCandidates);
 let valScreen=[],stress=[],final=[],finalBenches=[],finalist=null;
 if(selected.length){
  const variants=selected.map(r=>plan.variants.find(v=>v.id===r.candidate));
  const val=evaluate('validation',variants,[1],f);valScreen=screen(val.rows,plan,'validation');write(ROOT+'/validation-selection.json',valScreen);
  const eligible=valScreen.filter(r=>!r.failures.length),stressVariants=eligible.map(r=>plan.variants.find(v=>v.id===r.candidate));
  if(stressVariants.length){
   for(const stage of ['development','validation'])stress.push(...evaluate(stage,stressVariants,plan.searchBudget.stressMultipliers,f).rows.map(r=>({...r,stage})));
   const survivors=eligible.filter(r=>stress.filter(s=>s.candidate===r.candidate).every(s=>s.netUsdt>0&&s.riskPass));
   finalist=survivors.sort((a,b)=>b.score-a.score||a.candidate.localeCompare(b.candidate))[0]||null;
   if(finalist){
    const variant=plan.variants.find(v=>v.id===finalist.candidate),record={freezeHash:f.hash,variant,development:selected.find(r=>r.candidate===variant.id),validation:finalist,stress:stress.filter(s=>s.candidate===variant.id)};
    if(!fs.existsSync(ROOT+'/finalist.json'))write(ROOT+'/finalist.json',record);
    else if(E.hash(record)!==E.hash(JSON.parse(fs.readFileSync(ROOT+'/finalist.json'))))throw Error('Finalist changed');
    if(fs.existsSync(ROOT+'/final-manifest.json')){
     const journal=ROOT+'/final-started.json';if(!fs.existsSync(journal))write(journal,{at:new Date().toISOString(),freezeHash:f.hash,finalist:variant.id,costs:[1,...plan.searchBudget.stressMultipliers]});
     const result=evaluate('final',[variant],[1,...plan.searchBudget.stressMultipliers],f);final=screen(result.rows.filter(r=>r.costMultiplier===1),plan,'final');stress.push(...result.rows.filter(r=>r.costMultiplier!==1).map(r=>({...r,stage:'final'})));finalBenches=result.benches;
     write(ROOT+'/final-completed.json',{at:new Date().toISOString(),freezeHash:f.hash,resultHashes:files(ROOT+'/final').map(p=>({path:p,sha256:fileHash(p)}))});
    }
   }
  }
 }
 const finalPassed=final.length===1&&!final[0].failures.length&&stress.filter(s=>s.stage==='final').every(s=>s.netUsdt>0&&s.riskPass)&&finalBenches.filter(b=>b.costMultiplier===1&&b.riskPass).every(b=>final[0].netUsdt>b.netUsdt);
 const result={freezeHash:f.hash,status:finalPassed?'RESEARCH_PASSED_MANUAL_REVIEW_REQUIRED':finalist&&!final.length?'AWAITING_RESERVED_FINAL_DATA':'NO_QUALIFIED_STRATEGY',development:devScreen,validation:valScreen,stress,final,benchmarks:{development:dev.benches,final:finalBenches},finalist:finalist?.candidate??null,finalConsumed:final.length>0,entriesEnabled:false,liveTradingEnabled:false,automaticApproval:false};
 write(ROOT+'/summary.json',result);
 fs.writeFileSync(ROOT+'/comparison.csv',csv([...devScreen.map(r=>({...r,stage:'development'})),...valScreen.map(r=>({...r,stage:'validation'})),...stress,...final.map(r=>({...r,stage:'final'}))].map(({daily,...r})=>r)));
 console.log(JSON.stringify({status:result.status,developmentCandidates:dev.rows.length,selected:selected.map(r=>r.candidate),finalist:result.finalist,finalConsumed:result.finalConsumed,entriesEnabled:false}));
}
if(require.main===module)main();
module.exports={screen};
