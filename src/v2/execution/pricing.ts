import Decimal from 'decimal.js';
import { SimulationConfig } from '../domain/model';
export const decimalString=(v:Decimal.Value):string=>new Decimal(v).toFixed(12);
export const floorStep=(v:Decimal.Value,step:Decimal.Value):Decimal=>new Decimal(v).div(step).floor().mul(step);
/** Same adverse price/limit rules for projection and actual execution. */
export function executionPrice(reference:Decimal.Value,side:'BUY'|'SELL',c:SimulationConfig,limit?:Decimal.Value):Decimal {
  let p=new Decimal(reference).mul(1+(side==='BUY'?1:-1)*(c.spreadBps/2+c.slippageBps)/10000);
  p=side==='BUY'?p.div(c.tickSize).ceil().mul(c.tickSize):floorStep(p,c.tickSize);
  return limit===undefined?p:side==='BUY'?Decimal.min(p,limit):Decimal.max(p,limit);
}
