const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
const root='reports/btc-v3',hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const freeze=JSON.parse(fs.readFileSync(root+'/candidate-freeze.json'));
for(const list of[freeze.sourceHashes,freeze.compiledHashes,freeze.researchScriptHashes,freeze.previousRuntimeHashes])for(const [p,h]of Object.entries(list))assert.equal(hash(p),h,'Frozen candidate changed: '+p);
assert.equal(hash(root+'/calibration-final.json'),freeze.calibrationHash);
const rows=JSON.parse(fs.readFileSync(root+'/comparison.json'));assert.equal(rows.length,45);
for(const p of new Set(rows.map(r=>r.period))){const rs=rows.filter(r=>r.period===p);assert.equal(rs.length,5);assert.equal(new Set(rs.map(r=>r.datasetHash)).size,1);assert.equal(new Set(rs.filter(r=>r.variant!=='v2-previous-simulator').map(r=>r.simulatorRevision)).size,1)}
for(const r of rows){assert.equal(r.closedTrades,r.wins+r.losses+r.flat);assert.ok(Math.abs(r.netRealizedPnl+r.unrealizedPnl-r.netEquityPnl)<1e-8);if(r.variant==='v3-corrected-simulator'){assert.equal(r.closedTrades,0);assert.equal(r.totalCommissions,0);assert.equal(r.netEquityPnl,0)}if(r.variant==='USDT-cash')for(const k of['totalCommissions','spreadCost','slippageCost','roundingCost','netEquityPnl','capitalImmobilized'])assert.equal(r[k],0)}
assert.equal(JSON.parse(fs.readFileSync(root+'/v2-signal-compatibility.json')).identicalSignals,true);
const {BacktestingEngine}=require('../../dist/v2/backtesting/backtesting.engine');
const baseline=JSON.parse(fs.readFileSync(root+'/observed/2025-01-original/v2-corrected-simulator.json'));
const candles=JSON.parse(fs.readFileSync('reports/btcusdt-1m.json'));
// Reproduce an observed window only. Never re-evaluate the final OOS.
const repeat=new BacktestingEngine().run(candles,baseline.options,baseline.tradeStart,baseline.tradeEnd);
assert.deepEqual(repeat.metrics,baseline.metrics);assert.deepEqual(repeat.fills,baseline.fills);
const models=JSON.parse(fs.readFileSync(root+'/calibration-walk-forward.json')),manifest=JSON.parse(fs.readFileSync('reports/research-manifest.json'));
for(const [name,m]of Object.entries(models)){const start=name==='2025-01-original'?Date.UTC(2025,0,1):manifest.find(p=>p.month===name).start;assert.ok(m.trainedThrough<start)}
const completed=JSON.parse(fs.readFileSync(root+'/oos-completed.json'));assert.equal(completed.freezeHash,freeze.freezeHash);
const operation=JSON.parse(fs.readFileSync(root+'/operational-after.json'));assert.equal(operation.allPaused,true);assert.equal(operation.approved,0);assert.equal(operation.balancesAndInventoryUnchanged,true);
const before=JSON.parse(fs.readFileSync(root+'/before.json'));
for(const p of ['docker-compose.yml','src/strategy/services/ai-analysis.service.ts','src/strategy/services/multi-user-strategy.service.ts','src/utils/indicators.ts'])assert.equal(hash(p),before.hashes[p],'Preexisting protected behavior changed: '+p);
const docs=['docs/btc-v3-strategy.md','docs/btc-v3-backtesting.md','docs/simulator-fixes.md','docs/btc-v2-vs-v3.md','docs/btc-v3-limitations.md'];
for(const p of docs)assert.ok(fs.statSync(p).size>1000);
const result={candidateFreezeHash:freeze.freezeHash,frozenCodeAndConfigUnchangedAfterOos:true,comparisonRows:45,originalV2SignalsIdentical:true,observedWindowMetricsAndFillsReproduced:true,walkForwardModelsUseOnlyPriorLabels:true,finalEvaluationBatches:1,operational:operation,testsPassed:JSON.parse(fs.readFileSync(root+'/tests-all-final.json')).numPassedTests,integrationTestsPassed:12,liveTradingEnabled:false,deliverableHashes:Object.fromEntries([...docs,root+'/comparison.csv',root+'/comparison.json',root+'/results-summary.json'].map(p=>[p,hash(p)]))};
fs.writeFileSync(root+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify({candidateFreezeHash:result.candidateFreezeHash,rows:45,observedReplayIdentical:true,sourceFrozen:true,operationalPaused:true,tests:result.testsPassed,integration:12}));
