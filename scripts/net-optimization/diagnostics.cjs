// Post-screen description of failure modes; cannot alter the frozen selection or create a finalist.
const fs=require('fs');
const E=require('./engine.cjs');
const ROOT='reports/net-optimization',read=p=>JSON.parse(fs.readFileSync(p));
const f=read(ROOT+'/freeze.json'),selection=read(ROOT+'/development-selection.json');
for(const [p,h]of Object.entries(f.hashes))if(E.hash(fs.readFileSync(p).toString())!==h)throw Error('Frozen code changed');
if(selection.some(r=>!r.failures.length))throw Error('This diagnostic is only for an entirely rejected screen');
const chosen=[...selection].sort((a,b)=>b.netUsdt-a.netUsdt||a.candidate.localeCompare(b.candidate)).slice(0,3).map(r=>r.candidate);
const protocol={freezeHash:f.hash,postDevelopment:true,purpose:'Describe cost and temporal fragility, without promoting any strategy or claiming fresh OOS',candidates:chosen,stages:['development','validation'],costs:[1,1.5,2],retuning:false,eligibilityOverride:false};
const protocolFile=ROOT+'/diagnostic-protocol.json';
if(fs.existsSync(protocolFile)){if(E.hash(protocol)!==E.hash(read(protocolFile)))throw Error('Diagnostic protocol changed');}
else fs.writeFileSync(protocolFile,JSON.stringify(protocol,null,2));
const rows=[];
for(const stage of protocol.stages){
 const bars=[];for(const m of read(`${ROOT}/${stage}-manifest.json`)){if(E.hash(fs.readFileSync(m.path).toString())!==m.jsonSha256)throw Error('Data changed');bars.push(...read(m.path));}
 const caches=new Map();
 for(const id of chosen){const variant=f.plan.variants.find(v=>v.id===id);if(!caches.has(variant.hours))caches.set(variant.hours,E.features(bars,variant.hours));
  for(const cost of protocol.costs){
   const p=`${ROOT}/diagnostic-${stage}-${id}-${cost}.json`,base=`${ROOT}/${stage}/${id}-cost-${cost}.json`;
   let result;
   if(fs.existsSync(p))result=read(p);
   else if(fs.existsSync(base)){const r=read(base);result={summary:r.summary,reusedFrozenResult:base};}
   else{const {report,summary}=E.run(bars,variant,f.plan,f.plan[stage],cost,caches.get(variant.hours));result={summary,trades:report.trades,orders:report.orders,fills:report.fills,ledger:report.ledger,decisions:report.decisions,balance:report.balance};}
   result.freezeHash=f.hash;result.diagnosticOnly=true;fs.writeFileSync(p,JSON.stringify(result,null,2));
   rows.push({...result.summary,stage,diagnosticOnly:true});console.log(JSON.stringify({stage,id,cost,net:result.summary.netUsdt,dd:result.summary.maxDrawdown,trades:result.summary.closedTrades}));
  }
 }
 fs.writeFileSync(`${ROOT}/diagnostic-${stage}-benchmarks.json`,JSON.stringify(protocol.costs.flatMap(m=>E.benchmarks(bars,f.plan[stage],f.plan,m)),null,2));
}
fs.writeFileSync(ROOT+'/diagnostics.json',JSON.stringify({protocol,rows,finalConsumed:false,selectionUnchanged:true},null,2));
