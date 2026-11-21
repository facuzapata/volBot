const test=require('node:test'),assert=require('node:assert/strict');
const E=require('./engine.cjs'),plan=require('./plan.json');
const {BacktestingEngine}=require('../../dist/v2/backtesting/backtesting.engine');
const {newAccount,PaperExecutionAdapter}=require('../../dist/v2/execution/paper-execution.adapter');
const {RiskPolicy}=require('../../dist/v2/risk/risk-policy');
function candles(n=14400){return Array.from({length:n},(_,i)=>{const p=30000+300*Math.sin(i/300)+i*.05;return {symbol:'BTCUSDT',timeframe:'1m',openTime:Date.UTC(2024,0,1)+i*60000,closeTime:Date.UTC(2024,0,1)+i*60000+59999,open:p,close:p+3,high:p+10,low:p-10,volume:100};});}
test('Features use completed UTC bars and are unchanged when future prices change',()=>{
 const bars=candles(),cut=8000,a=E.features(bars,1),prefix=E.features(bars.slice(0,cut),1);
 const changed=E.features(bars.map((b,i)=>i<cut?b:{...b,open:b.open*5,close:b.close*5,high:b.high*5,low:b.low*5}),1);
 for(const [t,f] of prefix){assert.deepEqual(a.get(t),f);assert.deepEqual(changed.get(t),f);assert.equal((t+1)%3600000,0);}
 assert.ok(prefix.size>50);
});
test('Donchian threshold excludes the signal bar',()=>{
 const bars=candles(),at=bars.length-1;bars[at]={...bars[at],high:1e9};
 const f=E.features(bars,1).get(bars[at].closeTime);assert.ok(f);assert.ok(f.high20<1e8);
});
test('Research archival preserves the corrected execution engine exactly',()=>{
 const bars=candles(6000),cfg=E.config(plan),options={strategy:'trend-reference',initialCapital:500,maxPositions:1,usdtPerTrade:30,config:cfg};
 const strategy={invalidated:()=>false,evaluate(h,_s,c){const b=h['1m'].at(-1);if((b.openTime/60000)%180!==0)return null;return {id:String(b.openTime),strategy:'trend-reference',strategyRevision:'fixture',symbol:'BTCUSDT',candleTime:b.closeTime,referencePrice:b.close,atr:80,swingLow:b.close-100,regime:'fixture',conditions:{fixture:true},config:{...c,maxHoldingMs:3600000},protection:{stopPrice:b.close-100,targetPrice:b.close+100,horizonMs:3600000,timeframe:'1h'}};}};
 const baseline=new BacktestingEngine(strategy,new PaperExecutionAdapter(),new RiskPolicy()).run(bars,options);
 const paper=new E.ResearchPaper(plan,{controls:false});
 const compact=paper.finish(new BacktestingEngine(strategy,paper,new RiskPolicy()).run(bars,options));
 assert.ok(baseline.metrics.closedTrades>5);assert.deepEqual(compact.metrics,baseline.metrics);assert.deepEqual(compact.equityCurve,baseline.equityCurve);
 for(const key of ['trades','orders','fills','ledger'])assert.deepEqual([...compact[key]].sort((a,b)=>a.id.localeCompare(b.id)),[...baseline[key]].sort((a,b)=>a.id.localeCompare(b.id)));
 assert.deepEqual(compact.balance,baseline.balance);assert.deepEqual(compact.decisions,baseline.decisions);
});
test('Net-risk sizing shrinks with wider stops and higher costs',()=>{
 function size(stop,m=1){const s=newAccount('s','u',500,1,30);s.account.entriesEnabled=true;const signal={id:'signal',symbol:'BTCUSDT',strategy:'trend-reference',strategyRevision:'fixture',candleTime:0,referencePrice:50000,atr:1000,swingLow:stop,regime:'fixture',conditions:{},config:E.config(plan,m),protection:{stopPrice:stop,targetPrice:55000,horizonMs:3600000,timeframe:'1h'}};assert.equal(new E.SizedRisk(plan).reserve(s,signal,1).accepted,true);return Number(s.account.usdtPerTrade);}
 const x=size(49000);assert.ok(size(48000)<x);assert.ok(size(49000,2)<x);assert.ok(x<400);
});
test('No-trade zero PnL cannot qualify; annualization is suppressed on short intervals',()=>{
 const bars=candles(),variant=plan.variants[0],period={start:'2024-01-01',endExclusive:'2024-01-11'};
 const {summary}=E.run(bars,variant,plan,period,1,new Map());assert.equal(summary.netUsdt,0);assert.equal(summary.annualizedReturn,null);assert.ok(E.gates(summary,plan,'development').includes('NONPOSITIVE_NET'));
});
test('Capital drawdown latch blocks subsequent entries without deleting capital',()=>{
 const p=new E.ResearchPaper(plan,{archive:false}),s=newAccount('s','u',500,1,30),bars=candles(2);
 s.account.available='475';s.account.entriesEnabled=true;p.onCandle(s,bars[0],false,()=>true,{barOpenTime:bars[0].openTime,sourceCloseTime:null,capacity:0,used:0});
 assert.equal(p.halted,true);assert.equal(s.account.entriesEnabled,false);assert.equal(s.account.available,'475');
 s.account.available='499';p.onCandle(s,bars[1],false,()=>true,{barOpenTime:bars[1].openTime,sourceCloseTime:bars[0].closeTime,capacity:0,used:0});assert.equal(s.account.entriesEnabled,false);
});
test('Cash reference earns zero; BTC reference pays entry and estimated exit costs',()=>{
 const bars=candles(),period={start:'2024-01-01',endExclusive:'2024-01-11'};
 // Include causal prior minute so passive entry is possible.
 const prior={...bars[0],openTime:bars[0].openTime-60000,closeTime:bars[0].openTime-1};
 const b=E.benchmarks([prior,...bars],period,plan),stress=E.benchmarks([prior,...bars],period,plan,2);
 assert.equal(b[0].netUsdt,0);assert.equal(b[0].maxDrawdown,0);assert.equal(b[1].riskPass,false);assert.ok(stress[2].netUsdt<b[2].netUsdt);assert.ok(b[2].remainingBtc>0);
});
