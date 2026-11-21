const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT='reports/net-optimization-phase2',sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const write=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(x,null,2));};
function files(p){return fs.existsSync(p)?fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)]):[];}
function freeze(){
 if(fs.existsSync(ROOT+'/plan.json'))throw Error('Never overwrite a frozen research plan');
 const plan=read('scripts/net-optimization-phase2/plan.json');
 const previous=['reports/net-optimization','reports/btc-v3','reports/signal-research-v1','reports/net-optimization-phase2-attempt-v1'].flatMap(files).filter(p=>/\.(json|csv|cjs|js|ts|md|ndjson)$/.test(p)&&!p.includes('previous-runtime'));
 const protectedSource=['src','test','docs','scripts/net-optimization','scripts/btc-v3','scripts/signal-research'].flatMap(files).filter(p=>/\.(ts|cjs|py|md|json)$/.test(p));
 const runtime=['dist/v2','dist/utils'].flatMap(files).filter(p=>p.endsWith('.js'));
 const own=files('scripts/net-optimization-phase2').filter(p=>/\.(json|cjs|py)$/.test(p));
 const f={at:new Date().toISOString(),branch:require('child_process').execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),plan,sourceHashes:Object.fromEntries([...protectedSource,...runtime,...own].map(p=>[p,sha(p)])),previousResearchHashes:Object.fromEntries(previous.map(p=>[p,sha(p)])),inputs:read('reports/net-optimization/development-manifest.json').concat(read('reports/net-optimization/validation-manifest.json')).filter((m,i,a)=>a.findIndex(x=>x.path===m.path)===i),requiredFileResolution:{'reports/net-optimization/plan.json':'scripts/net-optimization/plan.json and reports/net-optimization/freeze.json.plan'},reservedPriceAccess:false};
 f.freezeHash=crypto.createHash('sha256').update(JSON.stringify(f)).digest('hex');write(ROOT+'/plan.json',f);console.log(JSON.stringify({branch:f.branch,freezeHash:f.freezeHash,preservedFiles:previous.length}));
}
function check(f){for(const [p,h]of Object.entries({...f.sourceHashes,...f.previousResearchHashes}))if(sha(p)!==h)throw Error('Frozen or previous artifact changed: '+p);}
function loadData(f){const rows=[];for(const m of f.inputs){if(sha(m.path)!==m.jsonSha256)throw Error('Data hash mismatch');const a=read(m.path);if(a.some(b=>b.closeTime>=Date.parse(f.plan.reserved.start)))throw Error('RESERVED_DATA_FORBIDDEN');rows.push(...a);}return rows.sort((a,b)=>a.openTime-b.openTime);}
module.exports={ROOT,sha,read,write,files,freeze,check,loadData};
