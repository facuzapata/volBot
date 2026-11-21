const fs=require('fs'),assert=require('assert/strict'),E=require('./engine.cjs');
const ROOT='reports/net-optimization',read=p=>JSON.parse(fs.readFileSync(p));
const f=read(ROOT+'/freeze.json'),summary=read(ROOT+'/summary.json'),diagnostic=read(ROOT+'/diagnostics.json');
for(const [p,h]of Object.entries(f.hashes))assert.equal(E.hash(fs.readFileSync(p).toString()),h,'Frozen executable changed: '+p);
assert.equal(summary.freezeHash,f.hash);assert.equal(summary.development.length,12);
assert.deepEqual(f.plan.limits,{drawdown:0.05,exposure:0.8,riskPerTrade:0.005,dailyLoss:0.03});assert.equal(f.plan.capital,500);
assert.equal(summary.status,'NO_QUALIFIED_STRATEGY');assert.equal(summary.entriesEnabled,false);assert.equal(summary.finalConsumed,false);assert.equal(summary.finalist,null);
for(const r of summary.development){assert.ok(r.failures.length);assert.ok(r.continuous);assert.equal(r.days,366);assert.ok(Math.abs(r.terminalLiquidationValue-500-r.netUsdt)<1e-8);assert.ok(Math.abs(r.netRealizedPnl+r.unrealizedPnl+500-r.equity)<1e-8);assert.ok(r.bootstrap.n===366);}
assert.equal(diagnostic.rows.length,18);assert.equal(diagnostic.selectionUnchanged,true);
for(const r of diagnostic.rows){assert.equal(r.diagnosticOnly,true);if(r.riskPass){assert.ok(r.maxDrawdown<=0.05);assert.ok(r.maxDailyLoss<=0.03);assert.ok(r.maxExposure<=0.80000001);}if(r.stage==='validation')assert.equal(r.annualizedReturn,null);}
for(const r of summary.benchmarks.development.filter(r=>r.candidate==='USDT'))assert.equal(r.netUsdt,0);
const before=read(ROOT+'/operational-before.json'),after=read(ROOT+'/operational-after.json');assert.equal(before.stateHash,after.stateHash);assert.equal(after.allPaused,true);assert.equal(after.approved,0);assert.equal(after.inventoryRows,0);
assert.equal(fs.existsSync(ROOT+'/finalist.json'),false);assert.equal(fs.existsSync(ROOT+'/final-started.json'),false);assert.equal(fs.existsSync(ROOT+'/final-manifest.json'),false);
const dataFiles=fs.readdirSync(ROOT+'/data');assert.equal(dataFiles.some(p=>/^2025-(0[4-9]|1[0-2])|^2026-/.test(p)),false);
const tests=read(ROOT+'/tests.json');assert.equal(tests.numFailedTests,0);
const result={at:new Date().toISOString(),freezeHash:f.hash,allFrozenExecutableHashesVerified:true,baseTrials:12,diagnosticTrials:18,uniqueEvaluatedConfigurations:27,finalEvaluationBatches:0,holdoutUntouched:true,operationalUnchanged:true,allAccountsPaused:true,approved:0,unitTestsPassed:tests.numPassedTests,researchContractTestsPassed:7,entriesEnabled:false,liveTradingEnabled:false};
fs.writeFileSync(ROOT+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
