import {
  newAccount,
  PaperExecutionAdapter,
  BinanceSpotExecutionAdapter,
} from '../../src/v2/execution/paper-execution.adapter';
import { signal, bar } from './fixtures';

describe('Paper execution: balances, fees, protection, deterministic fills', () => {
  const paper = new PaperExecutionAdapter();
  const ready = () => {
    const s = newAccount('a', 'u', 500, 5, 30);
    s.account.entriesEnabled = true; s.account.lastLiquidityObservation={openTime:bar().openTime-60000,closeTime:bar().openTime-1,volume:100};
    return s;
  };
  const bought = () => {
    const s = ready();
    const sig = signal();
    paper.reserve(s, sig, sig.candleTime);
    paper.execute(s, s.orders[0].id, 100000, sig.candleTime, 1);
    return s;
  };
  it('defaults to paused entries and releases no funds for rejected signals', () => {
    const s = newAccount('a', 'u');
    expect(paper.reserve(s, signal(), signal().candleTime).reason).toBe('ENTRIES_PAUSED');
    expect(Number(s.account.available)).toBe(500);
    expect(s.orders).toHaveLength(0);
  });
  it('reserves once per account/signal and obeys a slot including pending entries', () => {
    const s = ready();
    s.account.maxPositions = 1;
    expect(paper.reserve(s, signal(), signal().candleTime).accepted).toBe(true);
    paper.reserve(s, signal(), signal().candleTime);
    expect(s.orders).toHaveLength(1);
    expect(s.positions[0].executionMode).toBe('PAPER');
    expect(s.orders[0].executionMode).toBe('PAPER');
    expect(Number(s.account.reserved)).toBe(30);
    expect(paper.reserve(s, signal('s2'), signal().candleTime).reason).toBe('MAX_POSITIONS');
  });
  it('has independent balances for two users receiving the same global signal', () => {
    const a = ready();
    const b = newAccount('b', 'v', 200, 3, 20);
    b.account.entriesEnabled = true;
    paper.reserve(a, signal(), signal().candleTime);
    paper.reserve(b, signal(), signal().candleTime);
    expect(Number(a.account.reserved)).toBe(30);
    expect(Number(b.account.reserved)).toBe(20);
    expect(a.orders[0].id).not.toBe(b.orders[0].id);
  });
  it('rejects insufficient funds, stale signals, low notional and excessive marked exposure', () => {
    const s = ready();
    s.account.usdtPerTrade = '501';
    expect(paper.reserve(s, signal(), signal().candleTime).reason).toBe('INSUFFICIENT_BALANCE');
    expect(paper.reserve(ready(), signal(), signal().candleTime + 120001).reason).toBe(
      'STALE_SIGNAL',
    );
    const tiny = ready();
    tiny.account.usdtPerTrade = '1';
    expect(paper.reserve(tiny, signal(), signal().candleTime).reason).toBe('FILTER_NOTIONAL');
    const marked = bought(); const expensive = signal('marked-exposure');
    expensive.referencePrice = 200000; expensive.swingLow = 199500; expensive.config.maxExposure = 0.14;
    expect(paper.reserve(marked, expensive, expensive.candleTime).reason).toBe('MAX_EXPOSURE');
  });
  it('executes partial fills smaller than min-notional and safely cancels the remainder', () => {
    const s = ready();
    paper.reserve(s, signal(), signal().candleTime);
    paper.execute(s, s.orders[0].id, 100000, signal().candleTime, 0.00002);
    expect(s.orders[0].status).toBe('PARTIALLY_FILLED');
    expect(Number(s.positions[0].quantity)).toBe(0.00002);
    paper.cancel(s, s.orders[0].id, signal().candleTime + 1);
    expect(Number(s.account.reserved)).toBe(0);
    expect(s.positions[0].status).toBe('OPEN');
    paper.assertInvariants(s);
  });
  it('charges both fees exactly once and realizes net proceeds minus allocated acquisition cost', () => {
    const s = bought();
    const p = s.positions[0];
    const qty = Number(p.quantity);
    const cost = Number(p.remainingCost);
    const exit = paper.requestExit(s, p.id, signal().candleTime + 1, 'TEST')!;
    paper.execute(s, exit.id, 101000, signal().candleTime + 2, 1);
    const expected = qty * 101000 * 0.999 - cost;
    expect(Number(p.realizedPnl)).toBeCloseTo(expected, 9);
    expect(Number(s.account.available)).toBeCloseTo(500 + expected, 9);
    const count = s.fills.length;
    paper.execute(s, exit.id, 101000, signal().candleTime + 2, 1);
    expect(s.fills).toHaveLength(count);
    expect(Number(p.quantity)).toBe(0);
  });
  it('prioritizes stop when the same OHLC candle touches stop and target', () => {
    const s = bought();
    paper.onCandle(s, bar(undefined, { high: 102000, low: 99000 }));
    expect(s.positions[0].exitReason).toBe('STOP_LOSS');
    expect(Number(s.positions[0].realizedPnl)).toBeLessThan(0);
  });
  it('does not sell above its position, and does not duplicate an exit', () => {
    const s = bought();
    const p = s.positions[0];
    const first = paper.requestExit(s, p.id, signal().candleTime + 1, 'TEST')!;
    const second = paper.requestExit(s, p.id, signal().candleTime + 1, 'TEST')!;
    expect(first.id).toBe(second.id);
    first.quantity = '99';
    paper.execute(s, first.id, 100000, signal().candleTime + 2, 1);
    expect(Number(p.quantity)).toBe(0);
    paper.assertInvariants(s);
  });
  it('keeps supervising positions while entries are paused and survives serialized restart', () => {
    const s = JSON.parse(JSON.stringify(bought()));
    s.account.entriesEnabled = false;
    paper.onCandle(s, bar(undefined, { high: 102000 }));
    expect(s.positions[0].status).toBe('CLOSED');
    paper.onCandle(s, bar(undefined, { high: 102000 }));
    expect(s.fills).toHaveLength(2);
  });
  it('leaves UNKNOWN entry reservations counted and never executes them automatically', () => {
    const s = ready();
    s.account.maxPositions = 1;
    paper.reserve(s, signal(), signal().candleTime);
    s.orders[0].status = 'UNKNOWN';
    paper.execute(s, s.orders[0].id, 100000, signal().candleTime, 1);
    expect(s.fills).toHaveLength(0);
    expect(paper.reserve(s, signal('s2'), signal().candleTime).reason).toBe('MAX_POSITIONS');
  });
  it('does not use the current bar high to raise a stop before evaluating its low', () => {
    const s = bought();
    s.positions[0].config.trailing = true;
    paper.onCandle(s, bar(undefined, { high: 100950, low: 99900, close: 100850 }));
    expect(s.positions[0].status).toBe('OPEN');
    expect(Number(s.positions[0].stopLoss)).toBeGreaterThan(100000);
    paper.onCandle(
      s,
      bar(1735689720000, { open: 100850, high: 100900, low: 100400, close: 100500 }),
    );
    expect(s.positions[0].exitReason).toBe('STOP_LOSS');
  });
  it('blocks live adapter calls regardless of environment settings', () => {
    const live = new BinanceSpotExecutionAdapter();
    process.env.TRADING_MODE = 'LIVE';
    expect(() => live.execute()).toThrow('LIVE_TRADING_COMPILED_OUT');
    expect(() => live.cancel()).toThrow();
    delete process.env.TRADING_MODE;
  });
  it('keeps the stop active after a take-profit partial fill', () => {
    const s = bought(); const p = s.positions[0];
    const tp = paper.requestExit(s, p.id, signal().candleTime + 1, 'TAKE_PROFIT', 'LIMIT', 101000)!;
    paper.execute(s, tp.id, 101000, signal().candleTime + 2, 0.0001);
    expect(tp.status).toBe('PARTIALLY_FILLED');
    paper.onCandle(s, bar(undefined, { low: 99000 }));
    expect(tp.status).toBe('CANCELLED'); expect(p.status).toBe('CLOSED');
    expect(p.exitReason).toBe('STOP_LOSS'); expect(s.fills).toHaveLength(3);
  });
  it('exits an aged position instead of waiting indefinitely for entry recovery', () => {
    const s = bought(); s.positions[0].config.maxHoldingMs = 60000;
    paper.onCandle(s, bar()); expect(s.positions[0].status).toBe('CLOSED');
    expect(s.positions[0].exitReason).toBe('TIME_STOP');
  });
  it('blocks entries on realized daily loss even if the remaining equity recovers', () => {
    const s = ready(); s.account.day = new Date(signal().candleTime).toISOString().slice(0, 10);
    s.account.dayPnl = '-16'; s.account.dayStartEquity = '500';
    expect(paper.reserve(s, signal(), signal().candleTime).reason).toBe('DAILY_LOSS_LIMIT');
  });
  it('does not execute an order against a candle preceding its creation', () => {
    const s = ready(); const sig = signal(); paper.reserve(s, sig, sig.candleTime);
    paper.execute(s, s.orders[0].id, 100000, sig.candleTime - 1, 1);
    expect(s.fills).toHaveLength(0); expect(Number(s.account.reserved)).toBe(30);
  });
});
