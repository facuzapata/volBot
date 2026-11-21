import { readFileSync } from 'fs';
import { PaperExecutionAdapter, newAccount } from '../../src/v2/execution/paper-execution.adapter';
import { bar, signal } from './fixtures';
import { causalLiquidity } from '../../src/v2/execution/causal-liquidity';

describe('BTC-V3 prerequisite fixes: failing-before contracts',()=>{
  const paper=new PaperExecutionAdapter();
  const ready=()=>{const s=newAccount('fix','fix',500,5,30);s.account.entriesEnabled=true;return s};
  const bad=JSON.parse(readFileSync(`${__dirname}/fixtures/invalid-stop-cases.json`,'utf8')).cases;
  it('reproduces exactly six economically invalid original protections',()=>expect(bad).toHaveLength(6));
  for(const p of bad)it(`rejects original stop geometry ${p.signalId.slice(0,10)} before any fill and releases the reservation`,()=>{
    const s=ready(),c={open:p.rawOpen,openTime:p.openedAt},previous={close:p.referencePrice,closeTime:p.openedAt-1};
    const sig={...signal(p.signalId,previous.closeTime),referencePrice:previous.close,atr:Number(p.atr),swingLow:previous.close*(1-p.stopDistance),config:{...p.config}};
    expect(paper.reserve(s,sig,sig.candleTime).accepted).toBe(true);
    paper.execute(s,s.orders[0].id,c.open,c.openTime,1);
    expect(s.orders[0].status).toBe('REJECTED');expect(s.orders[0].rejection).toBe('STOP_NOT_BELOW_REFERENCE');
    expect(s.fills).toHaveLength(0);expect(Number(s.account.reserved)).toBe(0);expect(Number(s.account.available)).toBe(500);
  });
  it('revalidates the configured maximum net stop loss at fill time',()=>{
    const s=ready();paper.reserve(s,signal(),signal().candleTime);s.positions[0].config.maxRiskPerTrade=.000001;
    paper.execute(s,s.orders[0].id,100000,signal().candleTime,1);
    expect(s.orders[0].status).toBe('REJECTED');expect(s.orders[0].rejection).toBe('EXECUTION_TRADE_RISK');expect(s.fills).toHaveLength(0);
  });
  it('does not use current candle volume to size a pending opening fill',()=>{
    const run=(volume:number)=>{const s=ready();paper.reserve(s,signal(),signal().candleTime);
      Object.assign(s.account,{lastLiquidityObservation:{openTime:bar().openTime-60000,closeTime:bar().openTime-1,volume:.1}});
      paper.onCandle(s,bar(undefined,{volume}));return Number(s.fills[0]?.quantity??0)};
    expect(run(0)).toBe(.0001);expect(run(1000)).toBe(.0001);
  });
  it('defers a pending entry when no prior closed volume observation exists',()=>{
    const s=ready();paper.reserve(s,signal(),signal().candleTime);paper.onCandle(s,bar());
    expect(s.fills).toHaveLength(0);expect(s.orders[0].status).toBe('PENDING');
  });
  it('rejects nonfinite risk geometry rather than creating a malformed protection',()=>{
    const s=ready();const sig=signal();sig.atr=NaN;
    expect(paper.reserve(s,sig,sig.candleTime).accepted).toBe(false);expect(s.orders).toHaveLength(0);
  });
  it('shares a causal opening budget across orders/accounts and reconstructs usage after restart',()=>{
    const a=ready(),b=newAccount('second','second',500,5,30);b.account.entriesEnabled=true;
    paper.reserve(a,signal(),signal().candleTime);paper.reserve(b,signal(),signal().candleTime);
    const c=bar(),prior={openTime:c.openTime-60000,closeTime:c.openTime-1,volume:.2},budget=causalLiquidity(c.openTime,prior,.001);
    paper.execute(a,a.orders[0].id,c.open,c.openTime,budget,'OPEN');paper.execute(b,b.orders[0].id,c.open,c.openTime,budget,'OPEN');
    expect(a.fills).toHaveLength(1);expect(Number(a.fills[0].quantity)).toBe(.0002);expect(b.fills).toHaveLength(0);
    const restored=causalLiquidity(c.openTime,prior,.001,Number(a.fills[0].quantity));
    paper.execute(b,b.orders[0].id,c.open,c.openTime,restored,'OPEN');expect(b.fills).toHaveLength(0);
    expect(a.fills[0].liquiditySourceCloseTime).toBe(c.openTime-1);expect(a.fills[0].executionPhase).toBe('OPEN');
  });
  it('preserves an already filled partial position when a later entry slice is rejected',()=>{
    const s=ready();paper.reserve(s,signal(),signal().candleTime);paper.execute(s,s.orders[0].id,100000,signal().candleTime,.0001);
    const before={qty:s.positions[0].quantity,stop:s.positions[0].stopLoss,cost:s.positions[0].remainingCost,fill:JSON.stringify(s.fills[0])};
    s.positions[0].stopDistance=.0001;s.positions[0].config.spreadBps=2;s.positions[0].config.slippageBps=3;
    paper.execute(s,s.orders[0].id,100000,signal().candleTime+1,1);
    expect(s.orders[0].status).toBe('REJECTED');expect(Number(s.account.reserved)).toBe(0);expect(s.positions[0].quantity).toBe(before.qty);expect(s.positions[0].stopLoss).toBe(before.stop);expect(s.positions[0].remainingCost).toBe(before.cost);expect(JSON.stringify(s.fills[0])).toBe(before.fill);
    paper.assertInvariants(s);
  });
  it('keeps unsafe acquired inventory visible and queues a safe exit if capacity is unavailable',()=>{
    const s=ready();paper.reserve(s,signal(),signal().candleTime);paper.execute(s,s.orders[0].id,100000,signal().candleTime,1);
    s.positions[0].stopLoss='0';const qty=s.positions[0].quantity;paper.onCandle(s,bar());
    expect(s.positions[0].quantity).toBe(qty);expect(s.positions[0].status).toBe('CLOSING');expect(s.orders.at(-1)?.reason).toBe('UNSAFE_PROTECTION');
    paper.onCandle(s,bar(bar().openTime+60000));expect(s.positions[0].status).toBe('CLOSED');expect(s.fills).toHaveLength(2);
  });
});
