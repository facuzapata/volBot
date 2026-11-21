const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const root='reports/signal-research-v1';fs.mkdirSync(root,{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)])}
const protectedPaths=[...files('src'),...files('docs').filter(p=>!p.includes('signal-research-plan')),'package.json','package-lock.json','docker-compose.v2.yml','docs/signal-research-plan.json',...files('reports/research-data').filter(p=>p.endsWith('.json')), 'reports/btcusdt-1m.json','reports/btc-v2-report.json','reports/trades-audit.csv','reports/strategy-comparison.csv'];
const snapshot={branch:cp.execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),gitStatus:cp.execFileSync('git',['status','--short'],{encoding:'utf8'}),planSHA256:hash('docs/signal-research-plan.json'),protectedFiles:Object.fromEntries(protectedPaths.map(p=>[p,hash(p)]))};
if(fs.existsSync(root+'/before.json'))throw new Error('Existing snapshot must not be replaced');
fs.writeFileSync(root+'/before.json',JSON.stringify(snapshot,null,2));console.log(JSON.stringify({branch:snapshot.branch,files:protectedPaths.length,planSHA256:snapshot.planSHA256}));
