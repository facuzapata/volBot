import { StrategyId, SimulationConfig, DEFAULT_SIMULATION } from '../domain/model';
import { BTC_V3_REVISION, DEFAULT_BTC_V3 } from './btc-v3.config';
import { BTC_V4_REVISION, DEFAULT_BTC_V4 } from './btc-v4.config';
import { BTC_V5_REVISION, DEFAULT_BTC_V5 } from './btc-v5.config';
export const revisionFor=(id:StrategyId|string):string=>id==='btc-v3'?BTC_V3_REVISION:id==='btc-v4'?BTC_V4_REVISION:id==='btc-v5'?BTC_V5_REVISION:id==='trend-reference'?'2026-11-20.trend.1':'2026-11-20.1';
export function strategyConfiguration(id:StrategyId,overrides:Partial<SimulationConfig>={}):SimulationConfig {
  const c={...DEFAULT_SIMULATION,...(id==='btc-v3'?{btcV3:{...DEFAULT_BTC_V3},maxHoldingMs:DEFAULT_BTC_V3.horizonMinutes*60000,maxRiskPerTrade:.005}:{}),...(id==='btc-v4'?{btcV4:{...DEFAULT_BTC_V4},maxHoldingMs:DEFAULT_BTC_V4.horizonMinutes*60000,maxRiskPerTrade:.005,maxStopPercent:.15,invalidationExit:false}:{}),...(id==='btc-v5'?{btcV5:{...DEFAULT_BTC_V5},maxHoldingMs:DEFAULT_BTC_V5.horizonMinutes*60000,maxRiskPerTrade:.005,maxStopPercent:.15,invalidationExit:false}:{}),...overrides};
  if(id==='btc-v3'){c.btcV3={...DEFAULT_BTC_V3,...overrides.btcV3};c.maxHoldingMs=c.btcV3.horizonMinutes*60000;}
  if(id==='btc-v4'){c.btcV4={...DEFAULT_BTC_V4,...overrides.btcV4};c.maxHoldingMs=c.btcV4.horizonMinutes*60000;}
  if(id==='btc-v5'){c.btcV5={...DEFAULT_BTC_V5,...overrides.btcV5};c.maxHoldingMs=c.btcV5.horizonMinutes*60000;}
  return c;
}
