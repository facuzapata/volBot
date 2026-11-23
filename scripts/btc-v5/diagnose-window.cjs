// Read-only replay of V5 entry filters; never submits orders or changes parameters.
require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BtcV5JumpStrategy } = require('../../src/v2/strategy/btc-v5-jump.strategy');
const { strategyConfiguration } = require('../../src/v2/strategy/versions');
const { BTC_V5_REVISION } = require('../../src/v2/strategy/btc-v5.config');
const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
async function main() {
  const start = Date.parse(arg('start')), end = Date.parse(arg('end'));
  if (!process.argv.includes('--start') || !process.argv.includes('--end') ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error('Use --start ISO_TIMESTAMP --end ISO_TIMESTAMP (exclusive) [--output directory]');
  const directory = path.resolve(process.argv.includes('--output') ? arg('output') : 'reports/btc-v5/event-window');
  fs.mkdirSync(directory, { recursive: true });
  async function load(timeframe, step, warmup) {
    const file = path.join(directory, `${timeframe}.json`);
    let raw;
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      raw = [];
      let cursor = Math.floor(start / step) * step - warmup * step;
      while (cursor < end) {
        const params = new URLSearchParams({ symbol: 'BTCUSDT', interval: timeframe,
          startTime: String(cursor), endTime: String(end - 1), limit: '1000' });
        const response = await fetch(`https://data-api.binance.vision/api/v3/klines?${params}`,
          { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`PUBLIC_HTTP_${response.status}`);
        const page = await response.json();
        if (!Array.isArray(page) || !page.length) break;
        raw.push(...page);
        cursor = Number(page.at(-1)[0]) + step;
      }
      fs.writeFileSync(file, JSON.stringify(raw));
    }
    const bars = raw.map(r => ({ symbol: 'BTCUSDT', timeframe, openTime: Number(r[0]),
      closeTime: Number(r[6]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]),
      close: Number(r[4]), volume: Number(r[5]) }));
    if (!bars.length || bars[0].openTime > start - warmup * step || bars.at(-1).closeTime < end - 1 ||
        bars.some((b, i) => b.openTime % step || b.closeTime !== b.openTime + step - 1 ||
          (i && b.openTime !== bars[i - 1].openTime + step) ||
          ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
          b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close)))
      throw new Error(`INCOMPLETE_OR_INVALID_HISTORY_${timeframe}`);
    return bars;
  }
  const [minutes, fives] = await Promise.all([load('1m', 60000, 100), load('5m', 300000, 320)]);
  const config = strategyConfiguration('btc-v5');
  const strategy = new BtcV5JumpStrategy();
  const rows = [];
  for (const bar of minutes.filter(b => b.openTime >= start && b.closeTime < end)) {
    const history = { '1m': minutes.filter(b => b.closeTime <= bar.closeTime).slice(-100),
      '5m': fives.filter(b => b.closeTime <= bar.closeTime).slice(-320), '1h': [] };
    const a = strategy.assess(history, config);
    rows.push({ openTime: new Date(bar.openTime).toISOString(), closeTime: new Date(bar.closeTime).toISOString(),
      open: bar.open, close: bar.close, high: bar.high, volume: bar.volume,
      decision: a.decision, reason: a.reason, conditions: a.conditions, features: a.features,
      failed: Object.keys(a.conditions).filter(k => !a.conditions[k]) });
  }
  const keys = [...new Set(rows.flatMap(row => Object.keys(row.conditions)))];
  const groups = { referenceRisk: ['referenceGeometry','referenceRewardRisk','targetRoom'],
    recovery: ['oversoldReclaim5m','recovery1m','recoveryQuality'],
    economics: ['costCoverage','referenceRewardRisk','targetRoom'] };
  const summary = { revision: BTC_V5_REVISION, start: new Date(start).toISOString(), endExclusive: new Date(end).toISOString(),
    note: 'Market eligibility only; default source configuration, not a production worker/account audit. Filter removals are diagnostic counts, not simulated trades or profits.',
    configuration: config, datasetHash: crypto.createHash('sha256').update(JSON.stringify({ minutes, fives })).digest('hex'),
    evaluatedMinutes: rows.length, eligibleMinutes: rows.filter(r => !r.failed.length).length,
    passCounts: Object.fromEntries(keys.map(k => [k, rows.filter(r => r.conditions[k]).length])),
    eligibleRemovingOnly: Object.fromEntries(keys.map(k => [k, rows.filter(r => r.failed.every(f => f === k)).length])),
    eligibleRemovingGroup: Object.fromEntries(Object.entries(groups).map(([k,v]) => [k, rows.filter(r => r.failed.every(f => v.includes(f))).length])),
    closest: [...rows].sort((a,b) => a.failed.length-b.failed.length).slice(0,15).map(r => ({time:r.openTime,close:r.close,failed:r.failed})),
    surge: rows.filter(r => r.openTime >= new Date(end-20*60000).toISOString()).map(r => ({ time:r.openTime,close:r.close,failed:r.failed,
      target:r.features?.targetPrice, atrFraction:r.features?.atrFraction })) };
  fs.writeFileSync(path.join(directory,'assessments.json'), JSON.stringify(rows,null,2));
  fs.writeFileSync(path.join(directory,'summary.json'), JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
