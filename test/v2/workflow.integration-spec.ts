import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Kafka, logLevel } from 'kafkajs';
import {
  V2_ENTITIES,
  V2User,
  VirtualAccountRow,
  CandleRow,
  OutboxEventRow,
  BacktestRunRow,
} from '../../src/v2/persistence/entities';
import { InitialV21795172400000 } from '../../src/v2/persistence/migrations/1795172400000-InitialV2';
import { StrategyApprovals1795180000000 } from '../../src/v2/persistence/migrations/1795180000000-StrategyApprovals';
import { StrategyApprovalService } from '../../src/v2/strategy/approval.service';
import { STRATEGY_REVISION } from '../../src/v2/strategy/strategy-engine';
import { SIMULATOR_REVISION } from '../../src/v2/domain/model';
import { StoreService } from '../../src/v2/persistence/store.service';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import {
  ExecutionEngineService,
  PositionManagerService,
  RiskManagerService,
  SignalDispatcherService,
  StrategyServiceV2,
} from '../../src/v2/trading/trading.services';
import { StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';
import { RedisCacheService } from '../../src/v2/market/redis-cache.service';
import { NotificationServiceV2 } from '../../src/v2/notifications/notification.service';
import { KafkaService } from '../../src/v2/events/kafka.service';
import { bar, signal } from './fixtures';

const enabled = !!process.env.V2_TEST_DATABASE_URL && !!process.env.V2_TEST_KAFKA_BROKERS;
const suite = enabled ? describe : describe.skip;
suite(
  'Real V2 pipeline: outbox → Kafka → risk → paper → positions, restart and duplicate delivery',
  () => {
    it('buys and stops a virtual position without repeating fills after restart/re-delivery', async () => {
      const oldNamespace = process.env.V2_KAFKA_NAMESPACE;
      const oldBrokers = process.env.V2_KAFKA_BROKERS;
      const namespace = `test-${randomUUID()}`;
      process.env.V2_KAFKA_NAMESPACE = namespace;
      process.env.V2_KAFKA_BROKERS = process.env.V2_TEST_KAFKA_BROKERS;
      const url = new URL(process.env.V2_TEST_DATABASE_URL!);
      if (!/^\/volbot_v2_test(?:_[a-z0-9]+)*$/.test(url.pathname))
        throw new Error('Unsafe test database');
      const database = `volbot_v2_test_pipe_${randomUUID().replace(/-/g, '')}`;
      const admin = new DataSource({ type: 'postgres', url: url.toString() });
      await admin.initialize();
      await admin.query(`CREATE DATABASE "${database}"`);
      url.pathname = `/${database}`;
      const db = new DataSource({
        type: 'postgres',
        url: url.toString(),
        entities: V2_ENTITIES,
        migrations: [InitialV21795172400000, StrategyApprovals1795180000000],
        synchronize: false,
      });
      let bus: KafkaService | undefined;
      const waitFor = async (condition: () => Promise<boolean>) => {
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          if (await condition()) return;
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error('PIPELINE_TIMEOUT');
      };
      try {
        await db.initialize();
        await db.runMigrations();
        const store = new StoreService(db);
        const paper = new PaperExecutionAdapter();
        const engine = new StrategyEngine();
        const approvals = new StrategyApprovalService(db);
        const positions = new PositionManagerService(store, paper, engine, approvals);
        const strategy = new StrategyServiceV2(store, engine, positions, new SimulationSettings(), {
          get: async () => null,
          set: async () => undefined,
        } as unknown as RedisCacheService);
        const dispatcher = new SignalDispatcherService(db, new RiskManagerService(store, paper, approvals));
        const execution = new ExecutionEngineService(store, paper, approvals);
        const notifications = new NotificationServiceV2(store);
        const start = () => {
          const service = new KafkaService(store, strategy, dispatcher, execution, notifications);
          service.onModuleInit();
          return service;
        };
        const owner = await db
          .getRepository(V2User)
          .save({
            email: `${randomUUID()}@example.com`,
            name: 'Pipeline',
            passwordHash: 'not-a-login-hash',
            role: 'user',
            active: true,
            tokenVersion: 0,
          });
        const state = newAccount(randomUUID(), owner.id, 500, 1, 30);
        state.account.entriesEnabled = true;
        await db
          .getRepository(VirtualAccountRow)
          .insert({ id: state.account.id, userId: owner.id, data: state.account });
        const closedTime = Math.floor(Date.now() / 60000) * 60000 - 1;
        const entryBar = bar(closedTime - 59999);
        await db
          .getRepository(CandleRow)
          .insert({
            id: `1m:${entryBar.openTime}`,
            timeframe: '1m',
            openTime: entryBar.openTime,
            data: entryBar,
          });
        bus = start();
        await waitFor(async () => bus!.connected);
        const sig = signal(randomUUID(), closedTime);
        sig.strategyRevision = STRATEGY_REVISION;
        const reportId = randomUUID();
        await db.getRepository(BacktestRunRow).insert({ id:reportId, userId:owner.id, report:{ strategy:sig.strategy, strategyRevision:STRATEGY_REVISION, simulatorRevision:SIMULATOR_REVISION, options:{config:sig.config}, metrics:{ testFixture:true } } });
        const validation = await approvals.register(reportId, owner.id, 'Explicit integration fixture, not performance evidence');
        await approvals.decide(validation.id, owner.id, 'APPROVED', 'Approve isolated synthetic integration fixture only', { simulatorReviewed:true, outOfSampleReviewed:true, costsReviewed:true, riskReviewed:true });
        const eventId = randomUUID();
        await db.transaction((tx) =>
          store.emit(tx, 'strategy.signal.created.v1', 'BTCUSDT', { signal: sig }, sig.id, eventId),
        );
        await waitFor(async () => (await store.readAccount(state.account.id)).fills.length === 1);
        const open = await store.readAccount(state.account.id);
        expect(open.positions[0].status).toBe('OPEN');
        expect(Number(open.positions[0].stopLoss)).toBeGreaterThan(0);
        await bus.onModuleDestroy();
        bus = start();
        await waitFor(async () => bus!.connected);
        const original = await db.getRepository(OutboxEventRow).findOneByOrFail({ id: eventId });
        const producer = new Kafka({
          clientId: namespace,
          brokers: process.env.V2_TEST_KAFKA_BROKERS!.split(','),
          logLevel: logLevel.NOTHING,
        }).producer();
        await producer.connect();
        await producer.send({
          topic: `${namespace}.strategy.signal.created.v1`,
          messages: [{ key: 'BTCUSDT', value: JSON.stringify(original.event) }],
        });
        await producer.disconnect();
        const exitBar = bar(closedTime + 1, { low: 99000, high: 102000 });
        await db.transaction(async (tx) => {
          await tx.insert(CandleRow, {
            id: `1m:${exitBar.openTime}`,
            timeframe: '1m',
            openTime: exitBar.openTime,
            data: exitBar,
          });
          await store.emit(
            tx,
            'market.candle.closed.v1',
            'BTCUSDT:1m',
            { candle: exitBar, recovered: true },
            randomUUID(),
          );
        });
        await waitFor(
          async () => (await store.readAccount(state.account.id)).positions[0].status === 'CLOSED',
        );
        const result = await store.readAccount(state.account.id);
        expect(result.positions).toHaveLength(1);
        expect(result.fills).toHaveLength(2);
        expect(result.decisions).toHaveLength(1);
        expect(result.positions[0].exitReason).toBe('STOP_LOSS');
        expect(Number(result.account.available)).toBeCloseTo(
          500 + Number(result.positions[0].realizedPnl),
          8,
        );
        paper.assertInvariants(result);
      } finally {
        await bus?.onModuleDestroy();
        if (db.isInitialized) await db.destroy();
        // Only the randomly named database CREATED BY THIS TEST is removed.
        if (/^volbot_v2_test_pipe_[a-f0-9]{32}$/.test(database))
          await admin.query(`DROP DATABASE "${database}"`);
        await admin.destroy();
        if (oldNamespace === undefined) delete process.env.V2_KAFKA_NAMESPACE;
        else process.env.V2_KAFKA_NAMESPACE = oldNamespace;
        if (oldBrokers === undefined) delete process.env.V2_KAFKA_BROKERS;
        else process.env.V2_KAFKA_BROKERS = oldBrokers;
      }
    }, 180000);
  },
);
