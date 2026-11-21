const fs=require('fs');const {Client}=require('pg');const {createHash}=require('crypto');
async function main(){
 const env=require('dotenv').parse(fs.readFileSync('.env.v2'));const url=new URL(env.V2_DATABASE_URL);
 if(url.pathname!=='/volbot_v2')throw new Error('Production V2 paper database required');
 const db=new Client({connectionString:url.toString()});await db.connect();
 try{
  const accounts=(await db.query('SELECT data FROM v2_virtual_accounts')).rows;
  const validations=(await db.query('SELECT status,count(*)::int AS count FROM v2_strategy_validations GROUP BY status')).rows;
  const inventory=(await db.query("SELECT 'positions' AS kind,id,data FROM v2_positions UNION ALL SELECT 'orders',id,data FROM v2_exchange_orders ORDER BY kind,id")).rows;
  const report={at:new Date().toISOString(),mode:'PAPER',accounts:accounts.length,entriesPaused:accounts.every(r=>r.data.entriesEnabled===false),validations,inventory:{rows:inventory.length,hash:createHash('sha256').update(JSON.stringify(inventory)).digest('hex')}};
  const before=JSON.parse(fs.readFileSync('reports/pause-audit.json'));
  report.inventoryMatchesBeforeAudit=before.inventory.hash===report.inventory.hash;
  if(!report.entriesPaused||validations.some(r=>r.status==='APPROVED'&&r.count>0)||!report.inventoryMatchesBeforeAudit)throw new Error('Pause verification failed');
  fs.writeFileSync('reports/pause-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await db.end()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
