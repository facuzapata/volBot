const fs=require('fs'),crypto=require('crypto'),{Client}=require('pg');
const mode=process.argv[2]??'after',root='reports/btc-v3';
async function main(){
 const env=require('dotenv').parse(fs.readFileSync('.env.v2')),url=new URL(env.V2_DATABASE_URL);if(url.pathname!=='/volbot_v2')throw new Error('Operational verification only on dedicated V2 simulation database');
 const db=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000});await db.connect();
 try{
  const accounts=(await db.query('SELECT id,data FROM v2_virtual_accounts ORDER BY id')).rows;
  const inventory=(await db.query("SELECT 'position' AS kind,id,data FROM v2_positions UNION ALL SELECT 'order',id,data FROM v2_exchange_orders ORDER BY kind,id")).rows;
  const approved=(await db.query("SELECT count(*)::int AS n FROM v2_strategy_validations WHERE status='APPROVED'")).rows[0].n;
  const snapshot={accounts:accounts.map(r=>({id:r.id,available:r.data.available,reserved:r.data.reserved,initialCapital:r.data.initialCapital,entriesEnabled:r.data.entriesEnabled})),inventory};
  const report={at:new Date().toISOString(),mode:'PAPER',accounts:accounts.length,allPaused:accounts.every(r=>r.data.entriesEnabled===false),approved,inventoryRows:inventory.length,stateHash:crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
  if(!report.allPaused||approved)throw new Error('Operational accounts are not blocked');
  const file=`${root}/operational-${mode}.json`;
  if(mode==='before'&&fs.existsSync(file))throw new Error('Do not overwrite operational baseline');
  if(mode==='after'){const before=JSON.parse(fs.readFileSync(root+'/operational-before.json'));report.balancesAndInventoryUnchanged=before.stateHash===report.stateHash;if(!report.balancesAndInventoryUnchanged)throw new Error('Operational balances/inventory changed')}
  fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await db.end()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
