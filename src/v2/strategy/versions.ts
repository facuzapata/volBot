import { StrategyId, SimulationConfig, DEFAULT_SIMULATION } from '../domain/model';
import { BTC_V3_REVISION, DEFAULT_BTC_V3 } from './btc-v3.config';
export const revisionFor=(id:StrategyId|string):string=>id==='btc-v3'?BTC_V3_REVISION:id==='trend-reference'?'2026-11-20.trend.1':'2026-11-20.1';
export function strategyConfiguration(id:StrategyId,overrides:Partial<SimulationConfig>={}):SimulationConfig {
  const c={...DEFAULT_SIMULATION,...(id==='btc-v3'?{btcV3:{...DEFAULT_BTC_V3},maxHoldingMs:DEFAULT_BTC_V3.horizonMinutes*60000,maxRiskPerTrade:.005}:{}),...overrides};
  if(id==='btc-v3'){c.btcV3={...DEFAULT_BTC_V3,...overrides.btcV3};c.maxHoldingMs=c.btcV3.horizonMinutes*60000;}
  return c;
}
