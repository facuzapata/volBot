import {createHash} from 'crypto';
import {AccountState,Candle,MarketSignal,SimulationConfig,DEFAULT_SIMULATION} from '../domain/model';
export type BotId='pullback-4h'|'momentum-1h';
export type Filters=Pick<SimulationConfig,'stepSize'|'tickSize'|'minQty'|'minNotional'>;
export function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const BOT_IDS:BotId[]=['pullback-4h','momentum-1h'];
export const DAY=86400000;
export function experimentConfig(filters:Filters,implementationHash='synthetic-fixture'){return {revision:'prospective-paper-1',implementationHash,mode:'PAPER' as const,durationDays:30,capitalPerBot:500,
 sourceResearchFreeze:'35d7078e2bc08c80d9e6fded6a7090d0cf82dee79609a89db0faa74f6e004da4',
 strategies:{'pullback-4h':{hours:4,stopAtr:2,rewardRisk:3,holdHours:120},'momentum-1h':{hours:1,stopAtr:2,rewardRisk:3,holdHours:48}},
 execution:{...DEFAULT_SIMULATION,...filters,feeRate:.001,spreadBps:2,slippageBps:3,participationRate:.001,maxRiskPerTrade:.005,maxExposure:.8,dailyLossLimit:.03,maxStopPercent:.15,trailing:false,invalidationExit:false},
 limits:{targetRisk:.0045,maxRisk:.005,maxDrawdown:.05,drawdownExit:.04,maxDailyLoss:.03,dailyExit:.025,maxExposure:.8,maxPositions:1},
 feed:{quoteMaxAgeMs:2000,tradeMaxAgeMs:2000,candleSignalMaxAgeMs:5000,minLatencyMs:250,maxSpreadBps:20,bookParticipation:.01,outageMs:10000,recoveryStableMs:60000},
 pricePolicy:'Midpoint plus max(observed spread,2bps)/2 plus adverse 3bps; TP is a market exit on observed bid crossing; no OHLC fills; prior-minute volume shared by both bots; top-book cap1%',
 filtersPolicy:'Snapshot immutable; public filter changes pause entries; exits use current public constraints',
 };}
export type ExperimentConfig=ReturnType<typeof experimentConfig>;
export interface Quote {id:string;sequence:number;bid:number;ask:number;bidQty:number;askQty:number;exchangeTime:number;receivedAt:number;}
export interface FeedState {connected:boolean;marketReady:boolean;redis:boolean;kafka:boolean;filters:Filters;filtersAt:number;updatedAt:number;lastTradeAt:number;lastQuoteAt:number;lastCandleAt:number;error:string|null;}
export interface Bot {id:BotId;s:AccountState;paused:boolean;reason:string;hardHalt:boolean;peak:number;maxDrawdown:number;maxDailyLoss:number;maxExposure:number;day:string;dayStart:number;lastEquity:number;lastSignal?:{at:number;knownAt:number;decision:string;reason:string};pending?:{signal:MarketSignal;knownAt:number};lastMetrics?:Record<string,unknown>;}
export interface Passive {cash:number;btc:number;cost:number;fees:number;spread:number;slippage:number;usedMinute:number;used:number;peak:number;maxDrawdown:number;maxExposure:number;startedAt?:number;lastEquity?:number;asOf?:number;}
export interface Experiment {id:string;ownerId:string;config:ExperimentConfig;configHash:string;phase:'PREPARED'|'AUTHORIZED'|'RUNNING'|'STOPPING'|'ENDED'|'ENDED_WITH_DUST'|'STOPPED';createdAt:number;startedAt?:number;endsAt?:number;stopAt?:number;endedAt?:number;authorization?:{scope:'PAPER_ONLY';by:string;at:number;configHash:string;revokedAt?:number};lastCandle:number;lastQuoteAt:number;recoveryHealthySince?:number;bots:Record<BotId,Bot>;passive:Passive;}
export interface Observation {kind:string;bot?:BotId;at:number;data:object;}
export interface KernelInput {quote:Quote;now:number;feed:FeedState;prior?:Candle;history:Candle[];usedVolume:number;}
