// Operational safety: only the dedicated V2 simulation database is allowed.
const fs = require('fs');
const { createHash } = require('crypto');
const { Client } = require('pg');
const dotenv = require('dotenv');
async function main() {
  const env = dotenv.parse(fs.readFileSync('.env.v2'));
  const url = new URL(env.V2_DATABASE_URL);
  if (!/^\/volbot_v2(?:_[a-z0-9]+)*$/.test(url.pathname)) throw new Error('Dedicated V2 database required');
  const db = new Client({ connectionString: url.toString() }); await db.connect();
  try {
    await db.query('BEGIN');
    const inventory = async () => {
      const r = await db.query(`SELECT 'positions' AS kind, id, data FROM v2_positions UNION ALL SELECT 'orders', id, data FROM v2_exchange_orders ORDER BY kind,id`);
      return { rows: r.rows.length, hash: createHash('sha256').update(JSON.stringify(r.rows)).digest('hex') };
    };
    const accounts = await db.query('SELECT id FROM v2_virtual_accounts ORDER BY id FOR UPDATE');
    const before = await inventory();
    await db.query(`UPDATE v2_virtual_accounts SET data=jsonb_set(data, '{entriesEnabled}', 'false'::jsonb)`);
    const after = await inventory();
    if (before.hash !== after.hash) throw new Error('Inventory changed inside pause transaction');
    await db.query('COMMIT');
    fs.mkdirSync('reports', { recursive: true });
    const report = { at: new Date().toISOString(), accountsPaused: accounts.rowCount, inventoryUnchanged: true, inventory: after };
    fs.writeFileSync('reports/pause-audit.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch(e) { await db.query('ROLLBACK'); throw e; } finally { await db.end(); }
}
main().catch(() => { console.error('Pause failed; inspect V2 database availability.'); process.exitCode = 1; });
