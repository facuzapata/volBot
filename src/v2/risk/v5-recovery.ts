import Decimal from 'decimal.js';
import { AccountState } from '../domain/model';
import { DEFAULT_BTC_V5 } from '../strategy/btc-v5.config';

/** Realized drawdown from V5's realized P&L peak, not a sizing or price prediction rule. */
export function v5RecoverySummary(state: AccountState) {
  const closed = state.positions
    .filter((p) => p.strategy === 'btc-v5' && p.status === 'CLOSED' && Number(p.entryQuantity) > 0)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0) || a.id.localeCompare(b.id));
  let net = new Decimal(0);
  let peak = new Decimal(0);
  for (const position of closed) {
    const pnl = new Decimal(position.realizedPnl);
    if (!pnl.isFinite()) throw new Error('INVALID_V5_REALIZED_PNL');
    net = net.plus(pnl);
    peak = Decimal.max(peak, net);
  }
  const outstanding = peak.minus(net);
  const minimumCycleProfit = new Decimal(state.account.usdtPerTrade).mul(
    DEFAULT_BTC_V5.minNetTargetFraction,
  );
  return {
    closedTrades: closed.length,
    netRealizedUSDT: net.toNumber(),
    unrecoveredLossUSDT: outstanding.toNumber(),
    minimumCycleProfitUSDT: minimumCycleProfit.toNumber(),
    recoveryGoalUSDT: outstanding.plus(minimumCycleProfit).toNumber(),
  };
}
