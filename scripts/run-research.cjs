const fs=require('fs'); const {spawn}=require('child_process');
const manifest=JSON.parse(fs.readFileSync('reports/research-manifest.json'));
function run(p){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/research-experiments.cjs',p.month],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>process.stdout.write(`[${p.month}] ${data}`));child.stderr.on('data',data=>process.stderr.write(data));
  child.on('exit',code=>code===0?resolve():reject(new Error(`Research failed: ${p.month}`)));
});}
async function main(){
  const development=manifest.filter(p=>p.split==='development');
  for(let i=0;i<development.length;i+=3)await Promise.all(development.slice(i,i+3).map(run));
  for(const phase of ['validation','final-oos'])for(const p of manifest.filter(p=>p.split===phase))await run(p);
  const rows=manifest.flatMap(p=>JSON.parse(fs.readFileSync(`reports/experiments/${p.month}/strategy-comparison.json`)));
  const keys=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';const csv=[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n';
  fs.writeFileSync('reports/strategy-comparison.csv',csv);fs.writeFileSync('reports/strategy-comparison.json',JSON.stringify(rows,null,2));
  fs.writeFileSync('reports/filter-diagnostics.json',JSON.stringify(manifest.flatMap(p=>JSON.parse(fs.readFileSync(`reports/experiments/${p.month}/filter-diagnostics.json`))),null,2));
  fs.copyFileSync(`reports/experiments/${manifest[0].month}/experiment-variants.json`,'reports/experiment-variants.json');
  console.log(`Completed ${rows.length} rows, including cash; no parameters selected and no approval granted.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
