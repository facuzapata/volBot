// Frozen V5 qualification gate. It replays one revision; it never tunes it.
const fs = require('fs');
const path = require('path');
const { BacktestingEngine } = require('../../dist/v2/backtesting/backtesting.engine');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const asOf = arg('as-of', new Date().toISOString().slice(0, 10));
const output = arg('output', '');
const sourceDirs = [
  path.resolve(root, arg('data-dir', 'reports/btc-v4/data')),
  path.resolve(root, 'reports/net-optimization/data'),
];
const month = (date) => date.slice(0, 7);
const nextMonth = (value) => {
  const [year, mon] = value.split('-').map(Number);
  return `${mon === 12 ? year + 1 : year}-${String(mon === 12 ? 1 : mon + 1).padStart(2, '0')}`;
};
const loadMonth = (value) => {
  for (const directory of sourceDirs) {
    const file = path.join(directory, `${value}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  throw new Error(`MISSING_HISTORY_MONTH ${value}; run scripts/btc-v4/download-history.py first`);
};
// Start with December 2023 when available to warm the 4h/1h indicators before 2024.
const loadUntil = (lastExclusive) => {
  const bars = [];
  const [, , day = '01'] = lastExclusive.split('-');
  const lastMonth = day === '01' ? month(lastExclusive) : nextMonth(month(lastExclusive));
  for (let current = '2023-12'; current < lastMonth; current = nextMonth(current)) bars.push(...loadMonth(current));
  return bars;
};
const metrics = (report) => ({
  closedTrades: report.metrics.closedTrades,
  netUsdt: Number(report.metrics.netRealizedPnl.toFixed(4)),
  profitFactor: report.metrics.profitFactor === null ? null : Number(report.metrics.profitFactor.toFixed(3)),
  maxDrawdownPct: report.metrics.maxDrawdown === null ? null : Number((report.metrics.maxDrawdown * 100).toFixed(2)),
  winRatePct: Number((report.metrics.winRate * 100).toFixed(2)),
  totalCommissions: Number(report.metrics.totalCommissions.toFixed(4)),
});
const qualify = (label, start, end, minTrades) => {
  process.stderr.write(`[qualify] evaluating ${label}: ${start} to ${end}\n`);
  const report = new BacktestingEngine().run(loadUntil(end), {
    strategy: 'btc-v5', initialCapital: 500, maxPositions: 5, usdtPerTrade: 30,
  }, Date.parse(`${start}T00:00:00Z`), Date.parse(`${end}T00:00:00Z`) - 1);
  const result = metrics(report);
  const failed = [
    ...(result.netUsdt > 0 ? [] : ['NONPOSITIVE_NET']),
    ...(result.profitFactor === null || result.profitFactor >= 1.2 ? [] : ['PROFIT_FACTOR_BELOW_1_2']),
    ...(result.closedTrades >= minTrades ? [] : ['INSUFFICIENT_CLOSED_TRADES']),
    ...(result.maxDrawdownPct !== null && result.maxDrawdownPct <= 5 ? [] : ['MAX_DRAWDOWN_ABOVE_5_PCT']),
  ];
  return { label, start, end, minimumClosedTrades: minTrades, ...result, qualified: failed.length === 0, failed };
};

const result = {
  strategy: 'btc-v5',
  revision: require('../../dist/v2/strategy/btc-v5.config').BTC_V5_REVISION,
  protocol: 'Fixed V5 configuration; volume confirmation never changes size; simulator costs use defaults.',
  asOf,
  periods: [
    qualify('development-2024', '2024-01-01', '2025-01-01', 30),
    qualify('validation-2025', '2025-01-01', '2026-01-01', 30),
    qualify('final-2026-ytd', '2026-01-01', asOf, 20),
  ],
};
result.qualified = result.periods.every((period) => period.qualified);
result.decision = result.qualified ? 'REQUIRES_PAPER_OBSERVATION' : 'NOT_QUALIFIED';
if (output) {
  const file = path.resolve(root, output);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
