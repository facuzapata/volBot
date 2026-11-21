// Local HTTP smoke check. Secrets are read from ignored files and never printed.
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
async function main() {
  const env = dotenv.parse(fs.readFileSync('.env.v2'));
  const base = `http://127.0.0.1:${env.V2_API_PORT || 3100}/api`;
  const call = async (path, method = 'GET', body, token) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const admin = await call('/auth/login', 'POST', { email: env.V2_ADMIN_EMAIL, password: env.V2_ADMIN_PASSWORD });
  assert(admin.status === 200 && admin.data.accessToken, 'Admin login failed'); const token = admin.data.accessToken;
  fs.mkdirSync('reports', { recursive: true });
  const file = 'reports/smoke-credentials.json';
  const users = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [
    { email: 'paper-a@example.com', name: 'Paper A', password: crypto.randomBytes(24).toString('hex'), initialCapital: 500, maxPositions: 5, usdtPerTrade: 30 },
    { email: 'paper-b@example.com', name: 'Paper B', password: crypto.randomBytes(24).toString('hex'), initialCapital: 200, maxPositions: 3, usdtPerTrade: 20 },
  ];
  fs.writeFileSync(file, JSON.stringify(users, null, 2));
  const userTokens = [];
  for (const u of users) {
    const created = await call('/admin/users', 'POST', u, token); assert([201, 409].includes(created.status), 'Create user failed');
    const login = await call('/auth/login', 'POST', { email: u.email, password: u.password }); assert(login.status === 200, 'User login failed');
    const userToken = login.data.accessToken;
    userTokens.push(userToken);
    assert((await call('/admin/users', 'GET', undefined, userToken)).status === 403, 'Admin isolation failed');
    assert((await call('/me/config', 'PATCH', { role: 'admin' }, userToken)).status === 400, 'Mass assignment was accepted');
    const balance = await call('/me/balance', 'GET', undefined, userToken); assert(balance.status === 200 && balance.data.mode === 'PAPER', 'Paper balance failed');
    const enabled = await call('/me/entries', 'PATCH', { enabled: true }, userToken); assert(enabled.status === 409, 'Unapproved strategy admitted PAPER entries');
    assert((await call('/me/entries', 'PATCH', { enabled: false }, userToken)).status === 200, 'Persistent PAPER pause failed');
    assert(!JSON.stringify(login.data.user).match(/passwordHash|apiSecret|credentials/), 'Secret in user response');
  }
  const contract = await call('/docs-json'); assert(contract.status === 200 && contract.data.paths['/api/backtests'], 'OpenAPI failed');
  const health = await call('/health/ready'); assert(health.status === 200, 'Pipeline not ready');
  const market = await call('/market/status', 'GET', undefined, token); assert(market.status === 200 && market.data.latestPrice > 0, 'Live market price unavailable');
  const candles = await call('/market/candles?timeframe=1m&limit=5', 'GET', undefined, token); assert(candles.status === 200 && candles.data.items.length > 0, 'Closed candle history unavailable');
  const strategies = await call('/strategies', 'GET', undefined, token); assert(strategies.status === 200 && strategies.data.some(s => s.active && s.lastEvaluationAt > Date.now() - 180000), 'No fresh strategy evaluation persisted');
  const signalPage = await call('/signals', 'GET', undefined, token);
  let apiBacktest = null;
  if (fs.existsSync('reports/btcusdt-1m.json')) {
    const candles = JSON.parse(fs.readFileSync('reports/btcusdt-1m.json', 'utf8'));
    const result = await call('/backtests', 'POST', { strategy: 'btc-v2', initialCapital: 500, maxPositions: 5, usdtPerTrade: 30, candles }, userTokens[0]);
    assert(result.status === 201 && result.data.report.datasetHash, 'Persisted HTTP backtest failed');
    assert((await call(`/backtests/${result.data.id}`, 'GET', undefined, userTokens[0])).status === 200, 'Backtest recovery failed');
    assert((await call(`/backtests/${result.data.id}`, 'GET', undefined, userTokens[1])).status === 404, 'Backtest ownership isolation failed');
    const cli = JSON.parse(fs.readFileSync('reports/btc-v2-report.json', 'utf8'));
    assert(result.data.report.datasetHash === cli.datasetHash && Math.abs(result.data.report.metrics.netRealizedPnl - cli.metrics.netRealizedPnl) < 1e-8, 'CLI/API backtest divergence');
    apiBacktest = { id: result.data.id, datasetHash: result.data.report.datasetHash, netPnl: result.data.report.metrics.netRealizedPnl };
  }
  const report = { checkedAt: new Date().toISOString(), mode: 'PAPER', usersChecked: users.length,
    checks: ['admin login', 'user creation', 'separate balances', 'role authorization', 'mass-assignment rejection', 'unapproved entry rejection', 'persistent PAPER pause', 'secret-free responses', 'Swagger JSON', 'pipeline readiness', 'public market price', 'closed candle history', 'persisted strategy evaluation'],
    health: health.data, signals: signalPage.data.total, latestPublicPrice: market.data.latestPrice, apiBacktest };
  fs.writeFileSync('reports/smoke.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
