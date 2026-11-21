const fs=require('fs'),crypto=require('crypto'),path=require('path');
const root='reports/btc-v3';fs.mkdirSync(root,{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)])}
const stage=process.argv[2]||'initial';if(!['initial','candidate'].includes(stage))throw new Error('Unknown freeze stage');
const target=`${root}/${stage}-freeze.json`;if(fs.existsSync(target))throw new Error('Freeze already exists; do not overwrite');
const source=files('src/v2').filter(p=>p.endsWith('.ts')).concat(['src/utils/indicators.ts','docs/btc-v3-plan.json']);
const compiled=files('dist/v2').filter(p=>p.endsWith('.js')).concat(files('dist/utils').filter(p=>p.endsWith('.js')));
const result={stage,at:new Date().toISOString(),planHash:hash('docs/btc-v3-plan.json'),sourceHashes:Object.fromEntries(source.map(p=>[p,hash(p)])),compiledHashes:Object.fromEntries(compiled.map(p=>[p,hash(p)]))};
result.researchScriptHashes=Object.fromEntries(files('scripts/btc-v3').filter(p=>p.endsWith('.cjs')||p.endsWith('.py')).map(p=>[p,hash(p)]));
result.previousRuntimeHashes=Object.fromEntries(files(root+'/previous-runtime').filter(p=>p.endsWith('.js')).map(p=>[p,hash(p)]));
if(stage==='candidate'){
 if(!fs.existsSync(root+'/calibration-final.json'))throw new Error('Missing fitted calibration');
 result.calibrationHash=hash(root+'/calibration-final.json');
 const priorFiles=files('reports').filter(p=>!p.includes('previous-runtime'));
 const found=priorFiles.filter(p=>/2025[-_](03|04)/.test(path.basename(p)));
 if(found.length)throw new Error('Candidate period already present: '+found.join(','));
 const datasetPaths=['reports/btcusdt-1m.json',...files('reports/research-data').filter(p=>p.endsWith('.json')&&!p.includes('quarantine'))];
 const coverage=datasetPaths.map(file=>{const bars=JSON.parse(fs.readFileSync(file));if(!Array.isArray(bars))throw new Error('Unexpected dataset');return{file,rows:bars.length,first:bars[0].openTime,last:bars.at(-1).closeTime}});
 if(coverage.some(c=>c.first<=1746057599999&&c.last>=1740787200000))throw new Error('Existing dataset overlaps reserved 2025-03/04');
 result.holdoutAudit={period:'2025-03',datasetFilesFound:found,existingDatasetCoverage:coverage,previousPlans:'2025-03/04 were reserved, not evaluated; all prior manifests/analyses list only earlier windows',scope:'workspace and this session; cannot certify usage outside this workspace'};
}
result.freezeHash=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');fs.writeFileSync(target,JSON.stringify(result,null,2));console.log(JSON.stringify({stage,freezeHash:result.freezeHash,sourceFiles:source.length,...(result.holdoutAudit?{holdoutAudit:result.holdoutAudit}:{})}));
