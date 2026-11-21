import { PaperExecutionAdapter, newAccount } from '../../src/v2/execution/paper-execution.adapter';
import { BacktestingEngine } from '../../src/v2/backtesting/backtesting.engine';
import { bar, signal } from './fixtures';

describe('Simulator audit: independent deterministic contracts', () => {
  const paper = new PaperExecutionAdapter();
  const ready = () => { const s = newAccount('audit', 'audit', 500, 5, 30); s.account.entriesEnabled = true; s.account.lastLiquidityObservation={openTime:bar().openTime-60000,closeTime:bar().openTime-1,volume:100}; return s; };
  const bought = () => { const s = ready(); paper.reserve(s, signal(), signal().candleTime); paper.execute(s, s.orders[0].id, 100000, signal().candleTime, 1); return s; };
  it('honors the known opening TP before a later low can touch SL', () => {
    const s = bought(); paper.onCandle(s, bar(undefined, { open: 102000, high: 103000, low: 99000, close: 100000 }));
    expect(s.positions[0].exitReason).toBe('TAKE_PROFIT');
  });
  it('evaluates protection after an unfilled entry actually fills at the opening of a bar', () => {
    const s = ready(); paper.reserve(s, signal(), signal().candleTime);
    paper.onCandle(s, bar(undefined, { open: 100000, high: 100100, low: 99000, close: 99900 }));
    expect(s.positions[0].status).toBe('CLOSED');
    expect(s.positions[0].exitReason).toBe('STOP_LOSS');
  });
  it('does not let a completed order prevent supervision when a manipulated quantity is exhausted', () => {
    const s = bought(); const o = paper.requestExit(s, s.positions[0].id, signal().candleTime + 1, 'TEST')!;
    paper.execute(s, o.id, 100000, signal().candleTime + 2, 1);
    const before = JSON.stringify(s); paper.cancel(s, o.id, signal().candleTime + 3);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('does not read future closes to generate a signal, and retains end-of-test inventory', () => {
    const candles = Array.from({ length: 55 }, (_, i) => bar(1735689600000+i*60000));
    const observed: number[] = [];
    const strategy = { evaluate: (h: { '1m': ReturnType<typeof bar>[] }) => {
      const last = h['1m'].slice(-1)[0]; observed.push(last.closeTime);
      return h['1m'].length === 54 ? { ...signal(), candleTime: last.closeTime, referencePrice: last.close } : null;
    }, invalidated: () => false };
    const result = new BacktestingEngine(strategy as never).run(candles, { strategy: 'btc-v2', initialCapital: 500, maxPositions: 5, usdtPerTrade: 30 });
    expect(observed).toEqual(candles.map(c => c.closeTime));
    expect(result.trades[0].openedAt).toBe(candles[54].openTime);
    expect(result.trades[0].status).toBe('OPEN'); expect(result.metrics.immobilizedCapital).toBeGreaterThan(0);
  });
  it('keeps the conservative stop-first rule when the opening is between both barriers', () => {
    const s = bought(); paper.onCandle(s, bar(undefined, { high: 102000, low: 99000 }));
    expect(s.positions[0].exitReason).toBe('STOP_LOSS');
  });
  it('uses the worse opening on a stop gap and charges quote fees only once', () => {
    const s = bought(); const cost = Number(s.positions[0].remainingCost); const qty = Number(s.positions[0].quantity);
    paper.onCandle(s, bar(undefined, { open: 98000, low: 97000, high: 98100, close: 97500 }));
    expect(Number(s.fills[1].price)).toBe(98000);
    expect(Number(s.positions[0].realizedPnl)).toBeCloseTo(qty*98000*0.999-cost, 9);
  });
  it('accounts for a BTC-denominated buy fee without charging it again in quote cost', () => {
    const s = ready(); const sig = signal(); Object.assign(sig.config, { buyCommissionAsset: 'BTC' });
    paper.reserve(s, sig, sig.candleTime); paper.execute(s, s.orders[0].id, 100000, sig.candleTime, 1);
    const fill = s.fills[0]; const p = s.positions[0];
    expect(fill.commissionAsset).toBe('BTC');
    expect(Number(p.quantity)).toBeCloseTo(Number(fill.quantity) * (1-sig.config.feeRate), 12);
    expect(Number(p.remainingCost)).toBeCloseTo(Number(fill.quote), 10);
    expect(Number(s.account.available)).toBeCloseTo(500 - Number(fill.quote), 10);
  });
  it('blocks entries when an existing stop is a decimal zero string', () => {
    const s = bought(); s.positions[0].stopLoss = '0.000000000000';
    expect(paper.reserve(s, signal('unsafe'), signal().candleTime).reason).toBe('UNPROTECTED_POSITION');
  });
  it('fills a midbar entry at the close without retroactive exposure to the earlier low', () => {
    const s = ready(); const c = bar(); const sig=signal('midbar',c.openTime+10000);
    paper.reserve(s,sig,sig.candleTime);
    paper.onCandle(s,{...c,low:98000,close:100100});
    expect(s.fills).toHaveLength(1);
    expect(s.fills[0].at).toBe(c.closeTime);
    expect(Number(s.fills[0].price)).toBe(100100);
    expect(s.positions[0].status).toBe('OPEN');
  });
  it('preserves BTC fee dust and its cost after selling the tradable balance', () => {
    const s=ready(); const sig=signal(); sig.config.buyCommissionAsset='BTC';
    paper.reserve(s,sig,sig.candleTime);paper.execute(s,s.orders[0].id,100000,sig.candleTime, 1);
    const qty=Number(s.positions[0].quantity);
    const exit=paper.requestExit(s,s.positions[0].id,sig.candleTime+1,'TEST')!;
    paper.execute(s,exit.id,100000,sig.candleTime+2, 1);
    const p=s.positions[0];
    expect(p.status).toBe('DUST');expect(Number(p.quantity)).toBeGreaterThan(0);
    expect(Number(p.remainingCost)).toBeGreaterThan(0);
    expect(Number(s.fills[1].quantity)+Number(p.quantity)).toBeCloseTo(qty,12);
    expect(Number(p.quantity)).toBeLessThan(sig.config.stepSize);
    expect(paper.requestExit(s,p.id,sig.candleTime+3,'DUST_RETRY')).toBeUndefined();
    expect(p.status).toBe('DUST');expect(s.orders.filter(o=>o.side==='SELL')).toHaveLength(1);
    paper.assertInvariants(s);
  });
  it('rounds an adverse buy to tick and quantity step without spending beyond its reservation', () => {
    const s=ready();const sig=signal();sig.config.spreadBps=2;sig.config.slippageBps=3;
    paper.reserve(s,sig,sig.candleTime);paper.execute(s,s.orders[0].id,100003.123,sig.candleTime, 1);
    const fill=s.fills[0];
    expect(Number(fill.price)).toBeCloseTo(100043.13,8);
    expect(Number(fill.quantity)/sig.config.stepSize).toBeCloseTo(Math.round(Number(fill.quantity)/sig.config.stepSize),8);
    expect(Number(fill.quote)+Number(fill.commission)).toBeLessThanOrEqual(30);
    paper.assertInvariants(s);
  });
  it('closes on a completed trend invalidation at the close while entries are paused', () => {
    const s=bought();s.account.entriesEnabled=false;
    paper.onCandle(s,bar(),true);
    expect(s.positions[0].exitReason).toBe('INVALIDATION');
    expect(s.fills[1].at).toBe(bar().closeTime);
  });
});
