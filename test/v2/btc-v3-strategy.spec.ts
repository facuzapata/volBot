import { BtcV3Strategy } from '../../src/v2/strategy/btc-v3.strategy';
import { BTC_V3_REVISION, DEFAULT_BTC_V3, v3ParametersHash } from '../../src/v2/strategy/btc-v3.config';
import { strategyConfiguration, revisionFor } from '../../src/v2/strategy/versions';
import { MarketHistory, Technical, StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { Candle } from '../../src/v2/domain/model';
import { bar } from './fixtures';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { causalLiquidity } from '../../src/v2/execution/causal-liquidity';
describe('Independent BTC-V3 pullback policy',()=>{
  const end=Date.UTC(2025,0,5)-1;
  const history=():MarketHistory=>{
    const make=(tf:'1m'|'5m'|'1h',step:number):Candle[]=>Array.from({length:100},(_,i)=>({...bar(end+1-(100-i)*step,{open:10020,close:10040,high:10100,low:9900}),timeframe:tf,closeTime:end-(99-i)*step}));
    const h={'1m':make('1m',60000),'5m':make('5m',300000),'1h':make('1h',3600000)};
    Object.assign(h['1m'][98],{open:10025,close:10030,high:10040});Object.assign(h['1m'][99],{open:10045,close:10050,high:10060});
    Object.assign(h['5m'][98],{open:10020,close:10040,high:10060});Object.assign(h['5m'][99],{open:10035,close:10050,high:10060});
    h['5m'].forEach(c=>c.low=9980);h['5m'][97].low=9950;
    return h;
  };
  const read=(bars:Candle[]):Technical=>({sma9:10020,sma21:bars.length<100?9990:10000,sma50:9900,ema12:10020,ema26:10000,rsi:50,atr:50,bb:{lower:9900,middle:10000,upper:10100},volumeMA:100,macd:1,signal:.5,histogram:.5});
  const model=()=>({id:'synthetic-test-only',revision:BTC_V3_REVISION,parametersHash:v3ParametersHash({...DEFAULT_BTC_V3}),horizonMinutes:60,trainedThrough:end-86400000,trainingHash:'synthetic-not-evidence',bins:[{low:.001,high:.015,samples:50,days:10,meanReturn:.02,meanReturnLower95:.01,mfeP25:.02}]});
  const config=()=>strategyConfiguration('btc-v3',{btcV3Calibration:model()});
  it('emits BUY only for a causal pullback/recovery with prior calibrated economics',()=>{
    const a=new BtcV3Strategy(read).assess(history(),config());expect(a.structuralEligible).toBe(true);expect(a.decision).toBe('BUY');
    expect(a.signal?.strategy).toBe('btc-v3');expect(a.signal?.protection?.timeframe).toBe('5m');expect(a.signal?.forecast?.calibrationId).toBe('synthetic-test-only');
    expect(a.signal!.protection!.stopPrice).toBeLessThan(a.signal!.referencePrice);expect(a.signal!.config.maxHoldingMs).toBe(3600000);
  });
  it('abstains with explicit reasons for missing, inadequate, future or uneconomic calibration',()=>{
    const strategy=new BtcV3Strategy(read),h=history();
    expect(strategy.assess(h,strategyConfiguration('btc-v3')).reason).toBe('NO_CALIBRATION');
    const c=config();c.btcV3Calibration!.bins[0].samples=1;expect(strategy.assess(h,c).reason).toBe('INSUFFICIENT_CALIBRATION');
    const future=config();future.btcV3Calibration!.trainedThrough=end;expect(strategy.assess(h,future).reason).toBe('CALIBRATION_NOT_PRIOR');
    const poor=config();poor.btcV3Calibration!.bins[0].meanReturnLower95=0;expect(strategy.assess(h,poor).reason).toBe('NO_NET_EDGE_ESTIMATE');
    const changed=config();changed.btcV3!.economicMargin=.0006;expect(strategy.assess(h,changed).reason).toBe('CALIBRATION_PARAMETERS_MISMATCH');
  });
  it('ignores higher-timeframe bars closing after the decision and rejects gaps/misalignment',()=>{
    const strategy=new BtcV3Strategy(read),h=history(),before=strategy.assess(h,config());
    h['1h'].push({...h['1h'].at(-1)!,openTime:end+1,closeTime:end+3600000,close:1});expect(strategy.assess(h,config())).toEqual(before);
    const gap=history();gap['5m'].splice(70,1);expect(strategy.assess(gap,config()).reason).toBe('MISSING_OR_UNALIGNED_DATA');
  });
  it('does not enter an extended bar or a failed recovery',()=>{
    const h=history();h['1m'][99].close=10101;h['1m'][99].high=10102;
    expect(new BtcV3Strategy(read).assess(h,config()).decision).toBe('NO_TRADE');
    const failed=history();failed['1m'][99].close=10030;expect(new BtcV3Strategy(read).assess(failed,config()).conditions.recovery1m).toBe(false);
  });
  it('keeps revisions and defaults separate and leaves BTC-V2 behavior independent of V3 calibration',()=>{
    expect(revisionFor('btc-v2')).toBe('2026-11-20.1');expect(revisionFor('btc-v3')).toBe(BTC_V3_REVISION);
    const h=history(),engine=new StrategyEngine(),base=strategyConfiguration('btc-v2');
    expect(engine.evaluate(h,'btc-v2',base)).toEqual(engine.evaluate(h,'btc-v2',{...base,btcV3Calibration:model()})?{...engine.evaluate(h,'btc-v2',{...base,btcV3Calibration:model()})!,config:base}:null);
  });
  it('executes an approved-in-test synthetic BUY with its absolute 5m protection and closes without erasing costs',()=>{
    const h=history(),a=new BtcV3Strategy(read).assess(h,config()),paper=new PaperExecutionAdapter(),s=newAccount('v3-synthetic','v3-synthetic');s.account.entriesEnabled=true;
    expect(paper.reserve(s,a.signal!,end).accepted).toBe(true);
    const budget=causalLiquidity(end+1,h['1m'].at(-1),.001);paper.execute(s,s.orders[0].id,10050,end+1,budget,'OPEN');
    expect(s.positions[0].status).toBe('OPEN');expect(s.positions[0].stopLoss).toBe('9945.000000000000');expect(s.positions[0].executionRisk?.accepted).toBe(true);
    paper.onCandle(s,bar(end+1,{open:10050,high:10160,low:10040,close:10150}),false,()=>true,budget);
    expect(s.positions[0].status).toBe('CLOSED');expect(s.positions[0].exitReason).toBe('TAKE_PROFIT');expect(s.fills).toHaveLength(2);expect(s.fills.every(f=>Number(f.commissionQuote)>0)).toBe(true);
  });
});
