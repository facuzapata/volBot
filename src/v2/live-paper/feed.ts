import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {Kafka,Producer,Consumer,logLevel} from 'kafkajs';
import WebSocket=require('ws');
import {QueryRunner} from 'typeorm';
import {StoreService} from '../persistence/store.service';
import {CandleRow} from '../persistence/entities';
import {PublicMarketClient,validCandle} from '../market/public-market.client';
import {MarketDataService} from '../market/market-data.service';
import {SimulationSettings} from '../market/simulation-settings';
import {RedisCacheService} from '../market/redis-cache.service';
import {LivePaperService} from './service';
import {DAY,FeedState,Quote} from './model';
export const PAPER_QUOTE_TOPIC='paper.prospective.quote.v1';
@Injectable()
export class ProspectiveFeed implements OnModuleInit,OnModuleDestroy{
 private readonly log=new Logger(ProspectiveFeed.name);
 private readonly kafka=new Kafka({clientId:'volbot-prospective-public',brokers:(process.env.V2_KAFKA_BROKERS||'localhost:19092').split(','),logLevel:logLevel.NOTHING,retry:{retries:2},connectionTimeout:3000,requestTimeout:10000});
 private producer?:Producer;private consumer?:Consumer;private socket?:WebSocket;private timer?:NodeJS.Timeout;private retry?:NodeJS.Timeout;private reconnect?:NodeJS.Timeout;private market:MarketDataService;private lease?:QueryRunner;
 private stopped=false;private closing=false;private busy=false;private queue:Promise<void>=Promise.resolve();private sentAt=0;private lastTradeAt=0;private lastSequence=0;private lastBookAt=0;private connected=false;private kafkaReady=false;private marketStarted=false;private warmed=false;
 constructor(private readonly service:LivePaperService,private readonly store:StoreService,private readonly client:PublicMarketClient,private readonly settings:SimulationSettings,private readonly cache:RedisCacheService){this.market=new MarketDataService(store,client,settings);}
 onModuleInit(){void this.start();}
 private async start(){if(this.stopped)return;try{
  await this.store.db.query('SELECT id FROM v2_paper_feed LIMIT 1');
  this.lease=this.store.db.createQueryRunner();await this.lease.connect();const [lock]=await this.lease.query('SELECT pg_try_advisory_lock(17952001) AS acquired');if(!lock.acquired)throw Error('PROSPECTIVE_LEADER_ALREADY_RUNNING');
  this.closing=false;this.settings.updateFilters(await this.client.filters());if(!this.warmed){await this.warmup();this.warmed=true;}if(this.stopped)return;
  if(!this.marketStarted){this.market.onModuleInit();this.marketStarted=true;}await this.startKafka();this.connect();
  this.timer=setInterval(()=>{if(!this.busy){this.busy=true;void this.watchdog().finally(()=>{this.busy=false;});}},1000);
 }catch(error){this.log.error(JSON.stringify({event:'prospective_feed_unavailable',code:error instanceof Error?error.message:'UNKNOWN'}));await this.closeConnections();if(!this.stopped)this.retry=setTimeout(()=>void this.start(),10000);}}
 async warmup(){const end=Math.floor(Date.now()/60000)*60000,start=end-28*DAY;let cursor=start;
  // Existing closed candle repository/client, only current warmup; never trade or emit recovered entries.
  while(cursor<end&&!this.stopped){const page=(await this.client.candles('1m',cursor,1000)).filter(c=>validCandle(c)&&c.openTime<end);if(!page.length)throw Error('PUBLIC_WARMUP_INCOMPLETE');
   await this.store.db.getRepository(CandleRow).createQueryBuilder().insert().values(page.map(data=>({id:`1m:${data.openTime}`,timeframe:'1m',openTime:data.openTime,data}))).orIgnore().execute();const next=page.at(-1)!.openTime+60000;if(next<=cursor)throw Error('NON_ADVANCING_PUBLIC_WARMUP');cursor=next;
  }
 }
 private async startKafka(){
  const admin=this.kafka.admin();try{await admin.connect();await admin.createTopics({waitForLeaders:true,topics:[{topic:PAPER_QUOTE_TOPIC,numPartitions:1,replicationFactor:1,configEntries:[{name:'retention.ms',value:String(7*DAY)}]}]});}finally{await admin.disconnect();}
  this.producer=this.kafka.producer({idempotent:true,maxInFlightRequests:1});await this.producer.connect();this.consumer=this.kafka.consumer({groupId:'volbot-prospective-v1',sessionTimeout:60000});await this.consumer.connect();await this.consumer.subscribe({topic:PAPER_QUOTE_TOPIC,fromBeginning:false});
  this.consumer.on(this.consumer.events.CRASH,()=>{this.kafkaReady=false;});
  await this.consumer.run({eachMessage:async({message})=>{if(!message.value)return;let quote:Quote;try{quote=JSON.parse(message.value.toString()) as Quote;}catch{this.log.error(JSON.stringify({event:'paper_quote_payload_rejected'}));return;}const feed=await this.status();await this.service.process(quote,feed);}});this.kafkaReady=true;
 }
 private connect(){if(this.stopped||this.closing)return;
  this.socket=new WebSocket(`${this.client.wsBase}/stream?streams=btcusdt@bookTicker/btcusdt@aggTrade`);
  this.socket.on('open',()=>{this.connected=true;});
  this.socket.on('message',raw=>{try{const message=JSON.parse(raw.toString()) as {data?:{s?:string;e?:string;T?:number;u?:number;b?:string;a?:string;B?:string;A?:string}},d=message.data;if(d?.s!=='BTCUSDT')return;
   if(d.e==='aggTrade'){this.lastTradeAt=Number(d.T);return;}
   if(d.u===undefined||!d.b||!d.a||!d.B||!d.A)return;const now=Date.now();this.lastBookAt=now;
   if(!Number.isSafeInteger(d.u)||d.u<=this.lastSequence||now-this.sentAt<1000)return;this.lastSequence=d.u;this.sentAt=now;
   const quote:Quote={id:`BTCUSDT:${d.u}`,sequence:d.u,bid:Number(d.b),ask:Number(d.a),bidQty:Number(d.B),askQty:Number(d.A),receivedAt:now,exchangeTime:this.lastTradeAt};
   this.queue=this.queue.then(async()=>{const status=await this.status();await this.service.setFeed(status);await this.cache.set('prospective:feed',status,5);
    if(this.kafkaReady&&this.producer){try{await this.producer.send({topic:PAPER_QUOTE_TOPIC,acks:-1,messages:[{key:'BTCUSDT',value:JSON.stringify(quote)}]});}catch{this.kafkaReady=false;await this.service.process(quote,{...status,kafka:false});}}
    else await this.service.process(quote,{...status,kafka:false});
   }).catch(error=>{this.log.error(JSON.stringify({event:'paper_quote_processing_failed',code:error instanceof Error?error.message:'UNKNOWN'}));});
  }catch{this.log.warn(JSON.stringify({event:'public_quote_payload_rejected'}));}});
  this.socket.on('error',()=>this.socket?.terminate());this.socket.on('close',()=>{this.connected=false;if(!this.stopped&&!this.closing)this.reconnect=setTimeout(()=>this.connect(),5000);});
 }
 async status():Promise<FeedState>{const now=Date.now(),history=await this.service.history(),last=history.at(-1),contiguous=history.length>=24000&&history.every((c,i)=>validCandle(c)&&c.closeTime<now&&(!i||c.openTime===history[i-1].openTime+60000)),f=this.settings.config;
  return {connected:this.connected,marketReady:contiguous&&!!last&&now-last.closeTime<90000,redis:this.cache.ready,kafka:this.kafkaReady,filters:{stepSize:f.stepSize,tickSize:f.tickSize,minQty:f.minQty,minNotional:f.minNotional},filtersAt:this.settings.filtersUpdatedAt,updatedAt:now,lastTradeAt:this.lastTradeAt,lastQuoteAt:this.lastBookAt,lastCandleAt:last?.closeTime??0,error:contiguous?null:'CANDLE_GAP_OR_WARMUP'};
 }
 private async watchdog(){try{
  await this.lease?.query('SELECT 1');const status=await this.status();await this.service.setFeed(status);
  if(!status.connected||!status.marketReady||!status.redis||!status.kafka||Date.now()-this.lastBookAt>3000||Math.abs(Date.now()-this.lastTradeAt)>3000){await this.service.pauseUnsafe('FEED_OR_DEPENDENCY_UNSAFE');this.log.warn(JSON.stringify({event:'paper_feed_unsafe',redis:status.redis,kafka:status.kafka,quoteConnected:status.connected,candles:status.marketReady}));}
  if(this.connected&&Date.now()-this.lastBookAt>10000)this.socket?.terminate();
  if(!this.kafkaReady){await this.consumer?.disconnect().catch(()=>undefined);await this.producer?.disconnect().catch(()=>undefined);await this.startKafka();}
 }catch(error){this.log.error(JSON.stringify({event:'paper_watchdog_failed',code:error instanceof Error?error.message:'UNKNOWN'}));await this.service.pauseUnsafe('DATABASE_OR_FEED_UNSAFE').catch(()=>undefined);}}
 private async closeConnections(){this.closing=true;this.connected=false;this.kafkaReady=false;clearInterval(this.timer);clearTimeout(this.reconnect);this.socket?.terminate();await this.consumer?.disconnect().catch(()=>undefined);await this.producer?.disconnect().catch(()=>undefined);if(this.lease&&!this.lease.isReleased){await this.lease.query('SELECT pg_advisory_unlock(17952001)').catch(()=>undefined);await this.lease.release().catch(()=>undefined);}this.lease=undefined;}
 async onModuleDestroy(){this.stopped=true;clearTimeout(this.retry);clearTimeout(this.reconnect);clearInterval(this.timer);await this.queue;if(this.marketStarted)await this.market.onModuleDestroy();await this.closeConnections();}
}
