import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Kafka, logLevel } from 'kafkajs';
import {
  V2_ENTITIES,
  V2User,
  VirtualAccountRow,
  OutboxEventRow,
  BacktestRunRow,
} from '../../src/v2/persistence/entities';
import { InitialV21795172400000 } from '../../src/v2/persistence/migrations/1795172400000-InitialV2';
import { StoreService } from '../../src/v2/persistence/store.service';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { RiskManagerService, PositionManagerService } from '../../src/v2/trading/trading.services';
import { RiskPolicy } from '../../src/v2/risk/risk-policy';
import { StrategyEngine, STRATEGY_REVISION } from '../../src/v2/strategy/strategy-engine';
import { SIMULATOR_REVISION } from '../../src/v2/domain/model';
import { signal } from './fixtures';
import { bar } from './fixtures';
import { MarketDataService } from '../../src/v2/market/market-data.service';
import { PublicMarketClient } from '../../src/v2/market/public-market.client';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';
import { CandleRow } from '../../src/v2/persistence/entities';
import { StrategyApprovals1795180000000 } from '../../src/v2/persistence/migrations/1795180000000-StrategyApprovals';
import { StrategyApprovalService } from '../../src/v2/strategy/approval.service';
const researchPermissionFixture = { approved: async () => true } as unknown as StrategyApprovalService;

const connection = process.env.V2_TEST_DATABASE_URL;
const suite = connection ? describe : describe.skip;
suite('PostgreSQL integration: durable transactions and concurrent reservations', () => {
  let db: DataSource;
  let store: StoreService;
  let accountId: string;
  beforeAll(async () => {
    if (!/^\/volbot_v2_test(?:_[a-z0-9]+)*$/.test(new URL(connection!).pathname))
      throw new Error('Use a dedicated volbot_v2_test database');
    db = new DataSource({
      type: 'postgres',
      url: connection,
      entities: V2_ENTITIES,
      migrations: [InitialV21795172400000, StrategyApprovals1795180000000],
      synchronize: false,
    });
    await db.initialize();
    await db.runMigrations();
    store = new StoreService(db);
  }, 30000);
  beforeEach(async () => {
    const user = await db
      .getRepository(V2User)
      .save({
        email: `${randomUUID()}@example.com`,
        name: 'Integration',
        passwordHash: 'not-a-login-hash',
        role: 'user',
        active: true,
        tokenVersion: 0,
      });
    const s = newAccount(randomUUID(), user.id, 500, 1, 30);
    s.account.entriesEnabled = true;
    accountId = s.account.id;
    await db
      .getRepository(VirtualAccountRow)
      .insert({ id: accountId, userId: user.id, data: s.account });
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });
  it('atomically admits one of ten concurrent signals with a one-position limit', async () => {
    const risk = new RiskManagerService(store, new PaperExecutionAdapter(), researchPermissionFixture);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        risk.reserve(accountId, signal(`signal-${i}`, Date.now()), `event-${i}`),
      ),
    );
    const state = await store.readAccount(accountId);
    expect(state.positions).toHaveLength(1);
    expect(state.orders).toHaveLength(1);
    expect(Number(state.account.reserved)).toBe(30);
    expect(state.decisions.filter((d) => d.accepted)).toHaveLength(1);
  });
  it('deduplicates delivery and restores fills, accounting and protection using a fresh StoreService', async () => {
    const paper = new PaperExecutionAdapter();
    const risk = new RiskManagerService(store, paper, researchPermissionFixture);
    const sig = signal('restart', Date.now());
    await Promise.all([
      risk.reserve(accountId, sig, 'same-event'),
      risk.reserve(accountId, sig, 'same-event'),
    ]);
    await store.accountTransaction(accountId, async (s) => {
      paper.execute(s, s.orders[0].id, 100000, Date.now(), 1);
    });
    const restored = await new StoreService(db).readAccount(accountId);
    expect(restored.orders).toHaveLength(1);
    expect(restored.fills).toHaveLength(1);
    expect(restored.ledger.length).toBeGreaterThan(2);
    expect(Number(restored.positions[0].stopLoss)).toBeGreaterThan(0);
    paper.assertInvariants(restored);
  });
  it('rolls back account changes, inbox and outbox together on failure', async () => {
    const initial = await store.readAccount(accountId);
    await expect(
      store.accountTransaction(accountId, async (s, tx) => {
        s.account.available = '0';
        await store.once(tx, 'rollback-test', accountId, async () => {
          await store.emit(
            tx,
            'notification.requested.v1',
            accountId,
            { userId: s.account.userId, kind: 'TEST', text: 'test' },
            accountId,
            `${accountId}:rollback`,
          );
          throw new Error('INJECTED_FAILURE');
        });
      }),
    ).rejects.toThrow('INJECTED_FAILURE');
    expect((await store.readAccount(accountId)).account.available).toBe(initial.account.available);
    expect(await db.getRepository(OutboxEventRow).existsBy({ id: `${accountId}:rollback` })).toBe(
      false,
    );
  });
  it('keeps an outbox event durable without a Kafka connection', async () => {
    await db.transaction((tx) =>
      store.emit(
        tx,
        'notification.requested.v1',
        accountId,
        { userId: 'test', kind: 'TEST', text: 'test' },
        accountId,
        `${accountId}:offline`,
      ),
    );
    const event = await db
      .getRepository(OutboxEventRow)
      .findOneByOrFail({ id: `${accountId}:offline` });
    expect(event.publishedAt).toBeNull();
  });
  it('persists explicit approval, isolates configuration and revokes duplicate grants while exits continue', async () => {
    const approvals = new StrategyApprovalService(db);
    const paper = new PaperExecutionAdapter();
    const risk = new RiskManagerService(store, new RiskPolicy(), approvals);
    const owner = (await store.readAccount(accountId)).account.userId;
    const sig = { ...signal(randomUUID(), Date.now()), strategyRevision: STRATEGY_REVISION };
    sig.config = { ...sig.config, takeProfit: 0.01 + Math.random()*0.0001 };
    await risk.reserve(accountId, sig, randomUUID());
    expect((await store.readAccount(accountId)).orders).toHaveLength(0);
    expect((await store.readAccount(accountId)).decisions[0].reason).toBe('STRATEGY_NOT_APPROVED');
    const reportId = randomUUID();
    await db.getRepository(BacktestRunRow).insert({ id: reportId, userId: owner, report: { strategy: sig.strategy, strategyRevision: STRATEGY_REVISION, simulatorRevision: SIMULATOR_REVISION, options: { config: sig.config }, metrics: { syntheticFixtureOnly: true } } });
    const review = { simulatorReviewed:true,outOfSampleReviewed:true,costsReviewed:true,riskReviewed:true };
    const a = await approvals.register(reportId, owner, 'Isolated synthetic fixture, never production evidence');
    expect(await db.transaction(tx => approvals.approved(tx, sig))).toBe(false);
    await expect(approvals.decide(a.id,owner,'APPROVED','Reject incomplete human review fixture',{})).rejects.toThrow('Explicit human review');
    await approvals.decide(a.id,owner,'APPROVED','Explicit isolated synthetic test approval',review);
    expect(await db.transaction(tx => new StrategyApprovalService(db).approved(tx,sig))).toBe(true);
    expect(await db.transaction(tx => approvals.approved(tx,{...sig,config:{...sig.config,takeProfit:.012}}))).toBe(false);
    const b = await approvals.register(reportId,owner,'Second isolated synthetic fixture approval');
    await approvals.decide(b.id,owner,'APPROVED','Duplicate grant for revocation coverage',review);
    let acquiredId='',pendingId='';
    await store.accountTransaction(accountId,async s => {
      s.account.maxPositions=5;
      paper.reserve(s,{...sig,id:randomUUID()},sig.candleTime);
      paper.execute(s,s.orders[0].id,100000,sig.candleTime, 1);
      acquiredId=s.positions[0].id;
      paper.reserve(s,{...sig,id:randomUUID()},sig.candleTime);
      pendingId=s.orders[1].id;
    });
    await approvals.decide(a.id,owner,'REVOKED','Revoke all grants for this exact configuration',review);
    expect(await db.transaction(tx => approvals.approved(tx,sig))).toBe(false);
    const at = Math.floor((sig.candleTime+60000)/60000)*60000;
    const prior=bar(at-60000);
    await db.getRepository(CandleRow).upsert({id:`1m:${prior.openTime}`,timeframe:'1m',openTime:prior.openTime,data:prior},['id']);
    const manager = new PositionManagerService(store,paper,new StrategyEngine(),approvals);
    await manager.candle({eventId:randomUUID(),schemaVersion:1,topic:'market.candle.closed.v1',correlationId:randomUUID(),occurredAt:at,payload:{candle:bar(at,{low:99000})}} as never,{'1m':[],'5m':[],'1h':[]});
    const state = await store.readAccount(accountId);
    expect(state.positions.find(p=>p.id===acquiredId)?.exitReason).toBe('STOP_LOSS');
    expect(state.positions.find(p=>p.id===acquiredId)?.status).toBe('CLOSED');
    expect(state.orders.find(o=>o.id===pendingId)?.filledQuantity).toBe('0');
    expect(state.orders.find(o=>o.id===pendingId)?.status).toBe('PENDING');
    await expect(approvals.decide(a.id,owner,'APPROVED','Cannot resurrect a revoked validation',review)).rejects.toThrow('revoked');
  });
  it('deduplicates concurrent delivery of the same closed candle and emits one outbox event', async () => {
    let openTime = Math.floor(Date.now() / 60000) * 60000 - 3600000;
    while (await db.getRepository(CandleRow).existsBy({ id: `1m:${openTime}` })) openTime -= 60000;
    const candle = bar(openTime);
    const market = new MarketDataService(store, new PublicMarketClient(), new SimulationSettings());
    const before = await db.getRepository(OutboxEventRow).count();
    const results = await Promise.all([market.persist(candle, true, true), market.persist(candle, true, true)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.getRepository(CandleRow).countBy({ id: `1m:${openTime}` })).toBe(1);
    expect(await db.getRepository(OutboxEventRow).count()).toBe(before + 1);
  });
});

const kafkaSuite = process.env.V2_TEST_KAFKA_BROKERS ? describe : describe.skip;
kafkaSuite('Real Kafka transport on an isolated test topic', () => {
  it('transports a versioned envelope and preserves account key and event identity', async () => {
    const kafka = new Kafka({
      clientId: 'volbot-v2-integration',
      brokers: process.env.V2_TEST_KAFKA_BROKERS!.split(','),
      logLevel: logLevel.NOTHING,
    });
    const topic = `volbot-v2-test-${randomUUID()}`;
    const admin = kafka.admin();
    const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    const consumer = kafka.consumer({ groupId: topic });
    try {
      await admin.connect();
      await admin.createTopics({
        topics: [
          {
            topic,
            numPartitions: 1,
            replicationFactor: 1,
            configEntries: [{ name: 'retention.ms', value: '3600000' }],
          },
        ],
      });
      await producer.connect();
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: true });
      let done!: (value: { key: string; value: string }) => void;
      const received = new Promise<{ key: string; value: string }>((resolve) => {
        done = resolve;
      });
      await consumer.run({
        eachMessage: async ({ message }) => {
          done({ key: message.key!.toString(), value: message.value!.toString() });
        },
      });
      const envelope = {
        eventId: randomUUID(),
        schemaVersion: 1,
        correlationId: randomUUID(),
        topic: 'execution.command.v1',
        payload: { accountId: 'test-account', orderId: 'test-order' },
      };
      await producer.send({
        topic,
        acks: -1,
        messages: [{ key: 'test-account', value: JSON.stringify(envelope) }],
      });
      const result = await received;
      expect(result.key).toBe('test-account');
      expect(JSON.parse(result.value)).toEqual(envelope);
    } finally {
      await consumer.disconnect();
      await producer.disconnect();
      await admin.disconnect();
    }
  }, 60000);
});
