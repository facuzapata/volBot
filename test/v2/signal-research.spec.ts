import { CandleAggregator } from '../../src/v2/backtesting/backtesting.engine';
import { StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { DEFAULT_SIMULATION } from '../../src/v2/domain/model';
import { bar } from './fixtures';
const { forward, sample, matchControls, blockBootstrap, holm, pairedOutcomes, adverseBeforeTarget } = require('../../scripts/signal-research/math.cjs');

describe('Isolated signal research: temporal and statistical contracts', () => {
  const t=Date.UTC(2025,0,1);
  const candles=Array.from({length:10},(_,i)=>bar(t+i*60000,{open:100+i,close:101+i,high:102+i,low:99+i}));
  const index=(b:typeof candles)=>new Map(b.map((c,i)=>[c.openTime,i]));
  it('ends a five-minute horizon at its fifth close, excluding minute six',()=>{
    const o=forward(candles,index(candles),t,5);
    expect(o.returnPct).toBeCloseTo(5,10);expect(o.endTime).toBe(t+5*60000-1);
    const mutated=candles.map((c,i)=>i===5?{...c,close:10000,high:10000}:c);
    expect(forward(mutated,index(mutated),t,5)).toEqual(o);
  });
  it('computes excursions and minute intervals without inventing tick order',()=>{
    const o=forward(candles,index(candles),t,5);
    expect(o.mfePct).toBeCloseTo(6,10);expect(o.maePct).toBeCloseTo(1,10);
    expect(o.mfeTimeMin).toBe(4);expect(o.mfeTimeMax).toBeCloseTo(5-1/60000,10);
  });
  it('censors missing entry, gaps and boundaries separately',()=>{
    expect(forward(candles,index(candles),t-60000,5).reason).toBe('missing entry minute');
    const gap=candles.filter((_,i)=>i!==2);
    expect(forward(gap,index(gap),t,5).reason).toBe('gap');
    expect(forward(candles,index(candles),t+8*60000,5).reason).toBe('right-censored');
  });
  it('reproduces seeded selection without selecting on future outcomes',()=>{
    expect(sample(candles,4,123)).toEqual(sample(candles,4,123));
    const cases=[{id:'case',period:'p',day:'2025-01-01',hour4:2,atrBucket:1,primaryTrend:true}];
    const pool=Array.from({length:20},(_,i)=>({...cases[0],id:String(i),futureReturn:i}));
    const plan={seed:1,matching:{controlsPerSignal:5}};
    const a=matchControls(cases,pool,'C',plan);
    const b=matchControls(cases,pool.map(x=>({...x,futureReturn:-x.futureReturn})),'C',plan);
    expect(a[0].controls.map((c:{id:string})=>c.id)).toEqual(b[0].controls.map((c:{id:string})=>c.id));
    expect(new Set(a[0].controls.map((c:{id:string})=>c.id)).size).toBe(5);
    expect(matchControls(cases,pool.map(x=>({...x,atrBucket:9})),'C',plan)[0].controls).toHaveLength(0);
  });
  it('clusters observations by calendar day and bootstraps reproducibly',()=>{
    const observations=[{period:'p',day:'2025-01-01',value:1},{period:'p',day:'2025-01-01',value:3},{period:'p',day:'2025-01-02',value:6}];
    const a=blockBootstrap(observations,{seed:7,reps:200});
    expect(a.days).toBe(2);expect(a.mean).toBeCloseTo(10/3,10);
    expect(a).toEqual(blockBootstrap(observations,{seed:7,reps:200}));
    expect(holm([.01,.04,.03])).toEqual([.03,.06,.06]);
  });
  it('compares paired cases with the same horizon and reports censoring without substituting a zero',()=>{
    const c={id:'case',period:'p',day:'2025-01-01'};const controls=[{id:'a'},{id:'b'}];
    const outcomes={case:{60:{complete:true,netReturnPct:.4,returnPct:.7}},a:{60:{complete:true,netReturnPct:.1,returnPct:.4}},b:{60:{complete:false}}};
    const r=pairedOutcomes([c],[{caseId:'case',controls:['a','b'],level:0}],new Map(controls.map(v=>[v.id,v])),outcomes,60);
    expect(r).toHaveLength(1);expect(r[0].controls).toHaveLength(1);expect(r[0].deltaNet).toBeCloseTo(.3,10);
    expect(pairedOutcomes([c],[{caseId:'case',controls:['b'],level:0}],new Map(controls.map(v=>[v.id,v])),outcomes,60)).toHaveLength(0);
  });
  it('bounds extra risk before TP without counting lows after a hypothetical target exit',()=>{
    const bars=[bar(t,{open:100,high:101,low:98}),bar(t+60000,{open:100,high:103,low:97}),bar(t+120000,{open:101,high:102,low:50})];
    const risk=adverseBeforeTarget(bars,102,99,100);
    expect(risk.extraAdverseBeforeTpLowerPct).toBe(1);expect(risk.extraAdverseBeforeTpUpperPct).toBe(2);
    expect(adverseBeforeTarget(bars.slice(0,1),102,99,100)).toBeNull();
    const gap=adverseBeforeTarget([bars[0],{...bars[1],openTime:t+120000}],102,99,100,t);
    expect(gap.pathToTpComplete).toBe(false);expect(gap.extraAdverseBeforeTpUpperPct).toBeNull();
  });
  it('finds executable tick-rounded break-even for market and limit exit with real quantity and fees',()=>{
    const {costEntry,costExit,breakEven}=require('../../scripts/signal-research/costs.cjs');
    const state=costEntry(100003.12,t),p=state.positions[0];const be=breakEven(p.quantity,p.remainingCost,100003.12);
    expect(costExit(state,be.breakEvenMarketReference,t+60000).netPnl).toBeGreaterThanOrEqual(0);
    expect(costExit(state,be.breakEvenMarketReference-.01,t+60000).netPnl).toBeLessThan(0);
    expect(costExit(state,be.breakEvenLimitReference,t+60000,'LIMIT').netPnl).toBeGreaterThanOrEqual(0);
    expect(costExit(state,be.breakEvenLimitReference-.01,t+60000,'LIMIT').netPnl).toBeLessThan(0);
  });
  it('uses only closed aligned 5m/1h buckets and preserves the signal prefix under future changes',()=>{
    const bars=Array.from({length:3300},(_,i)=>bar(t+i*60000,{open:100000+i,close:100001+i,high:100002+i,low:99999+i,volume:i%11===0?50:10}));
    const record=(input:typeof bars)=>{
      const agg=new CandleAggregator(),engine=new StrategyEngine();const h={'1m':[] as typeof bars,'5m':[] as typeof bars,'1h':[] as typeof bars};const seen:unknown[]=[];
      for(const c of input){for(const x of [c,...agg.push(c)]){h[x.timeframe].push(x);h[x.timeframe]=h[x.timeframe].slice(-100)}
        expect(h['5m'].every(x=>x.closeTime<=c.closeTime&&(x.closeTime+1)%300000===0)).toBe(true);
        expect(h['1h'].every(x=>x.closeTime<=c.closeTime&&(x.closeTime+1)%3600000===0)).toBe(true);
        const sig=engine.evaluate(h,'btc-v2',DEFAULT_SIMULATION);if(c.openTime<t+3200*60000)seen.push([sig?.id,engine.lastAssessment]);
      }return seen;
    };
    expect(record(bars)).toEqual(record(bars.map((c,i)=>i>=3200?{...c,high:c.high*2,close:c.close*1.9}:c)));
  });
});
