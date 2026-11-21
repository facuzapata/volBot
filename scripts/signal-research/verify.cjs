const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict'),{Client}=require('pg');
const root='reports/signal-research-v1',hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function main(){
 const before=JSON.parse(fs.readFileSync(root+'/before.json'));const changed=Object.entries(before.protectedFiles).filter(([p,h])=>hash(p)!==h).map(([p])=>p);assert.deepEqual(changed,[],'Existing protected source/data/report changed');
 const env=require('dotenv').parse(fs.readFileSync('.env.v2'));const url=new URL(env.V2_DATABASE_URL);assert.equal(url.pathname,'/volbot_v2');const db=new Client({connectionString:url.toString()});await db.connect();let operational;
 try{
  // Every database operation in this script is SELECT. No worker commands or writes.
  const accounts=(await db.query('SELECT data FROM v2_virtual_accounts')).rows;
  const grants=(await db.query("SELECT count(*)::int AS n FROM v2_strategy_validations WHERE status='APPROVED'")).rows[0].n;
  const inventory=(await db.query("SELECT 'positions' AS kind,id,data FROM v2_positions UNION ALL SELECT 'orders',id,data FROM v2_exchange_orders ORDER BY kind,id")).rows;
  operational={accounts:accounts.length,entriesPaused:accounts.every(a=>a.data.entriesEnabled===false),approved:grants,inventoryRows:inventory.length,inventoryHash:crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex')};
  assert.equal(operational.entriesPaused,true);assert.equal(grants,0);assert.equal(operational.inventoryHash,JSON.parse(fs.readFileSync('reports/pause-audit.json')).inventory.hash);
 }finally{await db.end()}
 const required=['docs/entry-signal-diagnostics.md','docs/stop-loss-diagnostics.md','docs/strategy-root-cause.md','reports/entry-signal-analysis.csv','reports/signal-control-comparison.csv','reports/stop-loss-analysis.csv','reports/strategy-research-summary.json'];
 const scripts=fs.readdirSync('scripts/signal-research').filter(p=>p.endsWith('.cjs')||p.endsWith('.py')).map(p=>'scripts/signal-research/'+p);
 const result={at:new Date().toISOString(),protectedFilesUnchanged:Object.keys(before.protectedFiles).length,planSHA256:hash('docs/signal-research-plan.json'),operational,deliverableHashes:Object.fromEntries(required.map(p=>[p,hash(p)])),researchScriptHashes:Object.fromEntries(scripts.map(p=>[p,hash(p)])),tests:JSON.parse(fs.readFileSync(root+'/tests.json')).numPassedTests,allTests:JSON.parse(fs.readFileSync(root+'/all-tests.json')).numPassedTests};
 fs.writeFileSync(root+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify({protectedFilesUnchanged:result.protectedFilesUnchanged,operational,tests:result.tests,allTests:result.allTests}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
