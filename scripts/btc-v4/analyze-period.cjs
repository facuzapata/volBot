// Detailed, read-only V4 result breakdown for a fixed historical period.
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
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start >= end)
  throw new Error('USAGE: node scripts/btc-v4/analyze-period.cjs --start YYYY-MM-DD --end YYYY-MM-DD');

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
  strategy: 'btc-v4', initialCapital: 500, maxPositions: 5, usdtPerTrade: 30,
}, Date.parse(`${start}T00:00:00Z`), Date.parse(`${end}T00:00:00Z`) - 1);
const closed = report.trades.filter((position) => position.status === 'CLOSED').map((position) => ({
  openedAt: new Date(position.openedAt).toISOString(),
  closedAt: new Date(position.closedAt).toISOString(),
  realizedPnl: Number(position.realizedPnl),
  exitReason: position.exitReason,
  entryPrice: position.entryPrice,
  exitPrice: position.exitPrice,
  stopLoss: position.stopLoss,
  takeProfit: position.takeProfit,
}));
const byExitReason = Object.fromEntries([...new Set(closed.map((position) => position.exitReason))].map((reason) => {
  const positions = closed.filter((position) => position.exitReason === reason);
  return [reason, {
    count: positions.length,
    netPnl: Number(positions.reduce((sum, position) => sum + position.realizedPnl, 0).toFixed(4)),
  }];
}));
console.log(JSON.stringify({
  strategy: 'btc-v4', start, end,
  metrics: report.metrics,
  exits: byExitReason,
  closedTrades: closed,
}, null, 2));
