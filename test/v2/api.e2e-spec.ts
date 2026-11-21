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

describe('V2 HTTP contract with isolated persistence double', () => {
  let app: INestApplication;
  let token: string;
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
        PaperExecutionAdapter,
        { provide: BacktestingEngine, useValue: new BacktestingEngine() },
        { provide: DataSource, useValue: db },
        {
          provide: StoreService,
          useValue: {
            db,
            readAccount: async () => state,
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
  it('rejects enabling PAPER entries without an explicit strategy approval', async () => {
    await request(app.getHttpServer()).patch('/api/me/entries').set('Authorization', `Bearer ${token}`).send({ enabled:true }).expect(409);
    expect(state.account.entriesEnabled).toBe(false);
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
    expect(response.body).toEqual({ maxPositions: 3, usdtPerTrade: '20', entriesEnabled: false });
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
  it('publishes Swagger JSON and has no live trading route', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(response.body.paths).toHaveProperty('/api/me/config');
    expect(response.body.paths).toHaveProperty('/api/backtests');
    expect(JSON.stringify(response.body.paths)).not.toMatch(/binance|\/live\/orders/);
  });
  it('documents BTC-V3 without allowing clients to upload calibration or approval bypasses',async()=>{
    const response=await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(response.body.components.schemas.BacktestDto.properties.strategy.enum).toContain('btc-v3');
    expect(response.body.components.schemas.BacktestDto.properties).toHaveProperty('btcV3');
    await request(app.getHttpServer()).post('/api/backtests').set('Authorization',`Bearer ${token}`).send({strategy:'btc-v3',initialCapital:500,maxPositions:5,usdtPerTrade:30,candles:[],btcV3Calibration:{approved:true}}).expect(400);
    await request(app.getHttpServer()).post('/api/backtests').set('Authorization',`Bearer ${token}`).send({strategy:'btc-v3',initialCapital:500,maxPositions:5,usdtPerTrade:30,candles:[],btcV3:{minPullbackAtr:5,maxPullbackAtr:1}}).expect(400);
  });
});
