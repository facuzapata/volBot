// Read-only replay using the production V6 strategy; no orders or configuration changes.
require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BtcV6Strategy } = require('../../src/v2/strategy/btc-v6.strategy');
const { strategyConfiguration } = require('../../src/v2/strategy/versions');
const { BTC_V6_REVISION } = require('../../src/v2/strategy/btc-v6.config');
const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
};
async function main() {
  const start = Date.parse(arg('start')), end = Date.parse(arg('end'));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start % 60000 || end % 60000)
    throw new Error('Use --start ISO_TIMESTAMP --end ISO_TIMESTAMP (exclusive, minute aligned) [--output directory]');
  const directory = path.resolve(arg('output') || 'reports/btc-v6/event-window');
  fs.mkdirSync(directory, { recursive: true });
  async function load(timeframe, step, warmup) {
    const first = Math.floor(start / step) * step - warmup * step;
    const raw = [];
    let cursor = first;
    while (cursor < end) {
      const params = new URLSearchParams({ symbol: 'BTCUSDT', interval: timeframe,
        startTime: String(cursor), endTime: String(end - 1), limit: '1000' });
      const response = await fetch(`https://data-api.binance.vision/api/v3/klines?${params}`,
        { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`PUBLIC_HTTP_${response.status}`);
      const page = await response.json();
      if (!Array.isArray(page) || !page.length) break;
      if (Number(page.at(-1)[0]) < cursor) throw new Error('NON_ADVANCING_PAGE');
      raw.push(...page);
      cursor = Number(page.at(-1)[0]) + step;
    }
    const bars = raw.filter(r => Number(r[6]) < end && Number(r[6]) < Date.now()).map(r => ({
      symbol: 'BTCUSDT', timeframe, openTime: Number(r[0]), closeTime: Number(r[6]),
      open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]),
    }));
    if (!bars.length || bars[0].openTime !== first || bars.at(-1).openTime !== Math.floor(end / step) * step - step ||
      bars.some((b, i) => b.openTime % step || b.closeTime !== b.openTime + step - 1 ||
        (i && b.openTime !== bars[i - 1].openTime + step) ||
        ![b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
        Math.min(b.open, b.high, b.low, b.close) <= 0 || b.volume < 0 ||
        b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close)))
      throw new Error(`INCOMPLETE_OR_INVALID_HISTORY_${timeframe}`);
    fs.writeFileSync(path.join(directory, `${timeframe}.json`), JSON.stringify(raw));
    return bars;
  }
  const [minutes, fives] = await Promise.all([load('1m', 60000, 100), load('5m', 300000, 110)]);
  const config = strategyConfiguration('btc-v6');
  const strategy = new BtcV6Strategy();
  const rows = minutes.filter(b => b.openTime >= start && b.closeTime < end).map(bar => {
    const assessment = strategy.assess({
      '1m': minutes.filter(b => b.closeTime <= bar.closeTime).slice(-100),
      '5m': fives.filter(b => b.closeTime <= bar.closeTime).slice(-320), '1h': [],
    }, config);
    return { openTime: new Date(bar.openTime).toISOString(), closeTime: new Date(bar.closeTime).toISOString(),
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      decision: assessment.decision, reason: assessment.reason, conditions: assessment.conditions,
      features: assessment.features, failed: Object.keys(assessment.conditions).filter(k => !assessment.conditions[k]) };
  });
  if (rows.length !== (end - start) / 60000 || rows.some(r => r.reason.startsWith('MISSING_')))
    throw new Error('INCOMPLETE_ASSESSMENTS');
  const keys = Object.keys(rows[0].conditions);
  const summary = { revision: BTC_V6_REVISION, start: new Date(start).toISOString(), endExclusive: new Date(end).toISOString(),
    note: 'Market eligibility with source defaults; not an audit of deployed configuration, worker delivery, or account execution.',
    configuration: config, source: 'https://data-api.binance.vision/api/v3/klines',
    datasetHash: crypto.createHash('sha256').update(JSON.stringify({ minutes, fives })).digest('hex'),
    evaluatedMinutes: rows.length, eligibleMinutes: rows.filter(r => r.decision === 'BUY').length,
    passCounts: Object.fromEntries(keys.map(k => [k, rows.filter(r => r.conditions[k]).length])),
    eligibleRemovingOnly: Object.fromEntries(keys.map(k => [k, rows.filter(r => r.failed.every(f => f === k)).length])),
    eligible: rows.filter(r => r.decision === 'BUY'),
    closest: [...rows].sort((a, b) => a.failed.length - b.failed.length).slice(0, 12),
    breakouts: rows.filter(r => r.conditions.shortBreakout),
    strongestImpulses: [...rows].sort((a, b) => b.features.impulseAtr - a.features.impulseAtr).slice(0, 8),
  };
  fs.writeFileSync(path.join(directory, 'assessments.json'), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
