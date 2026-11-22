// Read-only V5 trade attribution for a fixed historical period.
const fs = require('fs');
const path = require('path');
const { BacktestingEngine } = require('../../dist/v2/backtesting/backtesting.engine');

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? '' : args[index + 1];
};
const start = arg('start');
const end = arg('end');
const output = arg('output');
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start >= end)
  throw new Error('USAGE: node scripts/btc-v5/analyze-period.cjs --start YYYY-MM-DD --end YYYY-MM-DD [--output file]');

const root = path.resolve(__dirname, '../..');
const directories = [path.join(root, 'reports/btc-v4/data'), path.join(root, 'reports/net-optimization/data')];
const previousMonth = (value) => {
  const [year, month] = value.split('-').map(Number);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`;
};
const nextMonth = (value) => {
  const [year, month] = value.split('-').map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
};
const firstMonth = previousMonth(start.slice(0, 7));
const lastMonthExclusive = end.slice(8) === '01' ? end.slice(0, 7) : nextMonth(end.slice(0, 7));
const candles = [];
for (let current = firstMonth; current < lastMonthExclusive; current = nextMonth(current)) {
  const file = directories.map((directory) => path.join(directory, `${current}.json`)).find(fs.existsSync);
  if (!file) throw new Error(`MISSING_HISTORY_MONTH ${current}`);
  candles.push(...JSON.parse(fs.readFileSync(file, 'utf8')));
}

const report = new BacktestingEngine().run(candles, {
  strategy: 'btc-v5', initialCapital: 500, maxPositions: 5, usdtPerTrade: 30,
}, Date.parse(`${start}T00:00:00Z`), Date.parse(`${end}T00:00:00Z`) - 1);
const round = (value) => Number(value.toFixed(4));
const closed = report.trades.filter((position) => position.status === 'CLOSED').map((position) => {
  const entry = Number(position.averageEntry);
  const stop = Number(position.stopLoss);
  const target = Number(position.takeProfit);
  const life = candles.filter((candle) => candle.openTime >= position.openedAt && candle.closeTime <= position.closedAt);
  const afterExit = position.exitReason === 'STOP_LOSS'
    ? candles.filter((candle) => candle.openTime > position.closedAt && candle.openTime < position.closedAt + 72 * 3600000)
    : [];
  const maxHigh = life.length ? Math.max(...life.map((candle) => candle.high)) : entry;
  const minLow = life.length ? Math.min(...life.map((candle) => candle.low)) : entry;
  const postStopHigh = afterExit.length ? Math.max(...afterExit.map((candle) => candle.high)) : null;
  const postStopLow = afterExit.length ? Math.min(...afterExit.map((candle) => candle.low)) : null;
  return {
    openedAt: new Date(position.openedAt).toISOString(),
    closedAt: new Date(position.closedAt).toISOString(),
    month: new Date(position.closedAt).toISOString().slice(0, 7),
    realizedPnl: Number(position.realizedPnl),
    exitReason: position.exitReason,
    averageEntry: entry,
    stopLoss: stop,
    takeProfit: target,
    plannedRewardRisk: entry > stop ? round((target - entry) / (entry - stop)) : null,
    holdingHours: round((position.closedAt - position.openedAt) / 3600000),
    maxFavorableExcursionPct: round((maxHigh / entry - 1) * 100),
    maxAdverseExcursionPct: round((minLow / entry - 1) * 100),
    postStopTargetReachedWithin72h: postStopHigh === null ? null : postStopHigh >= target,
    postStopFurtherDrawdownPct: postStopLow === null ? null : round((postStopLow / stop - 1) * 100),
  };
});
const summarize = (positions) => ({
  count: positions.length,
  netPnl: round(positions.reduce((sum, position) => sum + position.realizedPnl, 0)),
  wins: positions.filter((position) => position.realizedPnl > 0).length,
  losses: positions.filter((position) => position.realizedPnl < 0).length,
  averageHoldingHours: positions.length ? round(positions.reduce((sum, position) => sum + position.holdingHours, 0) / positions.length) : 0,
});
const groupBy = (key) => Object.fromEntries([...new Set(closed.map((position) => position[key]))].sort().map((value) => [value, summarize(closed.filter((position) => position[key] === value))]));
const decisionReasons = Object.fromEntries([...new Set(report.decisions.map((decision) => decision.reason))].sort().map((reason) => [reason, report.decisions.filter((decision) => decision.reason === reason).length]));
const stopped = closed.filter((position) => position.exitReason === 'STOP_LOSS');
const stopFollowThrough = {
  stoppedTrades: stopped.length,
  targetReachedWithin72h: stopped.filter((position) => position.postStopTargetReachedWithin72h).length,
  averageMfeBeforeStopPct: stopped.length ? round(stopped.reduce((sum, position) => sum + position.maxFavorableExcursionPct, 0) / stopped.length) : 0,
  averageFurtherDrawdownAfterStopPct: stopped.length ? round(stopped.reduce((sum, position) => sum + (position.postStopFurtherDrawdownPct ?? 0), 0) / stopped.length) : 0,
};
// Reconcile quote cash flows independently of the position P&L accumulator.
// The default V5 replay charges both commissions in USDT; reject unsupported
// fee modes instead of silently treating a BTC commission as quote currency.
if (report.fills.some(fill => fill.commissionAsset !== 'USDT'))
  throw new Error('AUDIT_REQUIRES_USDT_COMMISSIONS');
const fillNet = report.fills.reduce((sum, fill) => sum +
  (fill.side === 'SELL' ? Number(fill.quote) : -Number(fill.quote)) - Number(fill.commission), 0);
const ledgerNet = report.ledger.filter(entry => entry.asset === 'USDT').reduce((sum, entry) =>
  sum + Number(entry.availableDelta) + Number(entry.reservedDelta), 0);
const balanceNet = Number(report.balance.available) + Number(report.balance.reserved) - Number(report.balance.initialCapital);
const closedPnl = closed.reduce((sum, position) => sum + position.realizedPnl, 0);
const fullyFlat = report.trades.every(position => Number(position.quantity) === 0) && Number(report.balance.reserved) === 0;
const differences = {
  fillsVsLedger: fillNet - ledgerNet,
  fillsVsCash: fillNet - balanceNet,
  ...(fullyFlat ? { fillsVsClosedPnl: fillNet - closedPnl } : {}),
};
const accountingAudit = {
  fullyFlat, quoteCashFlowNet: fillNet, ledgerNet, balanceNet, closedPnl, differences,
  reconciled: Object.values(differences).every(value => Math.abs(value) < 1e-8),
  sameExecutedTradesBeforeCommissions: fillNet + report.metrics.totalCommissions,
  // This arithmetic attribution is not a counterfactual zero-fee backtest.
  attributionPolicy: 'Add back commissions to the same executed trades; keep their fills, spread and slippage unchanged.',
};
if (!accountingAudit.reconciled) throw new Error('AUDIT_ACCOUNTING_MISMATCH');
const result = {
  strategy: 'btc-v5', revision: report.strategyRevision, datasetHash: report.datasetHash,
  start, end, metrics: report.metrics, accountingAudit,
  exits: groupBy('exitReason'), stopFollowThrough,
  monthly: groupBy('month'),
  decisionReasons,
  closedTrades: closed,
};
if (output) {
  const file = path.resolve(root, output);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
