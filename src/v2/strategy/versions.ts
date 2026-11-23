import { StrategyId, SimulationConfig, DEFAULT_SIMULATION } from '../domain/model';
import { BTC_V3_REVISION, DEFAULT_BTC_V3 } from './btc-v3.config';
import { BTC_V4_REVISION, DEFAULT_BTC_V4 } from './btc-v4.config';
import { BTC_V5_REVISION, DEFAULT_BTC_V5 } from './btc-v5.config';
import { BTC_V6_REVISION, DEFAULT_BTC_V6 } from './btc-v6.config';
export const revisionFor=(id:StrategyId|string):string=>id==='btc-v3'?BTC_V3_REVISION:id==='btc-v4'?BTC_V4_REVISION:id==='btc-v5'?BTC_V5_REVISION:id==='btc-v6'?BTC_V6_REVISION:id==='trend-reference'?'2026-11-20.trend.1':'2026-11-20.1';
export function strategyConfiguration(id:StrategyId,overrides:Partial<SimulationConfig>={}):SimulationConfig {
  const c={...DEFAULT_SIMULATION,...(id==='btc-v3'?{btcV3:{...DEFAULT_BTC_V3},maxHoldingMs:DEFAULT_BTC_V3.horizonMinutes*60000,maxRiskPerTrade:.005}:{}),...(id==='btc-v4'?{btcV4:{...DEFAULT_BTC_V4},maxHoldingMs:DEFAULT_BTC_V4.horizonMinutes*60000,maxRiskPerTrade:.005,maxStopPercent:.15,invalidationExit:false}:{}),...(id==='btc-v5'?{btcV5:{...DEFAULT_BTC_V5},maxHoldingMs:DEFAULT_BTC_V5.horizonMinutes*60000,maxRiskPerTrade:.001,maxStopPercent:.006,maxExposure:.2,dailyLossLimit:.005,invalidationExit:false}:{}),...(id==='btc-v6'?{btcV6:{...DEFAULT_BTC_V6},maxHoldingMs:0,maxExposure:1,invalidationExit:false,timeExit:false}:{}),...overrides};
  if(id==='btc-v3'){c.btcV3={...DEFAULT_BTC_V3,...overrides.btcV3};c.maxHoldingMs=c.btcV3.horizonMinutes*60000;}
  if(id==='btc-v4'){c.btcV4={...DEFAULT_BTC_V4,...overrides.btcV4};c.maxHoldingMs=c.btcV4.horizonMinutes*60000;}
  if(id==='btc-v5'){
    c.btcV5={...DEFAULT_BTC_V5,...overrides.btcV5};
    c.maxHoldingMs=c.btcV5.horizonMinutes*60000;
    // These ceilings also apply when a generic deployment config is passed in.
    // Callers can tighten them, but cannot accidentally restore the general 2% risk budget.
    c.maxRiskPerTrade=Math.min(c.maxRiskPerTrade,.001);
    c.dailyLossLimit=Math.min(c.dailyLossLimit,.005);
    c.maxExposure=Math.min(c.maxExposure,.2);
    c.maxStopPercent=Math.min(c.maxStopPercent,.006);
    c.trailing=false;
    c.invalidationExit=false;
    c.timeExit=c.btcV5.exitMode!=='TARGET_ONLY';
  }
  if(id==='btc-v6'){
    c.btcV6={...DEFAULT_BTC_V6,...overrides.btcV6};
    c.maxExposure=Math.min(c.maxExposure,1);
    c.trailing=false;c.invalidationExit=false;c.timeExit=false;
  }
  return c;
}
