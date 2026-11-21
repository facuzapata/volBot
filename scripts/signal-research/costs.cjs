const Decimal=require('decimal.js');
const {PaperExecutionAdapter,newAccount}=require('../../dist/v2/execution/paper-execution.adapter');
const {DEFAULT_SIMULATION, SIMULATOR_REVISION}=require('../../dist/v2/domain/model');
const {STRATEGY_REVISION}=require('../../dist/v2/strategy/strategy-engine');
const paper=new PaperExecutionAdapter();
function costEntry(reference,at,config=DEFAULT_SIMULATION){
 const s=newAccount('research-cost','research-cost',500,5,30);s.account.entriesEnabled=true;
 // Synthetic risk geometry only seeds the existing adapter for a fee/rounding calculation.
 // This is not an alternative trading signal or portfolio-admission decision.
 const sig={id:'cost',strategy:'btc-v2',strategyRevision:STRATEGY_REVISION,symbol:'BTCUSDT',candleTime:at,referencePrice:reference,atr:reference*.001,swingLow:reference*.998,regime:'research',conditions:{},config:{...config}};
 const decision=paper.reserve(s,sig,at);if(!decision.accepted)throw new Error('Cost fixture admission failed: '+decision.reason);
 paper.execute(s,s.orders[0].id,reference,at,1);
 return s;
}
function costExit(s,reference,at,type='MARKET'){
 const copy=structuredClone(s),p=copy.positions[0];const o=paper.requestExit(copy,p.id,at,'BOUNDED_RESEARCH_HOLD',type,type==='LIMIT'?reference:undefined);
 paper.execute(copy,o.id,reference,at,1);const f=copy.fills.at(-1);
 return {netPnl:Number(p.realizedPnl),netReturnPct:Number(p.realizedPnl)/Number(s.positions[0].remainingCost)*100,sellPrice:Number(f.price),sellFee:Number(f.commissionQuote??f.commission),spread:Number(f.spreadCostQuote??0),slippage:Number(f.slippageCostQuote??0),rounding:Number(f.roundingCostQuote??0),simulatorRevision:SIMULATOR_REVISION};
}
function breakEven(quantity,cost,reference,config=DEFAULT_SIMULATION){
 const q=new Decimal(quantity),tick=new Decimal(config.tickSize);
 const executed=new Decimal(cost).div(q.mul(1-config.feeRate)).div(tick).ceil().mul(tick);
 const impact=(config.spreadBps/2+config.slippageBps)/10000;
 const marketReference=executed.div(1-impact).div(tick).ceil().mul(tick);
 return {breakEvenSellExecuted:Number(executed),breakEvenMarketReference:Number(marketReference),breakEvenMarketMovePct:(Number(marketReference)/reference-1)*100,breakEvenLimitReference:Number(executed),breakEvenLimitMovePct:(Number(executed)/reference-1)*100};
}
module.exports={costEntry,costExit,breakEven};

