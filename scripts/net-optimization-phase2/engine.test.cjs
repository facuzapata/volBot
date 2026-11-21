const test=require('node:test'),assert=require('node:assert/strict'),E=require('./engine.cjs'),p=require('./plan.json');
const {fixture}=require('./fixtures.cjs');
test('Configuration fingerprint survives PostgreSQL-style recursive key reordering',()=>{const v=p.candidates[0],reordered=Object.fromEntries(Object.entries(v).reverse());assert.equal(E.canonicalHash(v),E.canonicalHash(reordered));assert.notEqual(E.canonicalHash({...v,stopAtr:3}),E.canonicalHash(v));});
test('Every variant has unique independent configuration and hash',()=>{assert.equal(new Set(p.candidates.map(E.hash)).size,7);assert.equal(new Set(p.candidates.map(v=>v.id)).size,7);assert.equal(p.candidates.filter(v=>v.change!=='original').length,6);});
test('Fold embargo exceeds maximum holding and labels, and evaluated windows do not overlap',()=>{
 for(let i=0;i<p.folds.length;i++){const f=p.folds[i];assert.equal((E.at(f.start)-E.at(f.trainEndExclusive))/E.DAY,6);assert.ok(p.candidates.every(v=>v.holdHours<144));if(i)assert.equal(f.start,p.folds[i-1].endExclusive);}
});
test('Economic model purges labels ending at/after cutoff and ignores future mutation',()=>{
 const cutoff=E.at('2024-06-25'),records=Array.from({length:40},(_,i)=>({at:cutoff-(40-i)*E.DAY,labelEnd:cutoff-(39-i)*E.DAY,complete:true,day:new Date(cutoff-(40-i)*E.DAY).toISOString().slice(0,10),atrFraction:0.012,value:0.01}));
 const a=E.fitModel(records,cutoff-180*E.DAY,cutoff,p),b=E.fitModel([...records,{at:cutoff+1,labelEnd:cutoff+E.DAY,complete:true,day:'2024-06-26',atrFraction:0.01,value:-100}],cutoff-180*E.DAY,cutoff,p);assert.deepEqual(a,b);assert.ok(a.trainedThrough<cutoff);assert.equal(a.bins.reduce((n,b)=>n+b.samples,0),39);
});
test('Learned abstention rejects missing, future, insufficient and uneconomic evidence',()=>{
 const {cache}=fixture(),f=[...cache.values()][0],v=p.candidates.find(v=>v.change==='learned'),cfg=E.config(p),future={trainedThrough:f.b.closeTime+1,cutoff:f.b.closeTime+1,bins:[]};
 assert.equal(E.economicAllowed(f,null,cfg,p),false);assert.equal(E.economicAllowed(f,future,cfg,p),false);
 const model={trainedThrough:0,cutoff:0,bins:[{low:0,high:1,samples:20,days:10,blocks:10,lower:0.01}]};assert.equal(E.economicAllowed(f,model,cfg,p),true);assert.equal(E.economicAllowed(f,{...model,bins:[{...model.bins[0],lower:0}]},cfg,p),false);
});
test('Confirmation, extension and volatility variants enforce exactly their frozen predicates',()=>{
 const {bars,cache}=fixture(),h={'1m':[bars[59]],'5m':[],'1h':[]},f=cache.get(bars[59].closeTime),cfg=E.config(p);
 for(const change of ['confirmation','extension','volatility']){const v=p.candidates.find(v=>v.change===change),s=new E.PhaseStrategy(v,cache,p,null);assert.ok(s.evaluate(h,'trend-reference',cfg));const old={...f,diagnostic:{...f.diagnostic}};
  if(change==='confirmation')f.confirmed=false;if(change==='extension')f.diagnostic.distanceEma20Atr=2;if(change==='volatility')f.atr=1;
  assert.equal(s.evaluate(h,'trend-reference',cfg),null);Object.assign(f,old);
 }
});
test('Time and trailing modify only documented exit controls, preserving absolute protection',()=>{
 const {bars,cache}=fixture(),h={'1m':[bars[59]],'5m':[],'1h':[]};
 const t=new E.PhaseStrategy(p.candidates.find(v=>v.change==='time'),cache,p,null).evaluate(h,'trend-reference',E.config(p));
 const v=new E.PhaseStrategy(p.candidates.find(v=>v.change==='trailing'),cache,p,null).evaluate(h,'trend-reference',E.config(p));
 assert.equal(t.config.maxHoldingMs,72*3600000);assert.equal(v.config.trailing,true);assert.equal(v.config.atrMultiplier,2);assert.equal(v.config.trailingActivation,0.005);assert.equal(t.protection.stopPrice,v.protection.stopPrice);
});
test('Causal BTC-V2 signal cache matches original StrategyEngine, including cost coverage',()=>{
 const bars=JSON.parse(require('fs').readFileSync('reports/btcusdt-1m.json')),cache=E.buildV2Cache(bars,p),{StrategyEngine}=require('../../dist/v2/strategy/strategy-engine'),{CandleAggregator}=require('../../dist/v2/backtesting/backtesting.engine');assert.ok(cache.size>0);
 const raw=new StrategyEngine(),cached=new E.CachedV2(cache),agg=new CandleAggregator(),h={'1m':[],'5m':[],'1h':[]};let compared=0;
 for(const c of bars){for(const b of[c,...agg.push(c)]){h[b.timeframe].push(b);h[b.timeframe]=h[b.timeframe].slice(-100);}for(const cost of [1,2]){const cfg=E.config(p,cost);assert.deepEqual(cached.evaluate(h,'btc-v2',cfg),raw.evaluate(h,'btc-v2',cfg));compared++;}}
 assert.ok(compared>20000);
});
test('Realistic costs fully replay to different fills and net outcomes',()=>{
 const {bars,cache,period}=fixture(),v=p.candidates.find(v=>v.change==='time');
 const a=E.simulate({bars,cache,period,variant:v,plan:p}),b=E.simulate({bars,cache,period,variant:v,plan:p,cost:2});assert.equal(a.summary.closedTrades,1);assert.notEqual(a.summary.fillPathHash,b.summary.fillPathHash);assert.ok(b.summary.netUsdt<a.summary.netUsdt);
});
test('An actual gap beyond the per-position loss cap is recorded and disqualifies the trial',()=>{
 const {bars,cache,period}=fixture(),v=p.candidates.find(v=>v.change==='time');bars[90]={...bars[90],open:90000,high:90005,low:89995,close:90000};
 const a=E.simulate({bars,cache,period,variant:v,plan:p});assert.ok(a.report.tradeRiskViolations.some(v=>v.kind==='REALIZED_TRADE_LOSS'));assert.equal(a.summary.riskPass,false);assert.ok(E.closedGate(a.summary,p).includes('RISK_LIMIT'));
});
test('Reserved interval is rejected before calling execution',()=>{
 const {bars,cache}=fixture();assert.throws(()=>E.simulate({bars,cache,variant:p.candidates[0],plan:p,period:{start:'2025-04-01',endExclusive:'2025-04-02'}}),/RESERVED_DATA_FORBIDDEN/);
});
