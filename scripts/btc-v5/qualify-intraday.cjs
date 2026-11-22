// Fixed V5 intraday replay. No parameter search and no automatic strategy activation.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { BacktestingEngine } = require('../../dist/v2/backtesting/backtesting.engine');
const { StrategyEngine } = require('../../dist/v2/strategy/strategy-engine');
const { strategyConfiguration } = require('../../dist/v2/strategy/versions');
const { BTC_V5_REVISION, DEFAULT_BTC_V5 } = require('../../dist/v2/strategy/btc-v5.config');
const { configurationHash } = require('../../dist/v2/strategy/approval.service');
const { executionPrice, floorStep } = require('../../dist/v2/execution/pricing');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const arg = (key, fallback) =>
  args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const asOf = arg('as-of', '2026-11-22');
const selectedCase = arg('case', 'all');
const exitMode = arg('exit-mode', DEFAULT_BTC_V5.exitMode);
const trendMinutes = Number(arg('trend-minutes', String(DEFAULT_BTC_V5.trendMinutes)));
if (![15, 60].includes(trendMinutes)) throw new Error('INVALID_TREND_PERIOD');
if (!['STOP_TARGET', 'TARGET_ONLY'].includes(exitMode)) throw new Error('INVALID_EXIT_MODE');
if (
  ![
    'all',
    'retrospective-2024',
    'retrospective-2025',
    'retrospective-2026-ytd',
    'cost-stress-2026-ytd',
  ].includes(selectedCase)
)
  throw new Error('INVALID_CASE');
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(`${asOf}T00:00:00Z`)))
  throw new Error('INVALID_AS_OF');
const output = path.resolve(
  root,
  arg(
    'output',
    `reports/btc-v5/qualification-${BTC_V5_REVISION.split('.').slice(1).join('.')}-${exitMode.toLowerCase().replace('_', '-')}-${trendMinutes}m.json`,
  ),
);
const dirs = [
  path.resolve(root, arg('data-dir', 'reports/btc-v4/data')),
  path.resolve(root, 'reports/net-optimization/data'),
];
const day = 86400000;
const round = (n) => Number(n.toFixed(6));
const load = (start, end) => {
  const from = Date.parse(`${start}T00:00:00Z`) - 7 * day;
  const until = Date.parse(`${end}T00:00:00Z`);
  const bars = [];
  const cursor = new Date(from);
  cursor.setUTCDate(1);
  while (cursor.getTime() < until) {
    const month = cursor.toISOString().slice(0, 7);
    const file = dirs.map((dir) => path.join(dir, `${month}.json`)).find(fs.existsSync);
    if (!file) throw new Error(`MISSING_HISTORY_MONTH ${month}`);
    for (const bar of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (bar.openTime >= from && bar.closeTime < until) bars.push(bar);
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  if (!bars.length || bars[0].openTime !== from || bars.at(-1).closeTime !== until - 1)
    throw new Error('INCOMPLETE_HISTORY');
  return bars;
};
const evaluate = (label, start, end, stress = false) => {
  process.stderr.write(`[qualify] ${label}: ${start} to ${end}\n`);
  const config = strategyConfiguration('btc-v5', {
    ...(stress ? { feeRate: 0.0015, spreadBps: 4, slippageBps: 6 } : {}),
    btcV5: { ...DEFAULT_BTC_V5, exitMode, trendMinutes },
  });
  let progressMonth = '';
  let eligibleSignalMinutes = 0;
  class ProgressStrategy extends StrategyEngine {
    evaluate(history, strategy, settings) {
      const month = new Date(history['1m'].at(-1).openTime).toISOString().slice(0, 7);
      if (month !== progressMonth) {
        progressMonth = month;
        process.stderr.write(`[replay] ${label} ${month}\n`);
      }
      const signal = super.evaluate(history, strategy, settings);
      const at = history['1m'].at(-1).closeTime;
      if (signal && at >= Date.parse(`${start}T00:00:00Z`) && at < Date.parse(`${end}T00:00:00Z`))
        eligibleSignalMinutes++;
      return signal;
    }
  }
  const candles = load(start, end);
  const report = new BacktestingEngine(new ProgressStrategy()).run(
    candles,
    {
      strategy: 'btc-v5',
      initialCapital: 500,
      maxPositions: 1,
      usdtPerTrade: 30,
      config,
    },
    Date.parse(`${start}T00:00:00Z`),
    Date.parse(`${end}T00:00:00Z`) - 1,
  );
  const closed = report.trades.filter((p) => p.status === 'CLOSED');
  const days = (Date.parse(end) - Date.parse(start)) / day;
  const monthly = {};
  const exits = {};
  for (const p of closed) {
    const month = new Date(p.closedAt).toISOString().slice(0, 7);
    monthly[month] ??= { closedTrades: 0, netUsdt: 0 };
    monthly[month].closedTrades++;
    monthly[month].netUsdt += Number(p.realizedPnl);
    exits[p.exitReason] = (exits[p.exitReason] ?? 0) + 1;
  }
  for (const row of Object.values(monthly)) row.netUsdt = round(row.netUsdt);
  const m = report.metrics;
  const last = candles.at(-1);
  const openInventory = report.trades.filter((p) => Number(p.quantity) > 0);
  let liquidationValue = Number(report.balance.available) + Number(report.balance.reserved);
  let untradeableMarkedValue = 0;
  const openPositionDetails = openInventory.map((p) => {
    const quantity = Number(p.quantity);
    const price = executionPrice(last.close, 'SELL', p.config);
    const sellQty = floorStep(p.quantity, p.config.stepSize);
    const tradable = sellQty.gte(p.config.minQty) && sellQty.mul(price).gte(p.config.minNotional);
    const netExitValue = tradable
      ? sellQty
          .mul(price)
          .mul(1 - p.config.feeRate)
          .toNumber()
      : 0;
    liquidationValue += netExitValue;
    untradeableMarkedValue += (quantity - (tradable ? sellQty.toNumber() : 0)) * last.close;
    return {
      openedAt: new Date(p.openedAt).toISOString(),
      holdingDays: round((last.closeTime - p.openedAt) / day),
      quantity,
      averageEntry: Number(p.averageEntry),
      target: Number(p.takeProfit),
      exitMode: p.protectionMode,
      costUSDT: Number(p.remainingCost),
      markedValueUSDT: round(quantity * last.close),
      estimatedNetExitValueUSDT: round(netExitValue),
      unrealizedUSDT: round(quantity * last.close - Number(p.remainingCost)),
    };
  });
  const markToMarketNet = m.netRealizedPnl + m.unrealizedPnl;
  const netAfterEstimatedLiquidation = liquidationValue - Number(report.balance.initialCapital);
  const fillCashFlow = report.fills.reduce(
    (sum, f) =>
      sum +
      (f.side === 'BUY' ? -Number(f.quote) : Number(f.quote)) -
      (f.commissionAsset === 'USDT' ? Number(f.commission) : 0),
    0,
  );
  const cashDifference =
    Number(report.balance.available) +
    Number(report.balance.reserved) -
    Number(report.balance.initialCapital) -
    fillCashFlow;
  const markedEquity =
    Number(report.balance.available) +
    Number(report.balance.reserved) +
    openInventory.reduce((sum, p) => sum + Number(p.quantity) * last.close, 0);
  const accountingReconciled =
    Math.abs(cashDifference) < 1e-8 && Math.abs(markedEquity - m.equity) < 1e-8;
  const riskBreaches = report.trades.filter(
    (p) =>
      p.executionRisk?.accepted &&
      Number(p.executionRisk.estimatedNetStopLoss) > Number(p.executionRisk.riskLimitQuote) + 1e-9,
  ).length;
  const minTrades = Math.ceil(days / 2);
  const failed = [
    ...(netAfterEstimatedLiquidation > 0 ? [] : ['NONPOSITIVE_NET_AFTER_ESTIMATED_LIQUIDATION']),
    ...(m.profitFactor !== null && m.profitFactor >= 1.2
      ? []
      : ['PROFIT_FACTOR_BELOW_1_2_OR_UNDEFINED']),
    ...(m.closedTrades >= minTrades ? [] : ['INSUFFICIENT_CLOSED_TRADES']),
    ...(m.maxDrawdown !== null && m.maxDrawdown <= 0.03 ? [] : ['MAX_DRAWDOWN_ABOVE_3_PCT']),
    ...(riskBreaches === 0 ? [] : ['EXECUTION_RISK_BREACH']),
    ...(accountingReconciled ? [] : ['ACCOUNTING_MISMATCH']),
  ];
  const decisionReasons = {};
  for (const d of report.decisions)
    decisionReasons[d.reason] = (decisionReasons[d.reason] ?? 0) + 1;
  const result = {
    label,
    start,
    endExclusive: end,
    datasetHash: report.datasetHash,
    configurationHash: configurationHash('btc-v5', BTC_V5_REVISION, config),
    config,
    closedTrades: m.closedTrades,
    eligibleSignalMinutes,
    buyAttempts: report.decisions.length,
    openPositions: m.openPositions,
    minimumClosedTrades: minTrades,
    tradesPerDay: round(m.closedTrades / days),
    netUsdt: round(m.netRealizedPnl),
    unrealizedUsdt: round(m.unrealizedPnl),
    markToMarketNetUSDT: round(markToMarketNet),
    estimatedNetAfterLiquidationUSDT: round(netAfterEstimatedLiquidation),
    equityUSDT: round(m.equity),
    estimatedLiquidatableEquityUSDT: round(liquidationValue),
    availableUSDT: round(Number(report.balance.available)),
    reservedUSDT: round(Number(report.balance.reserved)),
    occupiedCapitalUSDT: round(m.immobilizedCapital),
    untradeableMarkedValueUSDT: round(untradeableMarkedValue),
    openPositionDetails,
    accountingAudit: {
      reconciled: accountingReconciled,
      quoteCashFlowNetUSDT: round(fillCashFlow),
      cashDifference,
    },
    riskPolicy: {
      trendMinutes: config.btcV5.trendMinutes,
      exitMode: config.btcV5.exitMode,
      lossModel: config.btcV5.exitMode === 'TARGET_ONLY' ? 'FULL_NOTIONAL' : 'STOP_DISTANCE',
      stopRiskBudgetApplies: config.btcV5.exitMode !== 'TARGET_ONLY',
      maxExposure: config.maxExposure,
      automaticTimeExit: config.timeExit,
    },
    profitFactor: m.profitFactor === null ? null : round(m.profitFactor),
    winRatePct: round(m.winRate * 100),
    maxDrawdownPct: m.maxDrawdown === null ? null : round(m.maxDrawdown * 100),
    averageHoldingMinutes: round(m.averageHoldingMs / 60000),
    totalCommissions: round(m.totalCommissions),
    recovery: m.v5Recovery,
    riskBreaches,
    maxSimultaneous: m.maxSimultaneous,
    exits,
    monthly,
    decisionReasons,
    qualified: failed.length === 0,
    failed,
  };
  process.stderr.write(
    `[qualify] ${label}: ${m.closedTrades} closed, net ${result.netUsdt}, PF ${result.profitFactor}\n`,
  );
  return result;
};
const result = {
  strategy: 'btc-v5',
  revision: BTC_V5_REVISION,
  exitMode,
  trendMinutes,
  asOf,
  protocol: `Fixed ${BTC_V5_REVISION} intraday hypothesis. All historical periods were previously inspected; these are retrospective checks, not untouched out-of-sample evidence. Costs included. No parameter search. No forced final liquidation. A pass requires prospective PAPER observation.`,
  periods: [],
  complete: false,
  qualified: false,
  decision: 'NOT_QUALIFIED',
  sourceSha256: Object.fromEntries(
    [
      'src/v2/strategy/btc-v5.config.ts',
      'src/v2/strategy/btc-v5.strategy.ts',
      'src/v2/strategy/fifteen-minute-bars.ts',
      'src/v2/market/market-data.service.ts',
      'src/v2/strategy/versions.ts',
      'src/v2/risk/risk-policy.ts',
      'src/v2/risk/execution-risk.ts',
      'src/v2/domain/model.ts',
      'src/v2/execution/paper-execution.adapter.ts',
      'src/v2/risk/v5-recovery.ts',
      'src/v2/strategy/signal-cadence.ts',
      'src/v2/trading/trading.services.ts',
      'src/v2/backtesting/backtesting.engine.ts',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
    ]),
  ),
};
const persist = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
};
for (const [label, start, end, stress] of [
  ['retrospective-2024', '2024-01-01', '2025-01-01', false],
  ['retrospective-2025', '2025-01-01', '2026-01-01', false],
  ['retrospective-2026-ytd', '2026-01-01', asOf, false],
  ['cost-stress-2026-ytd', '2026-01-01', asOf, true],
]) {
  if ((selectedCase !== 'all' && selectedCase !== label) || Date.parse(end) <= Date.parse(start))
    continue;
  result.periods.push(evaluate(label, start, end, stress));
  persist();
}
result.complete = result.periods.length === 4;
result.qualified = result.complete && result.periods.every((p) => p.qualified);
result.decision = result.qualified ? 'REQUIRES_PAPER_OBSERVATION' : 'NOT_QUALIFIED';
persist();
console.log(
  JSON.stringify(
    {
      revision: result.revision,
      decision: result.decision,
      periods: result.periods.map(
        ({ label, closedTrades, tradesPerDay, netUsdt, profitFactor, failed }) => ({
          label,
          closedTrades,
          tradesPerDay,
          netUsdt,
          profitFactor,
          failed,
        }),
      ),
      output,
    },
    null,
    2,
  ),
);
