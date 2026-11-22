// Offline V4 research. It never imports Nest providers, credentials, or exchange APIs.
// Development: 2024. Validation: 2025 Q1. Variants are declared before execution.
const { readFileSync } = require('fs');
const path = require('path');
const { BacktestingEngine } = require('../../dist/v2/backtesting/backtesting.engine');
const { DEFAULT_BTC_V4 } = require('../../dist/v2/strategy/btc-v4.config');

const root = path.resolve(__dirname, '../..');
const input = (year, month) =>
  JSON.parse(readFileSync(path.join(root, 'reports/net-optimization/data', `${year}-${String(month).padStart(2, '0')}.json`), 'utf8'));
const candles = [];
for (let month = 1; month <= 12; month++) candles.push(...input(2024, month));
for (let month = 1; month <= 3; month++) candles.push(...input(2025, month));

const variants = [
  { id: 'base-v4.1', parameters: {} },
  { id: 'balanced-2r', parameters: { minPullbackAtr: 0.4, maxPullbackAtr: 1.5, stopAtr5m: 2, targetRiskMultiple: 2, horizonMinutes: 720 } },
  { id: 'deep-2r', parameters: { minPullbackAtr: 0.8, maxPullbackAtr: 2.5, stopAtr5m: 2, targetRiskMultiple: 2, horizonMinutes: 720 } },
  { id: 'confirmed-1.5r', parameters: { trendSlopeHours: 6, minPullbackAtr: 0.5, maxPullbackAtr: 1.5, stopAtr5m: 2, targetRiskMultiple: 1.5, horizonMinutes: 720 } },
  { id: 'wide-stop-2r', parameters: { minPullbackAtr: 0.5, maxPullbackAtr: 2.5, stopAtr5m: 2.5, targetRiskMultiple: 2, horizonMinutes: 720 } },
  { id: 'conservative-2r', parameters: { trendSlopeHours: 6, minPullbackAtr: 0.8, maxPullbackAtr: 1.8, stopAtr5m: 2.5, targetRiskMultiple: 2, horizonMinutes: 720 } },
  { id: 'fast-target', parameters: { minPullbackAtr: 0.5, maxPullbackAtr: 1.8, stopAtr5m: 2, targetRiskMultiple: 1.25, horizonMinutes: 720 } },
  { id: 'trend-runner', parameters: { trendSlopeHours: 6, minPullbackAtr: 0.5, maxPullbackAtr: 1.8, stopAtr5m: 2.5, targetRiskMultiple: 2.5, horizonMinutes: 1440 } },
];

const period = (start, end) => {
  const report = new BacktestingEngine().run(
    candles,
    {
      strategy: 'btc-v4',
      initialCapital: 500,
      maxPositions: 5,
      usdtPerTrade: 30,
      config: { btcV4: undefined },
    },
    Date.parse(`${start}T00:00:00Z`),
    Date.parse(`${end}T00:00:00Z`) - 1,
  );
  return report;
};

const run = (parameters, start, end) => {
  const report = new BacktestingEngine().run(
    candles,
    {
      strategy: 'btc-v4',
      initialCapital: 500,
      maxPositions: 5,
      usdtPerTrade: 30,
      config: { btcV4: { ...DEFAULT_BTC_V4, ...parameters } },
    },
    Date.parse(`${start}T00:00:00Z`),
    Date.parse(`${end}T00:00:00Z`) - 1,
  );
  const closed = report.metrics.closedTrades;
  return {
    net: Number(report.metrics.netRealizedPnl.toFixed(4)),
    trades: closed,
    profitFactor: report.metrics.profitFactor === null ? null : Number(report.metrics.profitFactor.toFixed(3)),
    winRate: closed ? Number((report.metrics.winRate * 100).toFixed(1)) : 0,
    maxDrawdownPct: report.metrics.maxDrawdown === null ? null : Number((report.metrics.maxDrawdown * 100).toFixed(2)),
  };
};

const selected = process.env.BTC_V4_RESEARCH_VARIANT ? variants.filter((variant) => variant.id === process.env.BTC_V4_RESEARCH_VARIANT) : variants;
if (!selected.length) throw new Error('Unknown BTC_V4_RESEARCH_VARIANT');
const results = [];
for (const variant of selected) {
  process.stdout.write(`running ${variant.id}\n`);
  results.push({
    id: variant.id,
    development2024: run(variant.parameters, '2024-01-01', '2025-01-01'),
    validation2025Q1: run(variant.parameters, '2025-01-01', '2025-04-01'),
  });
}
console.log(JSON.stringify({ protocol: 'exploratory; select only by development, Q1 is validation and not for retuning', variants: results }, null, 2));
