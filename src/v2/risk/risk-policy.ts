import Decimal from 'decimal.js';
import {
  AccountState,
  ExchangeOrder,
  isPositionOpen,
  MarketSignal,
  Position,
} from '../domain/model';
const d = (n: Decimal.Value) => new Decimal(n);
const str = (n: Decimal.Value) => d(n).toFixed(12);
const floor = (n: Decimal.Value, step: Decimal.Value) => d(n).div(step).floor().mul(step);
/** Pure reservation policy; execution adapters do not decide risk. */
export class RiskPolicy {
  reserve(
    s: AccountState,
    signal: MarketSignal,
    at: number,
  ): { accepted: boolean; reason: string } {
    const decisionId = `${s.account.id}:${signal.id}`;
    const existing = s.decisions.find((x) => x.id === decisionId);
    if (existing) return { accepted: existing.accepted, reason: existing.reason };
    const c = signal.config;
    if (![signal.referencePrice,signal.atr,c.tickSize,c.stepSize].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(signal.swingLow)) {
      const reason='INVALID_SIGNAL_GEOMETRY';
      s.decisions.push({id:decisionId,accountId:s.account.id,signalId:signal.id,accepted:false,reason,at});
      return {accepted:false,reason};
    }
    const configuredBudget = d(s.account.usdtPerTrade);
    const open = s.positions.filter(isPositionOpen);
    const equity = d(s.account.available)
      .plus(s.account.reserved)
      .plus(s.positions.reduce((n, p) => n.plus(d(p.quantity).mul(signal.referencePrice)), d(0)));
    const today = new Date(at).toISOString().slice(0, 10);
    if (s.account.day !== today) {
      s.account.day = today;
      s.account.dayPnl = '0';
      s.account.dayStartEquity = str(equity);
    }
    const riskDistance =
      signal.protection
        ? (signal.referencePrice-signal.protection.stopPrice)/signal.referencePrice
        : signal.strategy === 'legacy-v1'
        ? 0.004
        : c.stopModel === 'ATR_ONLY'
          ? (signal.atr * c.atrMultiplier) / signal.referencePrice
          : Math.max(
              (signal.atr * c.atrMultiplier) / signal.referencePrice,
              (signal.referencePrice - signal.swingLow) / signal.referencePrice,
            );
    // V4 uses the configured ticket as a ceiling, never as permission to exceed the
    // account-level loss cap implied by its structural stop.
    const riskCostFraction = riskDistance + 2 * c.feeRate + (c.spreadBps + 2 * c.slippageBps) / 10000;
    const budget = signal.strategy === 'btc-v4' && riskCostFraction > 0
      ? Decimal.min(configuredBudget, equity.mul(c.maxRiskPerTrade).div(riskCostFraction))
      : configuredBudget;
    const exposure = open.reduce(
      (a, p) => a.plus(d(p.quantity).mul(signal.referencePrice)),
      d(s.account.reserved),
    );
    const consecutiveV4Stops = s.positions
      .filter((p) => p.strategy === 'btc-v4' && p.status === 'CLOSED' && (p.closedAt ?? 0) > (s.account.v4StopHaltAt ?? 0))
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      .findIndex((p) => p.exitReason !== 'STOP_LOSS');
    const v4StopStreak = consecutiveV4Stops === -1
      ? s.positions.filter((p) => p.strategy === 'btc-v4' && p.status === 'CLOSED').length
      : consecutiveV4Stops;
    const v4Halted = signal.strategy === 'btc-v4' && v4StopStreak >= (c.btcV4?.maxConsecutiveStopLosses ?? 3);
    let reason = 'ACCEPTED';
    if (v4Halted) {
      s.account.entriesEnabled = false;
      // Resuming entries is an explicit acknowledgement: only future stop exits
      // will count toward another automatic halt.
      s.account.v4StopHaltAt = at;
      reason = 'CONSECUTIVE_STOP_LOSS_HALT';
    }
    else if (!s.account.entriesEnabled) reason = 'ENTRIES_PAUSED';
    else if (at - signal.candleTime > c.signalMaxAgeMs || at < signal.candleTime)
      reason = 'STALE_SIGNAL';
    else if (open.some((p) => (!Number.isFinite(Number(p.stopLoss)) || d(p.stopLoss).lte(0)) && d(p.quantity).gt(0)))
      reason = 'UNPROTECTED_POSITION';
    else if (open.length >= s.account.maxPositions) reason = 'MAX_POSITIONS';
    else if (signal.strategy === 'btc-v4' && open.some((p) => p.strategy === 'btc-v4')) reason = 'MAX_V4_POSITION';
    else if (budget.lte(0) || budget.gt(s.account.available)) reason = 'INSUFFICIENT_BALANCE';
    else if (exposure.plus(budget).gt(equity.mul(c.maxExposure))) reason = 'MAX_EXPOSURE';
    else if (!Number.isFinite(riskDistance)||riskDistance <= 0 || riskDistance > c.maxStopPercent) reason = 'STOP_DISTANCE';
    else if(open.some(p=>Number(p.quantity)>0&&signal.referencePrice<Number(p.averageEntry)))reason='AVERAGING_DOWN_BLOCKED';
    else if (
      budget
        .mul(riskCostFraction)
        .gt(equity.mul(c.maxRiskPerTrade))
    )
      reason = 'TRADE_RISK';
    else if (
      equity
        .minus(s.account.dayStartEquity)
        .lte(d(s.account.dayStartEquity).mul(-c.dailyLossLimit)) ||
      d(s.account.dayPnl).lte(d(s.account.dayStartEquity).mul(-c.dailyLossLimit))
    )
      reason = 'DAILY_LOSS_LIMIT';
    const executablePrice = signal.referencePrice * (1 + (c.spreadBps / 2 + c.slippageBps) / 10000);
    const quoteFeeRate = c.buyCommissionAsset === 'BTC' ? 0 : c.feeRate;
    const qty = floor(budget.div(d(executablePrice).mul(1 + quoteFeeRate)), c.stepSize);
    if (reason === 'ACCEPTED' && (qty.lt(c.minQty) || qty.mul(executablePrice).lt(c.minNotional)))
      reason = 'FILTER_NOTIONAL';
    const accepted = reason === 'ACCEPTED';
    s.decisions.push({
      id: decisionId,
      signalId: signal.id,
      accountId: s.account.id,
      accepted,
      action:accepted?'BUY':'NO_TRADE',
      reason,
      at,
    });
    if (!accepted) return { accepted, reason };
    const id = `${decisionId}:position`;
    const p: Position = {
      id,
      accountId: s.account.id,
      signalId: signal.id,
      strategy: signal.strategy,
      executionMode: s.account.executionMode ?? 'PAPER',
      strategyRevision: signal.strategyRevision,
      protectionMode:signal.protection?'ABSOLUTE':'REANCHORED',
      plannedStop:signal.protection?str(signal.protection.stopPrice):undefined,
      plannedTarget:signal.protection?str(signal.protection.targetPrice):undefined,
      entryReferenceQuote:'0',
      signalReferencePrice:signal.referencePrice,
      forecast:signal.forecast,
      regime: signal.regime,
      status: 'OPENING',
      quantity: '0',
      entryQuantity: '0',
      entryGrossQuantity: '0',
      entryQuote: '0',
      entryFees: '0',
      remainingCost: '0',
      averageEntry: '0',
      realizedPnl: '0',
      stopLoss: '0',
      takeProfit: '0',
      highWater: '0',
      atr: str(signal.atr),
      openedAt: at,
      config: { ...c },
      stopDistance: riskDistance,
      targetDistance:signal.protection?(signal.protection.targetPrice/signal.referencePrice-1):signal.strategy === 'legacy-v1' ? 0.005 : c.takeProfit,
    };
    // Snapshot the risk distance: subsequent parameter changes never rewrite an open position.
    p.stopLoss = signal.protection
      ? str(signal.protection.stopPrice)
      : str(signal.referencePrice * (1 - riskDistance));
    p.takeProfit = signal.protection
      ? str(signal.protection.targetPrice)
      : str(signal.referencePrice * (1 + (signal.strategy === 'legacy-v1' ? 0.005 : c.takeProfit)));
    const o: ExchangeOrder = {
      id: `${id}:entry`,
      accountId: s.account.id,
      positionId: id,
      signalId: signal.id,
      side: 'BUY',
      type: 'MARKET',
      executionMode: p.executionMode,
      quantity: str(qty),
      status: 'PENDING',
      filledQuantity: '0',
      reservedQuote: str(budget),
      reason: 'ENTRY',
      createdAt: at,
    };
    s.account.available = str(d(s.account.available).minus(budget));
    s.account.reserved = str(d(s.account.reserved).plus(budget));
    s.positions.push(p);
    s.orders.push(o);
    s.ledger.push({
      id: `${o.id}:reserve`,
      orderId: o.id,
      positionId: id,
      asset: 'USDT',
      availableDelta: str(budget.neg()),
      reservedDelta: str(budget),
      reason: 'RESERVE',
      at,
    });
    return { accepted, reason };
  }
}
