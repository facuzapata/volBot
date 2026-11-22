import Decimal from 'decimal.js';
import { AccountState, ExecutionRisk, Position } from '../domain/model';
import { decimalString as str, executionPrice, floorStep } from '../execution/pricing';

/** Pure projection. It never repairs an invalid stop or mutates inventory. */
export function assessExecutionRisk(s:AccountState,p:Position,reference:number,price:Decimal,qty:Decimal,at:number):ExecutionRisk {
  const c=p.config,q0=new Decimal(p.quantity),gross0=new Decimal(p.entryGrossQuantity??p.entryQuantity);
  const gross=gross0.plus(qty),quote=qty.mul(price),fee=quote.mul(c.feeRate),baseFee=c.buyCommissionAsset==='BTC';
  const q=q0.plus(baseFee?qty.mul(1-c.feeRate):qty),cost=new Decimal(p.remainingCost).plus(quote).plus(baseFee?0:fee);
  const avg=new Decimal(p.entryQuote).plus(quote).div(gross);
  const candidate=p.protectionMode==='ABSOLUTE'?new Decimal(p.plannedStop??p.stopLoss):avg.mul(1-p.stopDistance);
  const unrounded=q0.gt(0)?Decimal.max(p.stopLoss,candidate):candidate;
  const stop=floorStep(unrounded,c.tickSize),sellQty=floorStep(q,c.stepSize),sell=executionPrice(stop,'SELL',c);
  const equity=new Decimal(s.account.available).plus(s.account.reserved).plus(s.positions.reduce((n,x)=>n.plus(new Decimal(x.quantity).mul(reference)),new Decimal(0)));
  const maxLoss=equity.mul(c.maxRiskPerTrade),loss=Decimal.max(0,cost.minus(sellQty.mul(sell).mul(1-c.feeRate)));
  const target=p.protectionMode==='ABSOLUTE'?new Decimal(p.plannedTarget!):avg.mul(1+p.targetDistance);
  const targetTick=target.div(c.tickSize).ceil().mul(c.tickSize),targetPnl=sellQty.mul(targetTick).mul(1-c.feeRate).minus(cost);
  const entryImpact=new Decimal(p.entryQuote).plus(quote).minus(new Decimal(p.entryReferenceQuote??p.entryQuote).plus(qty.mul(reference)));
  const exposure=new Decimal(s.account.reserved).plus(s.positions.reduce((n,x)=>n.plus(new Decimal(x.quantity).mul(reference)),new Decimal(0)));
  let reason='ACCEPTED';
  if(!Number.isFinite(p.stopDistance)||p.stopDistance<=0||!stop.isFinite()||stop.lte(0)||!price.isFinite()||price.lte(0)||!qty.isFinite()||qty.lte(0))reason='INVALID_EXECUTION_GEOMETRY';
  else if(stop.gte(price)||stop.gte(avg))reason='STOP_NOT_BELOW_EXECUTED';
  else if(stop.gte(reference))reason='STOP_NOT_BELOW_REFERENCE';
  else if(p.protectionMode==='ABSOLUTE'&&(!Number.isFinite(Number(p.plannedTarget))||new Decimal(p.plannedTarget!).lte(price)))reason='TARGET_NOT_ABOVE_EXECUTED';
  else if(p.strategy==='btc-v3'&&targetPnl.lte(cost.mul(c.btcV3?.economicMargin??.0005)))reason='TARGET_NOT_ECONOMIC';
  else if(p.strategy==='btc-v4'&&targetPnl.lte(loss.mul(c.btcV4?.targetRiskMultiple??1.8)))reason='TARGET_REWARD_RISK';
  else if(p.strategy==='btc-v5'&&targetPnl.lte(loss.mul(c.btcV5?.targetRiskMultiple??2)))reason='TARGET_REWARD_RISK';
  else if(p.stopDistance>c.maxStopPercent||price.minus(stop).div(price).gt(c.maxStopPercent))reason='EXECUTION_STOP_DISTANCE';
  else if(!Number.isFinite(c.maxRiskPerTrade)||c.maxRiskPerTrade<=0||loss.gt(maxLoss))reason='EXECUTION_TRADE_RISK';
  else if(exposure.gt(equity.mul(c.maxExposure)))reason='EXECUTION_MAX_EXPOSURE';
  else if(s.positions.some(x=>Number(x.quantity)>0&&x.id!==p.id&&reference<Number(x.averageEntry))||(q0.gt(0)&&new Decimal(reference).lt(p.averageEntry)))reason='AVERAGING_DOWN_BLOCKED';
  else if(new Decimal(s.account.dayPnl).lte(new Decimal(s.account.dayStartEquity).mul(-c.dailyLossLimit)))reason='EXECUTION_DAILY_LOSS_LIMIT';
  else if(p.strategy==='btc-v3'&&(!p.forecast||new Decimal(p.signalReferencePrice??reference).mul(1+p.forecast.expectedGrossLower95).mul(q).mul(1-c.feeRate).lte(cost.mul(1+(c.btcV3?.economicMargin??.0005)))))reason='EXECUTION_EDGE_LOST';
  return {at,referencePrice:str(reference),executedPrice:str(price),unroundedStop:str(unrounded),stopPrice:str(stop),stopRounding:str(stop.minus(unrounded)),distanceFromReferencePct:new Decimal(reference).minus(stop).div(reference).mul(100).toNumber(),distanceFromExecutedPct:avg.minus(stop).div(avg).mul(100).toNumber(),grossRiskFromReference:str(new Decimal(reference).minus(stop).mul(q)),grossRiskFromExecuted:str(avg.minus(stop).mul(q)),estimatedNetStopLoss:str(loss),estimatedNetTargetPnl:str(targetPnl),roundTripFeesQuote:str(new Decimal(p.entryFees).plus(fee).plus(sellQty.mul(sell).mul(c.feeRate))),roundTripExecutionImpactQuote:str(entryImpact.plus(stop.minus(sell).mul(sellQty))),untradableQuantity:str(q.minus(sellQty)),riskLimitQuote:str(maxLoss),equityQuote:str(equity),accepted:reason==='ACCEPTED',reason};
}
