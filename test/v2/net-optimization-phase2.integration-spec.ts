import {randomUUID} from 'crypto';
import {Client} from 'pg';
const E=require('../../scripts/net-optimization-phase2/engine.cjs');
const plan=require('../../scripts/net-optimization-phase2/plan.json');
const {fixture}=require('../../scripts/net-optimization-phase2/fixtures.cjs');
const suite=process.env.V2_TEST_DATABASE_URL?describe:describe.skip;
suite('Phase 2 research replay and PostgreSQL evidence isolation',()=>{
 let db:Client;
 const schema=`phase2_test_${randomUUID().replace(/-/g,'')}`;
 beforeAll(async()=>{
  const url=new URL(process.env.V2_TEST_DATABASE_URL!);if(!/^\/volbot_v2_test(?:_[a-z0-9]+)*$/.test(url.pathname))throw Error('Dedicated test DB required');
  db=new Client({connectionString:url.toString()});await db.connect();await db.query(`CREATE SCHEMA "${schema}"`);await db.query(`CREATE TABLE "${schema}".evidence (id text PRIMARY KEY, config_hash text NOT NULL, data jsonb NOT NULL)`);
 });
 afterAll(async()=>{if(db){if(!/^phase2_test_[a-f0-9]+$/.test(schema))throw Error('Unsafe schema');await db.query(`DROP SCHEMA "${schema}" CASCADE`);await db.end();}});
 it('persists an isolated experiment and reproduces its fills from the saved immutable configuration',async()=>{
  const {bars,cache,period}=fixture(),variant=plan.candidates.find((v:{change:string})=>v.change==='time'),result=E.simulate({bars,cache,period,variant,plan});
  expect(result.summary.closedTrades).toBe(1);const payload={variant,period,cost:1,summary:result.summary,fills:result.report.fills};
  await db.query(`INSERT INTO "${schema}".evidence VALUES ($1,$2,$3)`,['replay',E.canonicalHash(variant),JSON.stringify(payload)]);
  const saved=(await db.query(`SELECT config_hash,data FROM "${schema}".evidence WHERE id=$1`,['replay'])).rows[0];expect(E.canonicalHash(saved.data.variant)).toBe(saved.config_hash);
  const repeat=E.simulate({bars,cache,period:saved.data.period,variant:saved.data.variant,plan,cost:saved.data.cost});expect(repeat.report.fills).toEqual(saved.data.fills);expect(repeat.summary).toEqual(saved.data.summary);
 });
 it('retains rejected gap risk evidence without mutating any operational approval or account',async()=>{
  const {bars,cache,period}=fixture();bars[90]={...bars[90],open:90000,high:90005,low:89995,close:90000};
  const variant=plan.candidates.find((v:{change:string})=>v.change==='time'),result=E.simulate({bars,cache,period,variant,plan});
  expect(result.summary.riskPass).toBe(false);await db.query(`INSERT INTO "${schema}".evidence VALUES ($1,$2,$3)`,['rejected',E.hash(variant),JSON.stringify({rejected:true,violations:result.report.tradeRiskViolations})]);
  const row=(await db.query(`SELECT data FROM "${schema}".evidence WHERE id=$1`,['rejected'])).rows[0];expect(row.data.violations.length).toBeGreaterThan(0);expect(row.data.rejected).toBe(true);
 });
});
