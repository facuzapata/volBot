const fs=require('fs'),{spawn}=require('child_process');
const plan=JSON.parse(fs.readFileSync('docs/signal-research-plan.json'));
const pending=plan.periods.filter(p=>process.argv.includes('--refresh')||!fs.existsSync(`reports/signal-research-v1/${p}/analysis.json`));
async function run(period){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/signal-research/extract.cjs',period],{windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.on('data',d=>process.stdout.write(String(d)));p.stderr.on('data',d=>process.stderr.write(String(d)));p.on('exit',c=>c===0?resolve():reject(new Error(`Research failed ${period}`)))})}
(async()=>{for(let i=0;i<pending.length;i+=2)await Promise.all(pending.slice(i,i+2).map(run));console.log('All frozen-period extractions complete; no accounts or worker accessed')})().catch(e=>{console.error(e.message);process.exitCode=1});
