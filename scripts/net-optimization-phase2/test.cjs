// Repeatable validation orchestrator; no production mutations or market downloads.
const fs=require('fs'),{spawnSync}=require('child_process'),IO=require('./io.cjs');
const {ROOT,write}=IO;fs.mkdirSync(ROOT,{recursive:true});
function run(name,args){const result=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,env:{...process.env,FORCE_COLOR:'0'}}),log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(`${ROOT}/${name}.log`,log);if(result.status!==0)throw Error(`${name} failed; see ${ROOT}/${name}.log`);console.log(name+' passed');return log;}
try{
 run('typecheck',['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']);
 run('lint',['node_modules/eslint/bin/eslint.js','--config','eslint.v2.mjs','src/v2','src/main.ts','src/worker.ts','src/app.module.ts','test/v2']);
 const contracts=run('research-contracts',['--test','--test-reporter=tap','scripts/net-optimization-phase2/engine.test.cjs']);
 run('unit-tests',['node_modules/jest/bin/jest.js','--runInBand','--silent','--json',`--outputFile=${ROOT}/tests.json`]);
 const integration=run('integration-tests',['scripts/test-integration.cjs']);
 const tests=IO.read(ROOT+'/tests.json'),research=Number(contracts.match(/# pass (\d+)/)?.[1]),integrations=Number(integration.match(/Tests:\s+(\d+) passed/)?.[1]);
 if(!Number.isFinite(research)||!Number.isFinite(integrations)||tests.numFailedTests)throw Error('Missing or failed test evidence');
 write(ROOT+'/test-evidence.json',{at:new Date().toISOString(),unitPassed:tests.numPassedTests,researchPassed:research,integrationPassed:integrations,typecheck:true,lint:true,unitReport:ROOT+'/tests.json',researchCommand:'node --test --test-reporter=tap scripts/net-optimization-phase2/engine.test.cjs',integrationCommand:'node scripts/test-integration.cjs',initialFailuresPreserved:'reports/net-optimization-phase2-attempt-v1; plan.json.technicalRevision',logs:['typecheck','lint','research-contracts','unit-tests','integration-tests'].map(n=>({path:`${ROOT}/${n}.log`,sha256:IO.sha(`${ROOT}/${n}.log`)}))});
}catch(e){console.error(e.message);process.exitCode=1;}
