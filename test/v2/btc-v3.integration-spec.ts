import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request = require('supertest');
import { V2_ENTITIES, V2User, VirtualAccountRow, CandleRow, BacktestRunRow, StrategyVersionRow } from '../../src/v2/persistence/entities';
import { InitialV21795172400000 } from '../../src/v2/persistence/migrations/1795172400000-InitialV2';
import { StrategyApprovals1795180000000 } from '../../src/v2/persistence/migrations/1795180000000-StrategyApprovals';
import { BtcV31795185000000 } from '../../src/v2/persistence/migrations/1795185000000-BtcV3';
import { StoreService } from '../../src/v2/persistence/store.service';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { BacktestingEngine } from '../../src/v2/backtesting/backtesting.engine';
import { StrategyApprovalService } from '../../src/v2/strategy/approval.service';
import { StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { strategyConfiguration, revisionFor } from '../../src/v2/strategy/versions';
import { PositionManagerService, ExecutionEngineService } from '../../src/v2/trading/trading.services';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';
import { RedisCacheService } from '../../src/v2/market/redis-cache.service';
import { ApiService } from '../../src/v2/api/api.service';
import { API_CONTROLLERS } from '../../src/v2/api/controllers';
import { AuthGuardV2 } from '../../src/v2/api/auth';
import { setupApi } from '../../src/v2/api/setup';
import { bar, signal } from './fixtures';

const suite=process.env.V2_TEST_DATABASE_URL?describe:describe.skip;
suite('BTC-V3 isolated PostgreSQL and real HTTP contracts',()=>{
  let db:DataSource,admin:DataSource,store:StoreService,app:INestApplication,jwt:JwtService;
  const name=`volbot_v2_test_v3_${randomUUID().replace(/-/g,'')}`;
  const paper=new PaperExecutionAdapter();let sequence=0;
  beforeAll(async()=>{
    const url=new URL(process.env.V2_TEST_DATABASE_URL!);if(!/^\/volbot_v2_test(?:_[a-z0-9]+)*$/.test(url.pathname))throw new Error('Unsafe test DB');
    admin=new DataSource({type:'postgres',url:url.toString()});await admin.initialize();await admin.query(`CREATE DATABASE "${name}"`);url.pathname='/'+name;
    db=new DataSource({type:'postgres',url:url.toString(),entities:V2_ENTITIES,migrations:[InitialV21795172400000,StrategyApprovals1795180000000,BtcV31795185000000],synchronize:false});await db.initialize();await db.runMigrations();store=new StoreService(db);
    const module=await Test.createTestingModule({imports:[JwtModule.register({secret:'isolated-v3-test-secret-more-than-thirty-two-chars'})],controllers:API_CONTROLLERS,providers:[ApiService,SimulationSettings,PaperExecutionAdapter,StrategyApprovalService,{provide:StoreService,useValue:store},{provide:DataSource,useValue:db},{provide:BacktestingEngine,useValue:new BacktestingEngine()},{provide:RedisCacheService,useValue:{ready:true}},{provide:APP_GUARD,useClass:AuthGuardV2}]}).compile();
    app=module.createNestApplication();setupApi(app);await app.init();jwt=module.get(JwtService);
  },30000);
  afterAll(async()=>{if(app)await app.close();if(db?.isInitialized)await db.destroy();if(admin?.isInitialized){if(!/^volbot_v2_test_v3_[a-f0-9]+$/.test(name))throw new Error('Unsafe cleanup');await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.destroy()}});
  const account=async(role:'user'|'admin'='user')=>{const user=await db.getRepository(V2User).save({email:`${randomUUID()}@example.com`,name:'Isolated fixture',role,active:true,passwordHash:'not-a-login-hash',tokenVersion:0});const s=newAccount(randomUUID(),user.id,500,5,30);await db.getRepository(VirtualAccountRow).insert({id:s.account.id,userId:user.id,data:s.account});return{user,state:s}};
  const minute=()=>bar(Date.UTC(2025,0,1)+(++sequence)*600000);
  it('serializes shared symbol/minute capacity across accounts and fresh StoreService instances',async()=>{
    const a=await account(),b=await account(),c=minute(),prior=bar(c.openTime-60000,{volume:.2});
    await db.getRepository(CandleRow).insert({id:`1m:${prior.openTime}`,timeframe:'1m',openTime:prior.openTime,data:prior});
    for(const x of[a,b])await store.accountTransaction(x.state.account.id,async s=>{s.account.entriesEnabled=true;paper.reserve(s,signal(randomUUID(),c.openTime-1),c.openTime-1)});
    const fill=async(id:string)=>store.accountTransaction(id,async(s,tx)=>{const budget=await store.causalBudget(tx,c.openTime,.001);paper.execute(s,s.orders[0].id,c.open,c.openTime,budget,'OPEN')},c.openTime);
    await Promise.all([fill(a.state.account.id),fill(b.state.account.id)]);
    const states=await Promise.all([store.readAccount(a.state.account.id),store.readAccount(b.state.account.id)]);
    expect(states.flatMap(s=>s.fills).reduce((n,f)=>n+Number(f.quantity),0)).toBe(.0002);
    const fresh=new StoreService(db);await fresh.accountTransaction(b.state.account.id,async(s,tx)=>{const budget=await fresh.causalBudget(tx,c.openTime,.001);expect(budget.used).toBe(.0002);paper.execute(s,s.orders[0].id,c.open,c.openTime,budget,'OPEN')},c.openTime);
    expect((await fresh.readAccount(a.state.account.id)).fills.length+(await fresh.readAccount(b.state.account.id)).fills.length).toBe(1);
  });
  it('keeps exits active after pause/restart with durable fill-time risk metadata',async()=>{
    const a=await account(),c=minute(),prior=bar(c.openTime-60000);await db.getRepository(CandleRow).insert({id:`1m:${prior.openTime}`,timeframe:'1m',openTime:prior.openTime,data:prior});
    await store.accountTransaction(a.state.account.id,async s=>{s.account.entriesEnabled=true;const sig=signal(randomUUID(),c.openTime-1);paper.reserve(s,sig,c.openTime-1);paper.execute(s,s.orders[0].id,c.open,c.openTime-1,1);s.account.entriesEnabled=false});
    const fresh=new StoreService(db),before=await fresh.readAccount(a.state.account.id);expect(before.positions[0].executionRisk?.accepted).toBe(true);
    const manager=new PositionManagerService(fresh,paper,new StrategyEngine(),new StrategyApprovalService(db));
    await manager.candle({eventId:randomUUID(),schemaVersion:1,topic:'market.candle.closed.v1',payload:{candle:{...c,low:99000}},correlationId:randomUUID()} as never,{'1m':[],'5m':[],'1h':[]});
    const after=await fresh.readAccount(a.state.account.id);expect(after.positions[0].status).toBe('CLOSED');expect(after.account.entriesEnabled).toBe(false);expect(after.fills).toHaveLength(2);
  });
  it('defers an already queued BUY after the account is paused',async()=>{
    const a=await account(),now=Date.now();let orderId='';
    await store.accountTransaction(a.state.account.id,async s=>{s.account.entriesEnabled=true;paper.reserve(s,signal(randomUUID(),now),now);orderId=s.orders[0].id;s.account.entriesEnabled=false});
    const service=new ExecutionEngineService(store,paper,new StrategyApprovalService(db));
    await service.command({eventId:randomUUID(),schemaVersion:1,topic:'execution.command.v1',payload:{accountId:a.state.account.id,orderId,price:100000,signalTime:now},correlationId:randomUUID()} as never);
    const state=await store.readAccount(a.state.account.id);expect(state.fills).toHaveLength(0);expect(state.orders[0].deferredReason).toBe('ENTRIES_PAUSED');expect(Number(state.account.reserved)).toBe(30);
  });
  it('persists BTC-V3 configuration/backtest over HTTP and never approves zero-trade reports automatically',async()=>{
    const a=await account('admin'),token=await jwt.signAsync({sub:a.user.id,version:0},{issuer:'volbot-v2',audience:'volbot-v2-api',expiresIn:'15m'}),auth=`Bearer ${token}`;
    const candles=Array.from({length:60},(_,i)=>bar(Date.UTC(2024,0,1)+i*60000));
    const response=await request(app.getHttpServer()).post('/api/backtests').set('Authorization',auth).send({strategy:'btc-v3',initialCapital:500,maxPositions:5,usdtPerTrade:30,btcV3:{...strategyConfiguration('btc-v3').btcV3},candles}).expect(201);
    expect(response.body.report.strategyRevision).toBe(revisionFor('btc-v3'));expect(response.body.report.metrics.closedTrades).toBe(0);expect(response.body.report.options.config.btcV3.horizonMinutes).toBe(60);
    expect(await db.getRepository(BacktestRunRow).existsBy({id:response.body.id})).toBe(true);
    const registered=await request(app.getHttpServer()).post('/api/admin/strategy-validations').set('Authorization',auth).send({reportId:response.body.id,rationale:'Register only this isolated zero-trade test evaluation'}).expect(201);expect(registered.body.status).toBe('PENDING');
    await request(app.getHttpServer()).patch('/api/me/entries').set('Authorization',auth).send({enabled:true}).expect(409);
    const versions=await request(app.getHttpServer()).get('/api/strategies').set('Authorization',auth).expect(200);expect(versions.body.find((v:{id:string})=>v.id==='btc-v3').approvalStatus).toBe('PENDING');
    expect((await store.readAccount(a.state.account.id)).account.entriesEnabled).toBe(false);expect(await db.getRepository(StrategyVersionRow).existsBy({id:'btc-v3'})).toBe(true);
  });
});
