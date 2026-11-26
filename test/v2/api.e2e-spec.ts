import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { API_CONTROLLERS } from '../../src/v2/api/controllers';
import { ApiService } from '../../src/v2/api/api.service';
import { AuthGuardV2 } from '../../src/v2/api/auth';
import { setupApi } from '../../src/v2/api/setup';
import { StoreService } from '../../src/v2/persistence/store.service';
import { V2User, VirtualAccountRow } from '../../src/v2/persistence/entities';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { RedisCacheService } from '../../src/v2/market/redis-cache.service';
import { BacktestingEngine } from '../../src/v2/backtesting/backtesting.engine';
import { StrategyApprovalService } from '../../src/v2/strategy/approval.service';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';
import { BinanceCredentialsService } from '../../src/v2/execution/binance-credentials.service';
import { signal } from './fixtures';

describe('V2 HTTP contract with isolated persistence double', () => {
  let app: INestApplication;
  let token: string;
  let api: ApiService;
  let summaryState: ReturnType<typeof newAccount> | undefined;
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@example.com',
    name: 'A',
    role: 'user',
    active: true,
    tokenVersion: 0,
  };
  const state = newAccount('22222222-2222-4222-8222-222222222222', user.id);
  const db = {
    getRepository: (entity: unknown) => ({
      findOne: async () => null,
      findOneBy: async (where: { id?: string; userId?: string }) =>
        entity === V2User
          ? where.id === user.id
            ? user
            : null
          : entity === VirtualAccountRow && where.userId === user.id
            ? { id: state.account.id, userId: user.id, data: state.account }
            : null,
    }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test-only-secret-with-more-than-thirty-two-characters' }),
      ],
      controllers: API_CONTROLLERS,
      providers: [
        ApiService,
        SimulationSettings,
        { provide: StrategyApprovalService, useValue: { activeApproved: async () => false } },
        { provide: BinanceCredentialsService, useValue: { status: async () => ({ configured: false }) } },
        PaperExecutionAdapter,
        { provide: BacktestingEngine, useValue: new BacktestingEngine() },
        { provide: DataSource, useValue: db },
        {
          provide: StoreService,
          useValue: {
            db,
            readAccount: async () => summaryState ?? state,
            accountTransaction: async (_id: string, callback: (s: typeof state) => Promise<void>) =>
              callback(state),
          },
        },
        { provide: RedisCacheService, useValue: { ready: true } },
        { provide: APP_GUARD, useClass: AuthGuardV2 },
      ],
    }).compile();
    app = module.createNestApplication();
    setupApi(app);
    await app.init();
    api = module.get(ApiService);
    token = await module
      .get(JwtService)
      .signAsync(
        { sub: user.id, version: 0 },
        { issuer: 'volbot-v2', audience: 'volbot-v2-api', expiresIn: '15m' },
      );
  });
  afterAll(async () => {
    await app.close();
  });
  it('protects account routes and admin routes', async () => {
    await request(app.getHttpServer()).get('/api/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
  it.each([false, true])('serializes all summary fields from existing history (trades: %s)', async (withHistory) => {
    const history = newAccount(state.account.id, user.id);
    if (withHistory) {
      const paper = new PaperExecutionAdapter();
      history.account.entriesEnabled = true;
      for (const [index, exitPrice] of [101000, 100100, 100000].entries()) {
        const sig = signal(`summary-${index}`, signal().candleTime + index * 60000);
        if (index === 2) sig.config.feeRate = 0;
        expect(paper.reserve(history, sig, sig.candleTime).accepted).toBe(true);
        const buy = history.orders[history.orders.length - 1];
        paper.execute(history, buy.id, 100000, sig.candleTime, 1);
        const exit = paper.requestExit(history, buy.positionId, sig.candleTime + 1, 'USER_CLOSE')!;
        paper.execute(history, exit.id, exitPrice, sig.candleTime + 2, 1);
        expect(history.positions[index].status).toBe('CLOSED');
      }
      history.ledger.push({ id: 'unassigned', orderId: '', positionId: '', asset: 'BTC', availableDelta: '0.00000001', reservedDelta: '0', reason: 'ADJUSTMENT', at: 0 });
    }
    summaryState = history;
    const before = JSON.stringify(history);
    try {
      const stats = await request(app.getHttpServer()).get('/api/me/stats').set('Authorization', `Bearer ${token}`).expect(200);
      expect(stats.body).toEqual(await api.stats(user.id));
      expect(stats.body).toMatchObject({
        closedTrades: withHistory ? 3 : 0, winningTrades: withHistory ? 1 : 0,
        losingTrades: withHistory ? 1 : 0, breakevenTrades: withHistory ? 1 : 0,
      });
      expect(stats.body.winningTrades + stats.body.losingTrades + stats.body.breakevenTrades).toBe(stats.body.closedTrades);
      const balance = await request(app.getHttpServer()).get('/api/me/balance').set('Authorization', `Bearer ${token}`).expect(200);
      expect(balance.body).toEqual(await api.balance(user.id));
      expect(balance.body).toMatchObject({ totalBTC: withHistory ? '0.00000001' : '0', assignedBTC: '0', unassignedBTC: withHistory ? '0.00000001' : '0', dustBTC: '0' });
      expect(JSON.stringify(history)).toBe(before);
    } finally {
      summaryState = undefined;
    }
  });
  it('enables entries without a separate strategy-approval workflow', async () => {
    await request(app.getHttpServer()).patch('/api/me/entries').set('Authorization', `Bearer ${token}`).send({ enabled:true }).expect(200);
    expect(state.account.entriesEnabled).toBe(true);
  });
  it('rejects mass assignment and strategy overrides at the HTTP boundary', async () => {
    await request(app.getHttpServer())
      .patch('/api/me/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin', maxPositions: 10 })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/me/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ profitMargin: 0.1 })
      .expect(400);
    expect(state.account.maxPositions).toBe(5);
  });
  it('updates only the two allowed limits', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/me/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxPositions: 3, usdtPerTrade: 20 })
      .expect(200);
    expect(response.body).toEqual({ maxPositions: 3, usdtPerTrade: '20', entriesEnabled: true, executionMode: 'PAPER' });
  });
  it('does not return secrets and hides another account position', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('credentials');
    await request(app.getHttpServer())
      .post('/api/me/positions/other-account-position/close')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
  it('revokes a token when user status/version changes', async () => {
    user.tokenVersion++;
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    user.tokenVersion--;
    user.active = false;
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    user.active = true;
  });
  it('publishes Swagger JSON without exposing an order-submission route', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(response.body.paths).toHaveProperty('/api/me/config');
    expect(response.body.paths).toHaveProperty('/api/backtests');
    expect(response.body.paths).toHaveProperty('/api/me/exchange-connection');
    expect(JSON.stringify(response.body.paths)).not.toMatch(/\/live\/orders/);
  });
  it('documents BTC-V3 without allowing clients to upload calibration or approval bypasses',async()=>{
    const response=await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(response.body.components.schemas.BacktestDto.properties.strategy.enum).toContain('btc-v3');
    expect(response.body.components.schemas.BacktestDto.properties).toHaveProperty('btcV3');
    await request(app.getHttpServer()).post('/api/backtests').set('Authorization',`Bearer ${token}`).send({strategy:'btc-v3',initialCapital:500,maxPositions:5,usdtPerTrade:30,candles:[],btcV3Calibration:{approved:true}}).expect(400);
    await request(app.getHttpServer()).post('/api/backtests').set('Authorization',`Bearer ${token}`).send({strategy:'btc-v3',initialCapital:500,maxPositions:5,usdtPerTrade:30,candles:[],btcV3:{minPullbackAtr:5,maxPullbackAtr:1}}).expect(400);
  });
});
