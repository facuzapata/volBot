import {liveFixture} from './live-paper.fixtures';
import {frozenSignal,aggregate} from '../../src/v2/live-paper/strategies';
import {BOT_IDS,fingerprint} from '../../src/v2/live-paper/model';
import {BinanceSpotExecutionAdapter} from '../../src/v2/execution/paper-execution.adapter';
const research=require('../../scripts/net-optimization/engine.cjs');
describe('Prospective PAPER causal kernel',()=>{
 it('matches both original frozen research signal levels using only complete UTC bars',()=>{
  const f=liveFixture();for(const id of BOT_IDS){const variant={id,family:id==='pullback-4h'?'pullback':'momentum',hours:id==='pullback-4h'?4:1,stopAtr:2,rewardRisk:3,holdHours:id==='pullback-4h'?120:48},cache=research.features(f.history,variant.hours),original=new research.ResearchStrategy(variant,cache).evaluate({'1m':[f.history.at(-1)],'5m':[],'1h':[]},'trend-reference',f.e.config.execution),signal=frozenSignal(f.history,id,f.e.config,f.e.id);
   expect(original).not.toBeNull();expect(signal).not.toBeNull();expect(signal!.referencePrice).toBe(original.referencePrice);expect(signal!.atr).toBe(original.atr);expect(signal!.protection!.stopPrice).toBe(original.protection.stopPrice);expect(signal!.protection!.targetPrice).toBe(original.protection.targetPrice);expect(signal!.config.maxHoldingMs).toBe(original.config.maxHoldingMs);
  }
  const partial=f.history.slice(0,-1);expect(aggregate(partial,4).at(-1)!.closeTime).toBeLessThan(partial.at(-1)!.closeTime);expect(frozenSignal(partial,'pullback-4h',f.e.config,f.e.id)).toBeNull();
 });
 it('never fills at a historical close or on the quote that first reveals a signal',()=>{
  const f=liveFixture(),q1=f.quote(1);f.apply(f.e,q1);for(const id of BOT_IDS){expect(f.e.bots[id].pending).toBeDefined();expect(f.e.bots[id].s.fills).toHaveLength(0);}
  const q2=f.quote(2,q1.receivedAt+1000,q1.ask+1);f.apply(f.e,q2);
  for(const id of BOT_IDS){const b=f.e.bots[id],fill=b.s.fills[0];expect(fill).toBeDefined();expect(fill.at).toBe(q2.receivedAt);expect(Number(fill.price)).toBeGreaterThanOrEqual(q2.ask);expect(Number(fill.price)).not.toBe(b.lastSignal?.at);expect(Number(fill.price)).toBeGreaterThan(f.history.at(-1)!.close);expect(b.lastMetrics!.maxExposure).toBeLessThanOrEqual(.8);f.kernel.reconcile(b);}
 });
 it('shares causal minute liquidity, conservatively caps depth and preserves partial reservations',()=>{
  const f=liveFixture();f.apply(f.e,f.quote(1));const events=f.apply(f.e,f.quote(2,undefined,undefined,.1));const fills=events.filter(e=>e.kind==='fill');expect(fills).toHaveLength(1);expect(f.e.bots['pullback-4h'].s.orders[0].status).toBe('PARTIALLY_FILLED');expect(Number(f.e.bots['pullback-4h'].s.account.reserved)).toBeGreaterThan(0);expect(Number(f.e.bots['momentum-1h'].s.account.available)).toBeLessThan(500);expect(f.e.bots['momentum-1h'].s.fills).toHaveLength(0);
  const missing=liveFixture();missing.apply(missing.e,missing.quote(1));const q=missing.quote(2),before=missing.e.bots['pullback-4h'].s.fills.length;missing.kernel.apply(missing.e,{quote:q,now:q.receivedAt,feed:missing.feed(q),history:missing.history,usedVolume:0});expect(missing.e.bots['pullback-4h'].s.fills).toHaveLength(before);
 });
 it('pause releases only pending reserves, maintains acquired protection and exits on a subsequent bid',()=>{
  const f=liveFixture();f.apply(f.e,f.quote(1));f.apply(f.e,f.quote(2,undefined,undefined,.1));const b=f.e.bots['pullback-4h'],qty=b.s.positions[0].quantity;f.kernel.pause(f.e,b.id,'MANUAL_PAUSE');expect(Number(b.s.account.reserved)).toBe(0);expect(b.s.positions[0].quantity).toBe(qty);const other=f.e.bots['momentum-1h'];f.kernel.pause(f.e,other.id,'MANUAL_PAUSE');const q=f.quote(3,undefined,Number(b.s.positions[0].stopLoss)-10);f.apply(f.e,q);expect(b.s.positions[0].status).toBe('CLOSED');expect(b.s.fills[1].side).toBe('SELL');expect(Number(b.s.fills[1].price)).toBeLessThanOrEqual(q.bid);expect(other.s.account.available).toBe('500.000000000000');f.kernel.reconcile(b);f.kernel.reconcile(other);
 });
 it('rejects stale/future quotes and blocks buys across dependency loss without inventing fills',()=>{
  const f=liveFixture(),q=f.quote(1);expect(f.kernel.validQuote(q,q.receivedAt+3000,f.e.config)).toBe(false);expect(f.kernel.validQuote(q,q.receivedAt-1,f.e.config)).toBe(false);f.apply(f.e,q);f.apply(f.e,f.quote(2),0,{redis:false});for(const id of BOT_IDS){expect(f.e.bots[id].paused).toBe(true);expect(f.e.bots[id].s.fills).toHaveLength(0);}
 });
 it('detects ledger inconsistencies and immutable configuration tampering',()=>{const f=liveFixture();f.e.bots['pullback-4h'].s.account.available='499';expect(()=>f.kernel.reconcile(f.e.bots['pullback-4h'])).toThrow('LEDGER_COST');f.e.config.execution.feeRate=0;expect(()=>f.apply(f.e,f.quote(1))).toThrow('CONFIGURATION_TAMPERED');});
 it('uses conservative liquidation wealth without subtracting commissions twice and has independent accounts',()=>{const f=liveFixture();f.apply(f.e,f.quote(1));f.apply(f.e,f.quote(2));for(const id of BOT_IDS){const b=f.e.bots[id],m=b.lastMetrics!;expect(Number(m.netPnl)).toBeLessThan(0);expect(Number(m.equity)).toBeCloseTo(500+Number(m.netRealizedPnl)+Number(m.unrealizedPnl),8);expect(b.s.account.id).toContain(id);expect(b.s.ledger.length).toBeGreaterThan(0);}expect(f.e.bots['pullback-4h'].s.account.id).not.toBe(f.e.bots['momentum-1h'].s.account.id);});
 it('enforces realized gap loss, keeps expiry fixed and never enables LIVE',()=>{
  const f=liveFixture();f.apply(f.e,f.quote(1));f.apply(f.e,f.quote(2));f.apply(f.e,f.quote(3,undefined,9000));expect(f.e.bots['pullback-4h'].hardHalt).toBe(true);expect(f.e.bots['momentum-1h'].hardHalt).toBe(true);expect(f.e.bots['pullback-4h'].lastMetrics!.netPnl).toBeLessThan(-2.5);
  const empty=liveFixture(),end=empty.e.endsAt!;empty.apply(empty.e,empty.quote(10,end+1));expect(empty.e.phase).toBe('ENDED');expect(empty.e.endsAt).toBe(end);expect(empty.e.bots['pullback-4h'].s.fills).toHaveLength(0);expect(()=>new BinanceSpotExecutionAdapter().execute()).toThrow('LIVE_TRADING_COMPILED_OUT');
 });
 it('produces stable configuration hashes despite PostgreSQL key ordering',()=>{const f=liveFixture(),reordered=Object.fromEntries(Object.entries(f.e.config).reverse());expect(fingerprint(f.e.config)).toBe(fingerprint(reordered));});
});
