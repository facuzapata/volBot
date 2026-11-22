import { SimulationConfig, DEFAULT_SIMULATION, StrategyId } from './domain/model';
import { strategyConfiguration } from './strategy/versions';
import { DEFAULT_BTC_V3 } from './strategy/btc-v3.config';
import { validV3Parameters } from './strategy/btc-v3.strategy';

export function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid configuration: ${name}`);
  return value;
}
export function refreshTokenTtlDays(): number {
  return numberEnv('V2_REFRESH_TOKEN_TTL_DAYS', 7, 1, 30);
}
/** Production exchange orders require an explicit deployment-level circuit breaker. */
export function liveTradingEnabled(): boolean {
  return process.env.V2_LIVE_TRADING_ENABLED === 'true';
}
export function databaseUrl(): string {
  const url = process.env.V2_DATABASE_URL;
  if (!url) throw new Error('V2_DATABASE_URL is required; use a dedicated database');
  const parsed = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !/^\/volbot_v2(?:_[a-z0-9]+)*$/.test(parsed.pathname)
  )
    throw new Error('V2_DATABASE_URL must point to a dedicated volbot_v2 database');
  return url;
}
export function simulationConfig(): SimulationConfig {
  if (process.env.TRADING_MODE && process.env.TRADING_MODE !== 'PAPER')
    throw new Error('Only PAPER is supported');
  const c = { ...DEFAULT_SIMULATION };
  c.feeRate = numberEnv('V2_FEE_RATE', c.feeRate, 0, 0.01);
  c.spreadBps = numberEnv('V2_SPREAD_BPS', c.spreadBps, 0, 100);
  c.slippageBps = numberEnv('V2_SLIPPAGE_BPS', c.slippageBps, 0, 100);
  c.participationRate = numberEnv('V2_PARTICIPATION_RATE', c.participationRate, 0.000001, 0.1);
  c.takeProfit = numberEnv('V2_TAKE_PROFIT', c.takeProfit, 0.001, 0.05);
  c.atrMultiplier = numberEnv('V2_ATR_MULTIPLIER', c.atrMultiplier, 0.5, 5);
  c.maxHoldingMs = numberEnv('V2_MAX_HOLDING_HOURS', 24, 1, 168) * 3600000;
  c.trailing = process.env.V2_TRAILING === 'true';
  c.maxRiskPerTrade=numberEnv('V2_MAX_RISK_PER_TRADE',c.maxRiskPerTrade,.000001,.1);
  if(selectedStrategy()==='btc-v3'){
    const overrides=JSON.parse(process.env.V3_PARAMETERS_JSON??'{}') as object;
    const p={...DEFAULT_BTC_V3,...overrides};
    if(!Object.keys(overrides).every(k=>Object.hasOwn(DEFAULT_BTC_V3,k))||!validV3Parameters(p))throw new Error('INVALID_V3_PARAMETERS');
    return strategyConfiguration('btc-v3',{...c,btcV3:p,maxHoldingMs:p.horizonMinutes*60000,maxRiskPerTrade:process.env.V2_MAX_RISK_PER_TRADE?c.maxRiskPerTrade:.005});
  }
  if (selectedStrategy() === 'btc-v4') return strategyConfiguration('btc-v4', c);
  if (selectedStrategy() === 'btc-v5') return strategyConfiguration('btc-v5', c);
  return c;
}
export function selectedStrategy(): StrategyId {
  const value = process.env.V2_STRATEGY || 'btc-v2';
  if (value !== 'btc-v2' && value !== 'legacy-v1' && value !== 'btc-v3' && value !== 'btc-v4' && value !== 'btc-v5') throw new Error('Invalid V2_STRATEGY');
  return value;
}
