import { CausalLiquidityBudget, LiquidityObservation } from '../domain/model';
/** Previous complete minute only; one shared pool for OPEN/INTRABAR/CLOSE, no close-time refill. */
export function causalLiquidity(openTime:number,prior:LiquidityObservation|undefined,rate:number,used=0):CausalLiquidityBudget {
  const valid=prior?.openTime===openTime-60000&&prior.closeTime===openTime-1&&Number.isFinite(prior.volume)&&prior.volume>=0&&Number.isFinite(rate)&&rate>0&&rate<=1;
  return {barOpenTime:openTime,sourceCloseTime:valid?prior!.closeTime:null,capacity:valid?prior!.volume*rate:0,used:Math.max(0,used)};
}
export function remainingLiquidity(b:CausalLiquidityBudget):number{return Math.max(0,b.capacity-b.used)}
