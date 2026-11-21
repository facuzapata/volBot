import {ConflictException,Injectable,Logger,NotFoundException,Inject,Optional} from '@nestjs/common';
import {randomUUID} from 'crypto';
import {DataSource,EntityManager} from 'typeorm';
import {CandleRow} from '../persistence/entities';
import {Candle} from '../domain/model';
import {ProspectiveKernel} from './kernel';
import {BOT_IDS,BotId,DAY,Experiment,FeedState,Quote,experimentConfig,fingerprint} from './model';
import {implementationHash} from './implementation';
export const PAPER_CLOCK='PROSPECTIVE_PAPER_CLOCK';
@Injectable()
export class LivePaperService{
 private readonly log=new Logger(LivePaperService.name);
 readonly kernel=new ProspectiveKernel();
 private historyCache:Candle[]=[];private historyTail=0;
 constructor(readonly db:DataSource,@Optional() @Inject(PAPER_CLOCK) private readonly clock:()=>number=()=>Date.now()){}
 private buildHash(){return fingerprint([implementationHash(),LivePaperService.toString()]);}
 async feed():Promise<FeedState|null>{const rows=await this.db.query('SELECT data FROM v2_paper_feed WHERE id=$1',['BTCUSDT']);return rows[0]?.data??null;}
 async setFeed(feed:FeedState):Promise<void>{await this.db.query('INSERT INTO v2_paper_feed(id,data) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',['BTCUSDT',JSON.stringify(feed)]);}
 private async trustedFeed(now=this.clock()):Promise<FeedState>{const f=await this.feed();if(!f||!f.connected||!f.marketReady||!f.redis||!f.kafka||now-f.updatedAt>5000||now-f.lastQuoteAt>2000||now-f.lastCandleAt>90000)throw new ConflictException('FEED_NOT_READY');return f;}
 async get(id:string,tx:EntityManager=this.db.manager):Promise<Experiment>{const rows=await tx.query('SELECT state FROM v2_paper_experiments WHERE id=$1',[id]);if(!rows.length)throw new NotFoundException();return rows[0].state;}
 async list(){return (await this.db.query('SELECT id,config_hash,state FROM v2_paper_experiments ORDER BY created_at DESC LIMIT 100')).map((r:{id:string;config_hash:string;state:Experiment})=>({id:r.id,configHash:r.config_hash,phase:r.state.phase,startedAt:r.state.startedAt,endsAt:r.state.endsAt,metrics:BOT_IDS.map(id=>({bot:id,...r.state.bots[id].lastMetrics}))}));}
 private async save(tx:EntityManager,e:Experiment){await tx.query('UPDATE v2_paper_experiments SET state=$2 WHERE id=$1',[e.id,JSON.stringify(e)]);}
 private async event(tx:EntityManager,id:string,kind:string,at:number,data:object,bot?:BotId){await tx.query('INSERT INTO v2_paper_observations(experiment_id,bot,kind,at,data) VALUES ($1,$2,$3,$4,$5)',[id,bot??null,kind,at,JSON.stringify(data)]);}
 async prepare(ownerId:string):Promise<Experiment>{const feed=await this.trustedFeed(),e=this.kernel.create(randomUUID(),ownerId,experimentConfig(feed.filters,this.buildHash()),this.clock());await this.db.transaction(async tx=>{await tx.query('INSERT INTO v2_paper_experiments(id,owner_id,config,config_hash,state) VALUES ($1,$2,$3,$4,$5)',[e.id,ownerId,JSON.stringify(e.config),e.configHash,JSON.stringify(e)]);await this.event(tx,e.id,'experiment_prepared',e.createdAt,{configHash:e.configHash,capitalPerBot:500,mode:'PAPER'});});return e;}
 async control(id:string,action:'authorize'|'start'|'pause'|'resume'|'stop'|'revoke',actor:string,body:{configHash?:string;scope?:string;confirmation?:string;bot?:BotId;reason?:string}):Promise<Experiment>{
  const now=this.clock();return this.db.transaction(async tx=>{
   await tx.query('SELECT id FROM v2_paper_experiments WHERE id=$1 FOR UPDATE',[id]);const e=await this.get(id,tx);
   if(fingerprint(e.config)!==e.configHash)throw new ConflictException('CONFIGURATION_TAMPERED');
   if(['authorize','start','resume'].includes(action)&&e.config.implementationHash!==this.buildHash())throw new ConflictException('REVIEWED_BUILD_REQUIRED');
   if(['authorize','start','resume'].includes(action)&&body.configHash!==e.configHash)throw new ConflictException('REVIEW_EXACT_CONFIG_HASH_REQUIRED');
   if(action==='authorize'){
    if(body.scope!=='PAPER_ONLY'||body.confirmation!=='I_AUTHORIZE_VIRTUAL_FUNDS_ONLY'||!['PREPARED','AUTHORIZED','RUNNING'].includes(e.phase))throw new ConflictException('PAPER_AUTHORIZATION_REQUIRED');
    e.authorization={scope:'PAPER_ONLY',by:actor,at:now,configHash:e.configHash};if(e.phase==='PREPARED')e.phase='AUTHORIZED';
   }else if(action==='start'){
    if(e.phase!=='AUTHORIZED'||e.startedAt||!e.authorization||e.authorization.revokedAt||body.confirmation!=='START_PAPER_30_DAYS')throw new ConflictException('MANUAL_START_REQUIRED');
    await this.trustedFeed(now);e.phase='RUNNING';e.startedAt=now;e.endsAt=now+30*DAY;e.lastQuoteAt=now;
    const latest=await tx.getRepository(CandleRow).findOne({where:{timeframe:'1m'},order:{openTime:'DESC'}});e.lastCandle=latest?.data.closeTime??0;
    for(const bot of BOT_IDS){e.bots[bot].paused=false;e.bots[bot].reason='';}
   }else if(action==='resume'){
    if(e.phase!=='RUNNING'||!e.authorization||e.authorization.revokedAt||now>=e.endsAt!||body.confirmation!=='RESUME_PAPER_ONLY')throw new ConflictException('ACTIVE_PAPER_AUTHORIZATION_REQUIRED');
    const feed=await this.trustedFeed(now);if(fingerprint(feed.filters)!==fingerprint({stepSize:e.config.execution.stepSize,tickSize:e.config.execution.tickSize,minQty:e.config.execution.minQty,minNotional:e.config.execution.minNotional}))throw new ConflictException('FILTER_CHANGE_REQUIRES_NEW_EXPERIMENT');
    for(const id of body.bot?[body.bot]:BOT_IDS){const b=e.bots[id];this.kernel.reconcile(b);if(b.hardHalt||b.maxDrawdown>=.05||b.lastEquity<b.dayStart*.975&&b.day===new Date(now).toISOString().slice(0,10))throw new ConflictException('HARD_RISK_OR_DAILY_HALT');b.paused=false;b.reason='';}
   }else if(action==='pause'){for(const bot of body.bot?[body.bot]:BOT_IDS)this.kernel.pause(e,bot,body.reason||'MANUAL_PAUSE');}
   else if(action==='revoke'){if(e.authorization)e.authorization.revokedAt=now;for(const bot of BOT_IDS)this.kernel.pause(e,bot,'AUTHORIZATION_REVOKED');}
   else if(action==='stop'){if(!['ENDED','STOPPED'].includes(e.phase)){e.phase=e.startedAt?'STOPPING':'STOPPED';e.stopAt=now;for(const bot of BOT_IDS)this.kernel.pause(e,bot,'MANUAL_STOP');}}
   await this.event(tx,e.id,`manual_${action}`,now,{actor,configHash:e.configHash,reason:body.reason,bot:body.bot});await this.save(tx,e);return e;
  });
 }
 async history():Promise<Candle[]>{const latest=await this.db.getRepository(CandleRow).findOne({where:{timeframe:'1m'},order:{openTime:'DESC'}});if(!latest)return [];
  const previous=this.historyCache,contiguous=previous.every((c,i)=>!i||c.openTime===previous[i-1].openTime+60000);
  if(latest.data.closeTime===this.historyTail&&contiguous)return previous;
  const repo=this.db.getRepository(CandleRow);if(!previous.length||!contiguous){this.historyCache=(await repo.find({where:{timeframe:'1m'},order:{openTime:'DESC'},take:42000})).reverse().map(r=>r.data);}
  else{const added=await repo.createQueryBuilder('c').where('c.timeframe = :tf',{tf:'1m'}).andWhere('c.openTime > :last',{last:previous.at(-1)!.openTime}).orderBy('c.openTime','ASC').take(42000).getMany();this.historyCache=[...previous,...added.map(r=>r.data)].slice(-42000);}
  this.historyTail=this.historyCache.at(-1)?.closeTime??0;return this.historyCache;
 }
 async process(quote:Quote,feed:FeedState,now=this.clock()):Promise<void>{
  if(!this.kernel.validQuote(quote,now,experimentConfig(feed.filters))){await this.pauseUnsafe('STALE_OR_INVALID_QUOTE',now);return;}
  const history=await this.history(),minute=Math.floor(quote.receivedAt/60000)*60000,prior=history.find(c=>c.openTime===minute-60000);
  await this.db.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`paper-liquidity:BTCUSDT:${minute}`]);
   const rows=await tx.query("SELECT state FROM v2_paper_experiments WHERE state->>'phase' IN ('RUNNING','STOPPING','ENDED_WITH_DUST') ORDER BY id FOR UPDATE");if(!rows.length)return;
   const [lastQuote]=await tx.query('SELECT data FROM v2_paper_quotes ORDER BY at DESC LIMIT 1');if(lastQuote&&quote.sequence<=lastQuote.data.sequence)return;
   const inserted=await tx.query('INSERT INTO v2_paper_quotes(id,at,data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[quote.id,quote.receivedAt,JSON.stringify(quote)]);if(!inserted.length)return;
   const [{used}]=await tx.query(`SELECT COALESCE(sum((data->'fill'->>'quantity')::numeric),0)::text AS used FROM v2_paper_observations WHERE kind='fill' AND at >= $1 AND at < $2`,[minute,minute+60000]);
   const [{legacy}]=await tx.query("SELECT COALESCE(sum((data->>'quantity')::numeric),0)::text AS legacy FROM v2_fills WHERE (data->>'at')::bigint >= $1 AND (data->>'at')::bigint < $2",[minute,minute+60000]);
   let consumed=Number(used)+Number(legacy);
   for(const row of rows){let e=row.state as Experiment;const before=JSON.parse(JSON.stringify(e)) as Experiment;
    try{
     const [owner]=await tx.query('SELECT active FROM v2_users WHERE id=$1',[e.ownerId]);
     if(!owner?.active||e.config.implementationHash!==this.buildHash())for(const bot of BOT_IDS)this.kernel.pause(e,bot,!owner?.active?'OWNER_INACTIVE':'REVIEWED_BUILD_REQUIRED');
     if(e.phase==='RUNNING'&&e.endsAt&&now>=e.endsAt)await tx.query('INSERT INTO v2_paper_reports(experiment_id,period,data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[e.id,'cutoff',JSON.stringify({...this.comparison(e),scheduledEnd:e.endsAt,valuation:'Last observed conservative equity at/before cutoff, never a reconstructed future fill'})]);
     const events=this.kernel.apply(e,{quote,now,feed,prior,history:history.filter(c=>c.closeTime<quote.receivedAt),usedVolume:consumed});
     for(const event of events){await this.event(tx,e.id,event.kind,event.at,event.data,event.bot);if(event.kind==='fill')consumed+=Number((event.data as {fill:{quantity:string}}).fill.quantity);}
     for(const id of BOT_IDS){const b=e.bots[id],priorAsOf=Number(before.bots[id].lastMetrics?.asOf||0),snapshot=Math.floor(priorAsOf/60000)!==Math.floor(quote.receivedAt/60000)||events.some(v=>v.bot===id&&['fill','risk_limit'].includes(v.kind))||before.phase!==e.phase;if(b.lastMetrics&&snapshot)await tx.query('INSERT INTO v2_paper_equity(experiment_id,bot,at,data) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[e.id,id,quote.receivedAt,JSON.stringify(b.lastMetrics)]);}
     if(e.startedAt&&now<e.endsAt!){const day=Math.floor((now-e.startedAt)/DAY);for(const period of [`day-${day}`,`week-${Math.floor(day/7)}`])await tx.query('INSERT INTO v2_paper_reports(experiment_id,period,data) VALUES ($1,$2,$3) ON CONFLICT(experiment_id,period) DO UPDATE SET data=EXCLUDED.data',[e.id,period,JSON.stringify(this.comparison(e,quote,feed))]);}
     if(['ENDED','ENDED_WITH_DUST'].includes(e.phase))await tx.query('INSERT INTO v2_paper_reports(experiment_id,period,data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[e.id,'final',JSON.stringify(this.comparison(e,quote,feed))]);
    }catch(error){e=before;for(const id of BOT_IDS){e.bots[id].paused=true;e.bots[id].reason='STATE_INCONSISTENT';e.bots[id].s.account.entriesEnabled=false;}await this.event(tx,e.id,'state_inconsistent',now,{code:error instanceof Error?error.message:'UNKNOWN'});this.log.error(JSON.stringify({event:'state_inconsistent',experimentId:e.id}));}
    await this.save(tx,e);
   }
  });
 }
 comparison(e:Experiment,q?:Quote,feed?:FeedState){const rows=BOT_IDS.map(id=>({strategy:id,...(q&&feed?this.kernel.metrics(e,e.bots[id],q,feed):e.bots[id].lastMetrics??{capital:500,equity:500,available:500,reserved:0,btc:0,netPnl:0,returnPercent:0,closedTrades:0,openPositions:0,asOf:null}),paused:e.bots[id].paused,reason:e.bots[id].reason}));
  const p=e.passive,equity=p.lastEquity??500;
  return {experimentId:e.id,configHash:e.configHash,phase:e.phase,startedAt:e.startedAt,endsAt:e.endsAt,asOf:e.lastQuoteAt,bots:rows,assessment:{status:'DESCRIPTIVE_ONLY',insufficientSample:BOT_IDS.some(id=>e.bots[id].s.positions.filter(p=>p.status==='CLOSED').length<30),recommendation:'If sample is insufficient, observe 90 days or longer under an explicitly reviewed continuation that preserves capital/history; never auto-extend or declare a statistical winner after 30 days'},references:{USDT:{capital:500,equity:500,netPnl:0,exposure:0,drawdown:0,riskCompliant:true},BTC:{...p,capital:500,equity,netPnl:equity-500,returnPercent:(equity/500-1)*100,riskCompliant:false,reason:'Passive benchmark has no stop; exposure/drawdown may exceed bot limits'}}};
 }
 async view(id:string){const e=await this.get(id),feed=await this.feed();return {...this.comparison(e),config:e.config,authorization:e.authorization,feed,stale:!feed||this.clock()-feed.lastQuoteAt>2000||!!e.startedAt&&this.clock()-e.lastQuoteAt>2000};}
 async records(id:string,kind:string,bot?:BotId,limit=100,offset=0){await this.get(id);if(['positions','orders','fills','ledger','trades'].includes(kind)){const e=await this.get(id),items:object[]=[];for(const b of bot?[e.bots[bot]]:BOT_IDS.map(id=>e.bots[id]))items.push(...(kind==='trades'?b.s.positions.filter(p=>p.status==='CLOSED'):b.s[kind as 'positions'|'orders'|'fills'|'ledger']));return items.slice(offset,offset+limit);}
  if(kind==='equity')return this.db.query('SELECT bot,at,data FROM v2_paper_equity WHERE experiment_id=$1 AND ($2::text IS NULL OR bot=$2) ORDER BY at DESC,bot LIMIT $3 OFFSET $4',[id,bot??null,limit,offset]);
  if(kind==='reports')return this.db.query('SELECT period,data FROM v2_paper_reports WHERE experiment_id=$1 ORDER BY period',[id]);
  if(['metrics','capital','comparison','status'].includes(kind))return this.view(id);
  if(kind==='risk'){const e=await this.get(id);return {limits:e.config.limits,bots:BOT_IDS.map(id=>({id,hardHalt:e.bots[id].hardHalt,reason:e.bots[id].reason,paused:e.bots[id].paused}))};}
  return this.db.query("SELECT bot,kind,at,data FROM v2_paper_observations WHERE experiment_id=$1 AND ($2::text IS NULL OR bot=$2) AND ($5::text IS NULL OR kind=$5) ORDER BY id DESC LIMIT $3 OFFSET $4",[id,bot??null,limit,offset,kind==='signals'?'signal':kind==='rejections'?'order_rejected':null]);
 }
 async pauseUnsafe(reason:string,now=Date.now()){await this.db.transaction(async tx=>{const rows=await tx.query("SELECT state FROM v2_paper_experiments WHERE state->>'phase'='RUNNING' FOR UPDATE");for(const row of rows){const e=row.state as Experiment;if(BOT_IDS.every(id=>e.bots[id].paused))continue;for(const id of BOT_IDS)this.kernel.pause(e,id,reason);await this.event(tx,e.id,'feed_or_dependency_alert',now,{reason});await this.save(tx,e);}});}
}
