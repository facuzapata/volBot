import { RiskPolicy } from '../risk/risk-policy';
import Decimal from 'decimal.js';
import {
  AccountState,
  Candle,
  DEFAULT_SIMULATION,
  ExchangeOrder,
  isOrderOpen,
  isPositionOpen,
  MarketSignal,
  CausalLiquidityBudget,
} from '../domain/model';
import { causalLiquidity, remainingLiquidity } from './causal-liquidity';
import { executionPrice } from './pricing';
import { assessExecutionRisk } from '../risk/execution-risk';

const d = (n: Decimal.Value) => new Decimal(n);
const str = (n: Decimal.Value) => d(n).toFixed(12);
const floor = (n: Decimal.Value, step: Decimal.Value) => d(n).div(step).floor().mul(step);
const terminal = (
  s: AccountState,
  o: ExchangeOrder,
  status: 'CANCELLED' | 'REJECTED',
  at: number,
  reason: string,
) => {
  if (!isOrderOpen(o)) return;
  o.status = status;
  o.rejection = reason;
  if (o.side === 'BUY') {
    const released = o.reservedQuote;
    s.account.available = str(d(s.account.available).plus(released));
    s.account.reserved = str(d(s.account.reserved).minus(released));
    o.reservedQuote = '0';
    s.ledger.push({
      id: `${o.id}:release`,
      orderId: o.id,
      positionId: o.positionId,
      asset: 'USDT',
      availableDelta: released,
      reservedDelta: str(d(released).neg()),
      reason,
      at,
    });
    const p = s.positions.find((x) => x.id === o.positionId)!;
    p.status = d(p.quantity).gt(0) ? 'OPEN' : 'REJECTED';
  }
};
export interface ExecutionAdapter {
  readonly mode: 'PAPER';
  execute(s: AccountState, orderId: string, price: number, at: number, liquidity?: number|CausalLiquidityBudget): void;
  cancel(s: AccountState, orderId: string, at: number): void;
}
export const EXECUTION_ADAPTER = Symbol('ExecutionAdapter');

/** Pure deterministic simulator. It has no HTTP client, credentials or exchange SDK. */
export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly mode = 'PAPER' as const;

  reserve(
    s: AccountState,
    signal: MarketSignal,
    at: number,
  ): { accepted: boolean; reason: string } {
    return new RiskPolicy().reserve(s, signal, at);
  }

  execute(
    s: AccountState,
    orderId: string,
    referencePrice: number,
    at: number,
    liquidity: number|CausalLiquidityBudget = 0,
    phase:'OPEN'|'INTRABAR'|'CLOSE'|'DECISION'='DECISION',
  ): void {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o || !isOrderOpen(o) || o.status === 'UNKNOWN' || at < o.createdAt) return;
    const p = s.positions.find((x) => x.id === o.positionId)!;
    const c = p.config;
    if(o.side==='BUY'&&at-o.createdAt>c.signalMaxAgeMs){terminal(s,o,'REJECTED',at,'STALE_ENTRY');return;}
    if(![c.tickSize,c.stepSize,c.minQty].every(v=>Number.isFinite(v)&&v>0)||![c.feeRate,c.spreadBps,c.slippageBps].every(v=>Number.isFinite(v)&&v>=0)){
      if(o.side==='BUY')terminal(s,o,'REJECTED',at,'INVALID_EXECUTION_FILTERS');else o.deferredReason='INVALID_FILTERS_NEEDS_REVIEW';return;
    }
    if(typeof liquidity!=='number'&&(!Number.isFinite(liquidity.capacity)||!Number.isFinite(liquidity.used)||liquidity.capacity<0||liquidity.used<0)){o.deferredReason='INVALID_LIQUIDITY_OBSERVATION';return;}
    const available=typeof liquidity==='number'?liquidity:remainingLiquidity(liquidity);
    if (!Number.isFinite(referencePrice) || referencePrice <= 0 || available <= 0) {o.deferredReason='NO_CAUSAL_LIQUIDITY';return;}
    if(typeof liquidity!=='number'&&(liquidity.sourceCloseTime===null||liquidity.sourceCloseTime>=liquidity.barOpenTime||at<liquidity.barOpenTime||at>=liquidity.barOpenTime+60000)){o.deferredReason='INVALID_LIQUIDITY_OBSERVATION';return;}
    if (
      o.type === 'LIMIT' &&
      o.limitPrice &&
      (o.side === 'BUY'
        ? referencePrice > Number(o.limitPrice)
        : referencePrice < Number(o.limitPrice))
    )
      return;
    const price=executionPrice(referencePrice,o.side,c,o.type==='LIMIT'?o.limitPrice:undefined);
    let qty = d(o.quantity).minus(o.filledQuantity);
    if (Number.isFinite(available)) qty = Decimal.min(qty, floor(available, c.stepSize));
    if (o.side === 'BUY')
      qty = Decimal.min(qty, floor(d(o.reservedQuote).div(price.mul(1 + (c.buyCommissionAsset === 'BTC' ? 0 : c.feeRate))), c.stepSize));
    else qty = Decimal.min(qty, d(p.quantity));
    qty = floor(qty, c.stepSize);
    if (qty.lt(c.minQty)) {
      if (o.side === 'BUY' && d(o.reservedQuote).lt(price.mul(c.minQty).mul(1 + c.feeRate)))
        terminal(s, o, 'CANCELLED', at, 'REMAINDER_UNAFFORDABLE');
      return;
    }
    const quote = qty.mul(price);
    const baseFee = o.side === 'BUY' && c.buyCommissionAsset === 'BTC';
    const feeQuote = quote.mul(c.feeRate);
    const fee = baseFee ? qty.mul(c.feeRate) : feeQuote;
    if(o.side==='BUY'){
      if(!Number.isFinite(p.stopDistance)||p.stopDistance<=0){terminal(s,o,'REJECTED',at,'INVALID_EXECUTION_GEOMETRY');return;}
      const risk=assessExecutionRisk(s,p,referencePrice,price,qty,at);o.executionRisk=risk;
      if(!risk.accepted){terminal(s,o,'REJECTED',at,risk.reason);return;}
      p.executionRisk=risk;
    }
    // Notional applies to the original order, not each partial fill.
    if (d(o.filledQuantity).eq(0) && d(o.quantity).mul(price).lt(c.minNotional)) {
      terminal(s, o, 'REJECTED', at, 'FILTER_NOTIONAL');
      if (o.side === 'SELL') p.status = 'DUST';
      return;
    }
    const fillId = `${o.id}:${at}:${o.filledQuantity}`;
    if (s.fills.some((f) => f.id === fillId)) return;
    const impact = (o.side === 'BUY' ? price.minus(referencePrice) : d(referencePrice).minus(price)).mul(qty);
    const spreadCost = o.type === 'LIMIT' ? d(0) : qty.mul(referencePrice).mul(c.spreadBps / 20000);
    const slipCost = o.type === 'LIMIT' ? d(0) : qty.mul(referencePrice).mul(c.slippageBps / 10000);
    s.fills.push({
      id: fillId,
      orderId: o.id,
      positionId: p.id,
      side: o.side,
      quantity: str(qty),
      price: str(price),
      quote: str(quote),
      commission: str(fee),
      commissionAsset: baseFee ? 'BTC' : 'USDT',
      commissionQuote: str(feeQuote),
      referencePrice: str(referencePrice), spreadCostQuote: str(spreadCost), slippageCostQuote: str(slipCost), roundingCostQuote: str(impact.minus(spreadCost).minus(slipCost)),
      at,
      executionPhase:phase,
      liquiditySourceCloseTime:typeof liquidity==='number'?undefined:liquidity.sourceCloseTime,
      liquidityCapacity:typeof liquidity==='number'?undefined:liquidity.capacity,
    });
    o.filledQuantity = str(d(o.filledQuantity).plus(qty));
    if (o.side === 'BUY') {
      const cost = baseFee ? quote : quote.plus(fee);
      const received = baseFee ? qty.minus(fee) : qty;
      const priorGross = p.entryGrossQuantity ?? p.entryQuantity;
      s.account.reserved = str(d(s.account.reserved).minus(cost));
      o.reservedQuote = str(d(o.reservedQuote).minus(cost));
      p.quantity = str(d(p.quantity).plus(received));
      p.entryQuantity = str(d(p.entryQuantity).plus(received));
      p.entryGrossQuantity = str(d(priorGross).plus(qty));
      p.entryQuote = str(d(p.entryQuote).plus(quote));
      p.entryReferenceQuote=str(d(p.entryReferenceQuote??0).plus(qty.mul(referencePrice)));
      p.entryFees = str(d(p.entryFees).plus(feeQuote));
      p.remainingCost = str(d(p.remainingCost).plus(cost));
      p.averageEntry = str(d(p.entryQuote).div(p.entryGrossQuantity));
      p.stopLoss=p.executionRisk!.stopPrice;
      p.takeProfit = str((p.protectionMode==='ABSOLUTE'?d(p.plannedTarget!):d(p.averageEntry).mul(1+p.targetDistance)).div(c.tickSize).ceil().mul(c.tickSize));
      p.highWater = str(Decimal.max(p.highWater, price));
      p.status = 'OPEN';
      s.ledger.push({
        id: `${fillId}:quote`,
        orderId: o.id,
        positionId: p.id,
        asset: 'USDT',
        availableDelta: '0',
        reservedDelta: str(cost.neg()),
        reason: 'BUY_WITH_FEE',
        at,
      });
      s.ledger.push({
        id: `${fillId}:base`,
        orderId: o.id,
        positionId: p.id,
        asset: 'BTC',
        availableDelta: str(qty),
        reservedDelta: '0',
        reason: 'BUY',
        at,
      });
      if (baseFee) s.ledger.push({ id: `${fillId}:base-fee`, orderId: o.id, positionId: p.id, asset: 'BTC', availableDelta: str(fee.neg()), reservedDelta: '0', reason: 'BUY_COMMISSION', at });
    } else {
      const allocatedCost = d(p.remainingCost).mul(qty).div(p.quantity);
      const proceeds = quote.minus(fee);
      const pnl = proceeds.minus(allocatedCost);
      p.remainingCost = str(d(p.remainingCost).minus(allocatedCost));
      p.quantity = str(d(p.quantity).minus(qty));
      p.realizedPnl = str(d(p.realizedPnl).plus(pnl));
      s.account.dayPnl = str(d(s.account.dayPnl).plus(pnl));
      s.account.available = str(d(s.account.available).plus(proceeds));
      s.ledger.push({
        id: `${fillId}:quote`,
        orderId: o.id,
        positionId: p.id,
        asset: 'USDT',
        availableDelta: str(proceeds),
        reservedDelta: '0',
        reason: 'SELL_NET_FEE',
        at,
      });
      s.ledger.push({
        id: `${fillId}:base`,
        orderId: o.id,
        positionId: p.id,
        asset: 'BTC',
        availableDelta: str(qty.neg()),
        reservedDelta: '0',
        reason: 'SELL',
        at,
      });
      if (d(p.quantity).eq(0)) {
        p.status = 'CLOSED';
        p.closedAt = at;
        p.exitReason = o.reason;
      } else p.status = d(o.filledQuantity).gte(o.quantity) && (d(p.quantity).lt(c.minQty) || d(p.quantity).mul(price).lt(c.minNotional)) ? 'DUST' : 'CLOSING';
    }
    o.status = d(o.filledQuantity).gte(o.quantity) ? 'FILLED' : 'PARTIALLY_FILLED';
    delete o.deferredReason;
    if(typeof liquidity!=='number')liquidity.used+=qty.toNumber();
    if (o.status === 'FILLED' && o.side === 'BUY') {
      const release = d(o.reservedQuote);
      s.account.available = str(d(s.account.available).plus(release));
      s.account.reserved = str(d(s.account.reserved).minus(release));
      o.reservedQuote = '0';
      s.ledger.push({
        id: `${o.id}:release`,
        orderId: o.id,
        positionId: p.id,
        asset: 'USDT',
        availableDelta: str(release),
        reservedDelta: str(release.neg()),
        reason: 'RELEASE',
        at,
      });
    }
    this.assertInvariants(s);
  }

  requestExit(
    s: AccountState,
    positionId: string,
    at: number,
    reason: string,
    type: 'MARKET' | 'LIMIT' | 'PROTECTION' = 'MARKET',
    limitPrice?: number,
  ): ExchangeOrder | undefined {
    if (type === 'LIMIT' && (!Number.isFinite(limitPrice) || Number(limitPrice) <= 0))
      throw new Error('INVALID_LIMIT_PRICE');
    const p = s.positions.find((x) => x.id === positionId);
    if (!p || !isPositionOpen(p) || d(p.quantity).lte(0)) return;
    const existing = s.orders.find(
      (o) => o.positionId === p.id && o.side === 'SELL' && isOrderOpen(o),
    );
    if (existing) return existing;
    for (const o of s.orders.filter(
      (o) => o.positionId === p.id && o.side === 'BUY' && isOrderOpen(o),
    ))
      this.cancel(s, o.id, at);
    if(floor(p.quantity,p.config.stepSize).lt(p.config.minQty)){p.status='DUST';return;}
    const id = `${p.id}:exit:${s.orders.filter((o) => o.positionId === p.id && o.side === 'SELL').length}`;
    const o: ExchangeOrder = {
      id,
      accountId: s.account.id,
      positionId: p.id,
      signalId: p.signalId,
      side: 'SELL',
      type,
      limitPrice: limitPrice ? str(d(limitPrice).div(p.config.tickSize).ceil().mul(p.config.tickSize)) : undefined,
      quantity: str(floor(p.quantity, p.config.stepSize)),
      filledQuantity: '0',
      reservedQuote: '0',
      status: 'PENDING',
      reason,
      createdAt: at,
    };
    s.orders.push(o);
    p.status = 'CLOSING';
    return o;
  }

  onCandle(s: AccountState, candle: Candle, invalidate = false, allowEntryFills: (positionId: string) => boolean = () => true, sharedBudget?:CausalLiquidityBudget): void {
    if (candle.timeframe !== '1m' || candle.closeTime <= s.account.lastCandleTime) return;
    s.account.lastCandleTime = candle.closeTime;
    const day = new Date(candle.closeTime).toISOString().slice(0, 10);
    if (s.account.day !== day) {
      s.account.day = day;
      s.account.dayPnl = '0';
      s.account.dayStartEquity = str(this.equity(s, candle.open));
    }
    const rate=s.positions.find(isPositionOpen)?.config.participationRate??DEFAULT_SIMULATION.participationRate;
    const used=s.fills.filter(f=>f.at>=candle.openTime&&f.at<=candle.closeTime).reduce((n,f)=>n+Number(f.quantity),0);
    const budget=sharedBudget??causalLiquidity(candle.openTime,s.account.lastLiquidityObservation,rate,used);
    for (const p of s.positions.filter(isPositionOpen)) {
      if (p.openedAt >= candle.closeTime) continue;
      if(d(p.quantity).gt(0)&&(!d(p.stopLoss).isFinite()||d(p.stopLoss).lte(0))){
        const exit=this.requestExit(s,p.id,candle.closeTime,'UNSAFE_PROTECTION','PROTECTION');
        if(exit)this.execute(s,exit.id,candle.close,candle.closeTime,budget,'CLOSE');
        continue;
      }
      // A previously submitted market entry eligible at the open exists before this bar's extremes.
      if (allowEntryFills(p.id) && !s.orders.some(o => o.positionId === p.id && o.side === 'SELL' && isOrderOpen(o))) {
        for (const order of s.orders.filter(o => o.positionId === p.id && o.side === 'BUY' && isOrderOpen(o) && o.createdAt <= candle.openTime)) {
          this.execute(s, order.id, candle.open, candle.openTime, budget,'OPEN');
        }
      }
      const sellPending = s.orders.find(
        (o) => o.positionId === p.id && o.side === 'SELL' && isOrderOpen(o),
      );
      const stopHit = d(p.quantity).gt(0) && candle.low <= Number(p.stopLoss);
      const takeHit = d(p.quantity).gt(0) && candle.high >= Number(p.takeProfit);
      let exit = sellPending;
      if (exit?.type === 'LIMIT' && stopHit) {
        this.cancel(s, exit.id, candle.closeTime);
        exit = undefined;
      }
      let price =
        sellPending && sellPending.createdAt > candle.openTime ? candle.close : candle.open;
      // Stop wins if OHLC cannot tell which boundary was touched first. Gaps use worse open.
      const openingTakesProfit = d(p.quantity).gt(0) && candle.open >= Number(p.takeProfit);
      if (!exit && openingTakesProfit) {
        exit = this.requestExit(s, p.id, candle.closeTime, 'TAKE_PROFIT', 'LIMIT', Number(p.takeProfit));
        price = Number(p.takeProfit);
      } else if (!exit && stopHit) {
        exit = this.requestExit(s, p.id, candle.closeTime, 'STOP_LOSS', 'PROTECTION');
        price = Math.min(candle.open, Number(p.stopLoss));
      } else if (!exit && takeHit) {
        exit = this.requestExit(
          s,
          p.id,
          candle.closeTime,
          'TAKE_PROFIT',
          'LIMIT',
          Number(p.takeProfit),
        );
        price = Number(p.takeProfit);
      } else if (!exit && ((invalidate && p.config.invalidationExit !== false) || (p.config.timeExit !== false && candle.closeTime - p.openedAt >= p.config.maxHoldingMs))) {
        exit = this.requestExit(
          s,
          p.id,
          candle.closeTime,
          invalidate && p.config.invalidationExit !== false ? 'INVALIDATION' : 'TIME_STOP',
        );
        price = candle.close;
      }
      if (exit) {
        if (exit.type === 'LIMIT')
          price = candle.high >= Number(exit.limitPrice) ? Number(exit.limitPrice) : candle.close;
        this.execute(s, exit.id, price, candle.closeTime, budget,exit.reason==='STOP_LOSS'||exit.reason==='TAKE_PROFIT'?'INTRABAR':'CLOSE');
      } else if (allowEntryFills(p.id)) {
        for (const o of s.orders.filter(
          (o) => o.positionId === p.id && o.side === 'BUY' && isOrderOpen(o) && o.createdAt > candle.openTime,
        )) {
          this.execute(s, o.id, candle.close, candle.closeTime, budget,'CLOSE');
        }
      }
      // Update trailing only AFTER evaluating this bar, so its high cannot protect an earlier low.
      if (p.config.trailing && p.status === 'OPEN') {
        p.highWater = str(Decimal.max(p.highWater, candle.close));
        if (d(p.highWater).gte(d(p.averageEntry).mul(1 + p.config.trailingActivation)))
          p.stopLoss = str(
            Decimal.max(p.stopLoss, d(p.highWater).minus(d(p.atr).mul(p.config.atrMultiplier))),
          );
      }
    }
    s.account.lastLiquidityObservation={openTime:candle.openTime,closeTime:candle.closeTime,volume:candle.volume};
    this.assertInvariants(s);
  }
  cancel(s: AccountState, orderId: string, at: number): void {
    const o = s.orders.find((x) => x.id === orderId);
    if (o) terminal(s, o, 'CANCELLED', at, 'CANCELLED');
    const p = o && s.positions.find((x) => x.id === o.positionId);
    if (p && o.side === 'SELL' && d(p.quantity).gt(0)) p.status = 'OPEN';
    this.assertInvariants(s);
  }
  equity(s: AccountState, price: number): Decimal {
    return d(s.account.available)
      .plus(s.account.reserved)
      .plus(s.positions.reduce((n, p) => n.plus(d(p.quantity).mul(price)), d(0)));
  }
  assertInvariants(s: AccountState): void {
    if (
      d(s.account.available).lt(-1e-9) ||
      d(s.account.reserved).lt(-1e-9) ||
      s.positions.some((p) => d(p.quantity).lt(0))
    )
      throw new Error('ACCOUNT_INVARIANT');
    const reserved = s.orders
      .filter((o) => o.side === 'BUY' && isOrderOpen(o))
      .reduce((n, o) => n.plus(o.reservedQuote), d(0));
    if (reserved.minus(s.account.reserved).abs().gt(1e-8)) throw new Error('RESERVATION_INVARIANT');
  }
}

/** Deliberately NOT a provider. Retained as a future integration boundary, with no SDK. */
export class BinanceSpotExecutionAdapter {
  execute(): never {
    throw new Error('LIVE_TRADING_COMPILED_OUT');
  }
  cancel(): never {
    throw new Error('LIVE_TRADING_COMPILED_OUT');
  }
}

export function newAccount(
  id: string,
  userId: string,
  capital = 500,
  maxPositions = 5,
  usdtPerTrade = 30,
): AccountState {
  return {
    account: {
      id,
      userId,
      initialCapital: str(capital),
      available: str(capital),
      reserved: '0',
      entriesEnabled: false,
      maxPositions,
      usdtPerTrade: str(usdtPerTrade),
      lastCandleTime: 0,
      day: '',
      dayStartEquity: str(capital),
      dayPnl: '0',
    },
    positions: [],
    orders: [],
    fills: [],
    ledger: [],
    decisions: [],
  };
}
