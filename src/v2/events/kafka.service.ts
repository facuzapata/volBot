import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Consumer, Producer, logLevel } from 'kafkajs';
import { DeliveryAttemptRow, OutboxEventRow } from '../persistence/entities';
import { StoreService } from '../persistence/store.service';
import {
  ExecutionEngineService,
  SignalDispatcherService,
  StrategyServiceV2,
} from '../trading/trading.services';
import { NotificationServiceV2 } from '../notifications/notification.service';
import { DomainEvent, Topic, TOPICS } from './contracts';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(KafkaService.name);
  private readonly kafka = new Kafka({
    clientId: 'volbot-v2',
    brokers: (process.env.V2_KAFKA_BROKERS || 'localhost:19092').split(','),
    logLevel: logLevel.NOTHING,
    connectionTimeout: 3000,
    requestTimeout: 10000,
    retry: { retries: 3 },
  });
  private producer?: Producer;
  private consumers: Consumer[] = [];
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private readonly namespace = process.env.V2_KAFKA_NAMESPACE || '';
  private publishing = false;
  private publishTask: Promise<void> = Promise.resolve();
  connected = false;
  constructor(
    private readonly store: StoreService,
    private readonly strategy: StrategyServiceV2,
    private readonly dispatcher: SignalDispatcherService,
    private readonly execution: ExecutionEngineService,
    private readonly notifications: NotificationServiceV2,
  ) {}
  onModuleInit(): void {
    void this.start();
  }
  private wire(topic: string): string {
    if (this.namespace && !/^[a-z0-9-]{1,50}$/.test(this.namespace))
      throw new Error('INVALID_KAFKA_NAMESPACE');
    return this.namespace ? `${this.namespace}.${topic}` : topic;
  }
  private async start(): Promise<void> {
    if (this.stopped) return;
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin.createTopics({
        waitForLeaders: true,
        topics: TOPICS.flatMap((topic) => [topic, `${topic}.dlq`]).map((topic) => ({
          topic: this.wire(topic),
          numPartitions: 3,
          replicationFactor: 1,
        })),
      });
      await admin.disconnect();
      this.producer = this.kafka.producer({
        idempotent: true,
        maxInFlightRequests: 1,
        retry: { retries: 5 },
      });
      await this.producer.connect();
      for (const group of ['trading', 'notifications']) {
        const consumer = this.kafka.consumer({
          groupId: `${this.namespace || 'volbot-v2'}-${group}`,
          sessionTimeout: 60000,
          heartbeatInterval: 3000,
        });
        this.consumers.push(consumer);
        await consumer.connect();
        const topics: Topic[] =
          group === 'notifications'
            ? ['notification.requested.v1']
            : ['market.candle.closed.v1', 'strategy.signal.created.v1', 'execution.command.v1'];
        await consumer.subscribe({ topics: topics.map((t) => this.wire(t)), fromBeginning: true });
        await consumer.run({
          partitionsConsumedConcurrently: 1,
          eachMessage: async ({ topic, message, heartbeat }) => {
            if (!message.value) return;
            let event: DomainEvent;
            try {
              event = JSON.parse(message.value.toString()) as DomainEvent;
              if (
                event.schemaVersion !== 1 ||
                this.wire(event.topic) !== topic ||
                !event.eventId ||
                !event.correlationId ||
                !event.payload ||
                !TOPICS.includes(event.topic)
              )
                throw new Error('INVALID_ENVELOPE');
            } catch {
              // Retain poison payload as base64, never log its contents; operator can inspect it locally.
              const originalTopic = this.namespace ? topic.slice(this.namespace.length + 1) : topic;
              await this.store.db.transaction(async (tx) =>
                this.store.emit(
                  tx,
                  `${originalTopic}.dlq` as Topic,
                  'invalid',
                  {
                    rawBase64: message.value!.toString('base64'),
                    code: 'INVALID_ENVELOPE',
                  } as never,
                  'invalid',
                ),
              );
              return;
            }
            await this.deliver(group, event, heartbeat);
          },
        });
      }
      this.connected = true;
      this.timer = setInterval(() => {
        if (!this.publishing) this.publishTask = this.publish();
      }, 250);
      this.log.log(JSON.stringify({ event: 'kafka_connected', mode: 'PAPER' }));
    } catch {
      await admin.disconnect().catch(() => undefined);
      await this.disconnect();
      this.log.warn(JSON.stringify({ event: 'kafka_unavailable', recovery: 'postgres_outbox' }));
      if (!this.stopped)
        this.retryTimer = setTimeout(() => {
          void this.start();
        }, 5000);
    }
  }
  private async deliver(
    group: string,
    event: DomainEvent,
    heartbeat: () => Promise<void>,
  ): Promise<void> {
    const id = `${group}:${event.eventId}`;
    while (!this.stopped) {
      const row = await this.store.db.getRepository(DeliveryAttemptRow).findOneBy({ id });
      if (row?.dead) return;
      const wait = Math.max(0, (row?.nextAttemptAt.getTime() || 0) - Date.now());
      if (wait) {
        await heartbeat();
        await new Promise((r) => setTimeout(r, Math.min(wait, 2000)));
        continue;
      }
      try {
        switch (event.topic) {
          case 'market.candle.closed.v1':
            await this.strategy.candle(event as DomainEvent<'market.candle.closed.v1'>);
            break;
          case 'strategy.signal.created.v1':
            await this.dispatcher.dispatch(event as DomainEvent<'strategy.signal.created.v1'>);
            break;
          case 'execution.command.v1':
            await this.execution.command(event as DomainEvent<'execution.command.v1'>);
            break;
          case 'notification.requested.v1':
            await this.notifications.deliver(event as DomainEvent<'notification.requested.v1'>);
            break;
        }
        return;
      } catch {
        const attempts = (row?.attempts || 0) + 1;
        await this.store.db.transaction(async (tx) => {
          await tx.upsert(
            DeliveryAttemptRow,
            {
              id,
              attempts,
              dead: attempts >= 5,
              nextAttemptAt: new Date(Date.now() + Math.min(30000, 500 * 2 ** attempts)),
            },
            ['id'],
          );
          if (attempts >= 5)
            await this.store.emit(
              tx,
              `${event.topic}.dlq` as Topic,
              event.key,
              { original: event, code: 'CONSUMER_FAILURE', consumer: group } as never,
              event.correlationId,
              `${id}:dlq`,
            );
        });
        this.log.warn(
          JSON.stringify({
            event: 'consumer_retry',
            eventId: event.eventId,
            correlationId: event.correlationId,
            attempts,
          }),
        );
        await heartbeat();
      }
    }
    throw new Error('WORKER_STOPPING');
  }
  private async publish(): Promise<void> {
    if (this.publishing || !this.producer || this.stopped) return;
    this.publishing = true;
    try {
      for (let i = 0; i < 25 && !this.stopped; i++) {
        const sent = await this.store.db.transaction(async (tx) => {
          const [lease] = (await tx.query(
            'SELECT pg_try_advisory_xact_lock(72821002) AS acquired',
          )) as { acquired: boolean }[];
          if (!lease.acquired) return false;
          const row = await tx
            .getRepository(OutboxEventRow)
            .createQueryBuilder('o')
            .where('o.publishedAt IS NULL')
            .orderBy('o.createdAt', 'ASC')
            .addOrderBy('o.id', 'ASC')
            .setLock('pessimistic_write')
            .setOnLocked('skip_locked')
            .getOne();
          if (!row) return false;
          await this.producer!.send({
            topic: this.wire(row.event.topic),
            acks: -1,
            messages: [
              {
                key: row.event.key,
                value: JSON.stringify(row.event),
                headers: { eventId: row.id, correlationId: row.event.correlationId },
              },
            ],
          });
          await tx.update(OutboxEventRow, row.id, { publishedAt: new Date() });
          return true;
        });
        if (!sent) break;
      }
    } catch {
      this.log.warn(JSON.stringify({ event: 'outbox_publish_deferred' }));
    } finally {
      this.publishing = false;
    }
  }
  private async disconnect(): Promise<void> {
    this.connected = false;
    clearInterval(this.timer);
    for (const c of this.consumers) await c.disconnect().catch(() => undefined);
    this.consumers = [];
    await this.producer?.disconnect().catch(() => undefined);
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.timer);
    await this.publishTask;
    await this.disconnect();
  }
}
