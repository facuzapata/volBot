import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { simulationConfig, selectedStrategy } from '../config';
import { Candle, isOrderOpen, MarketSignal, isTargetOnlyPosition } from '../domain/model';
import { DomainEvent } from '../events/contracts';
import {
  EXECUTION_ADAPTER,
  ExecutionAdapter,
  PaperExecutionAdapter,
} from '../execution/paper-execution.adapter';
import {
  CandleRow,
  MarketSignalRow,
  StrategyVersionRow,
  V2User,
  VirtualAccountRow,
} from '../persistence/entities';
import { StoreService } from '../persistence/store.service';
import { MarketHistory, StrategyEngine } from '../strategy/strategy-engine';
import { SimulationSettings } from '../market/simulation-settings';
import { RedisCacheService } from '../market/redis-cache.service';
import { RiskPolicy } from '../risk/risk-policy';
import { INTERVAL_MS } from '../market/public-market.client';
import { StrategyApprovalService, configurationHash } from '../strategy/approval.service';
import { revisionFor, strategyConfiguration } from '../strategy/versions';
import { shouldPublishSignal } from '../strategy/signal-cadence';
import { BTC_V5_FIVE_MINUTE_HISTORY } from '../strategy/btc-v5.config';

export function alignedHistory(
  history: MarketHistory,
  at: number,
  timeframes: ReadonlyArray<keyof MarketHistory> = ['1m', '5m', '1h'],
): boolean {
  return timeframes.every(timeframe => {
    const expected = Math.floor((at + 1) / INTERVAL_MS[timeframe]) * INTERVAL_MS[timeframe] - 1;
    return history[timeframe].slice(-1)[0]?.closeTime === expected;
  });
}

@Injectable()
export class RiskManagerService {
  constructor(
    private readonly store: StoreService,
    private readonly policy: RiskPolicy,
    // Retained as an optional dependency while older worker test composition is migrated.
    private readonly _approvals?: StrategyApprovalService,
  ) {}
  async reserve(accountId: string, signal: MarketSignal, eventId: string): Promise<void> {
    await this.store.accountTransaction(accountId, async (s, tx) => {
      await this.store.once(tx, `dispatcher:${accountId}`, eventId, async () => {
        const owner = await tx.findOneByOrFail(V2User, { id: s.account.userId });
        if (!owner.active) s.account.entriesEnabled = false;
        const decision = this.policy.reserve(s, signal, Date.now());
        if (!decision.accepted) return;
        const order = s.orders.find((o) => o.signalId === signal.id && o.side === 'BUY')!;
        await this.store.emit(
          tx,
          'execution.command.v1',
          accountId,
          {
            accountId,
            orderId: order.id,
            signalTime: signal.candleTime,
            price: signal.referencePrice,
          },
          signal.id,
        );
        await this.store.emit(
          tx,
          'notification.requested.v1',
          s.account.userId,
          {
            userId: s.account.userId,
            kind: 'SIGNAL_DETECTED',
            text: `PAPER señal ${signal.strategy} BTCUSDT; reserva ${order.reservedQuote} USDT`,
          },
          signal.id,
        );
      });
    });
  }
}
@Injectable()
export class SignalDispatcherService {
  constructor(
    private readonly db: DataSource,
    private readonly risk: RiskManagerService,
  ) {}
  async dispatch(event: DomainEvent<'strategy.signal.created.v1'>): Promise<void> {
    const accounts = await this.db.getRepository(VirtualAccountRow).find();
    for (const account of accounts)
      await this.risk.reserve(account.id, event.payload.signal, event.eventId);
  }
}
@Injectable()
export class ExecutionEngineService {
  constructor(
    private readonly store: StoreService,
    @Inject(EXECUTION_ADAPTER) private readonly paper: ExecutionAdapter,
    private readonly _approvals?: StrategyApprovalService,
  ) {}
  async command(event: DomainEvent<'execution.command.v1'>): Promise<void> {
    const { accountId, orderId, price, signalTime } = event.payload;
    const now=Date.now(),minute=Math.floor(now/60000)*60000;
    await this.store.accountTransaction(accountId, async (s, tx) => {
      await this.store.once(tx, `execution:${accountId}`, event.eventId, async () => {
        const o = s.orders.find((x) => x.id === orderId);
        const p = o && s.positions.find((x) => x.id === o.positionId);
        if (!o || !p || !isOrderOpen(o)) return;
        if(o.side==='BUY'){
          const owner=await tx.findOneByOrFail(V2User,{id:s.account.userId});
          if(!owner.active||!s.account.entriesEnabled){o.deferredReason=owner.active?'ENTRIES_PAUSED':'OWNER_INACTIVE';return;}
        }
        if (Date.now() - signalTime > p.config.signalMaxAgeMs)
          this.paper.cancel(s, orderId, Date.now());
        else {
          const bar = await tx.findOneBy(CandleRow, { id: `1m:${minute-60000}` });
          const budget=await this.store.causalBudget(tx,minute,Math.min(p.config.participationRate,simulationConfig().participationRate));
          this.paper.execute(
            s,
            orderId,
            bar?.data.close??price,
            now,
            budget,
          );
        }
        if (o.status === 'REJECTED' || o.status === 'CANCELLED')
          await this.store.emit(
            tx,
            'notification.requested.v1',
            s.account.userId,
            {
              userId: s.account.userId,
              kind: 'EXECUTION_ERROR',
              text: `PAPER orden ${orderId}: ${o.status} ${o.rejection || ''}`,
            },
            event.correlationId,
          );
      });
    },minute);
  }
}
@Injectable()
export class PositionManagerService {
  constructor(
    private readonly store: StoreService,
    private readonly paper: PaperExecutionAdapter,
    private readonly engine: StrategyEngine,
    private readonly _approvals?: StrategyApprovalService,
  ) {}
  async price(event: DomainEvent<'market.price.observed.v1'>): Promise<void> {
    const observation = event.payload;
    const now = Date.now();
    if (observation.symbol !== 'BTCUSDT' || !Number.isSafeInteger(observation.at) ||
      now < observation.at || now - observation.at > 10000 ||
      !Number.isFinite(Number(observation.price)) || Number(observation.price) <= 0) return;
    // JSONB positions already persist the exit state; no account or inventory migration.
    const rows: { accountId: string }[] = await this.store.db.query(
      `SELECT DISTINCT "accountId" FROM v2_positions WHERE data->>'strategy' = 'btc-v6'
       AND data->>'executionMode' = 'PAPER' AND data ? 'dynamicTakeProfit'
       AND data->>'status' IN ('OPEN', 'CLOSING')`,
    );
    const minute = Math.floor(observation.at / 60000) * 60000;
    for (const { accountId } of rows.sort((a, b) => a.accountId.localeCompare(b.accountId))) {
      if (Date.now() - observation.at > 10000) return;
      await this.store.accountTransaction(accountId, async (s, tx) => {
        if (Date.now() - observation.at > 10000) return;
        const rate = Math.min(simulationConfig().participationRate,
          ...s.positions.filter((p) => p.dynamicTakeProfit).map((p) => p.config.participationRate));
        const budget = await this.store.causalBudget(tx, minute, rate);
        this.paper.onPrice(s, observation, budget);
      }, minute);
    }
  }
  async candle(
    event: DomainEvent<'market.candle.closed.v1'>,
    history: MarketHistory,
  ): Promise<void> {
    if (event.payload.candle.timeframe !== '1m') return;
    const accounts = await this.store.db.getRepository(VirtualAccountRow).find({order:{id:'ASC'}});
    for (const account of accounts)
      await this.store.accountTransaction(account.id, async (s, tx) => {
        await this.store.once(tx, `positions:${account.id}`, event.eventId, async () => {
        const owner=await tx.findOneByOrFail(V2User,{id:s.account.userId});
        const rate=Math.min(simulationConfig().participationRate,...s.positions.map(p=>p.config.participationRate));
        const budget=await this.store.causalBudget(tx,event.payload.candle.openTime,rate);
        this.paper.onCandle(s, event.payload.candle, this.engine.invalidated(history), () => s.account.entriesEnabled&&owner.active,budget);
        const v4Closed = s.positions
          .filter((p) => p.strategy === 'btc-v4' && p.status === 'CLOSED' && (p.closedAt ?? 0) > (s.account.v4StopHaltAt ?? 0))
          .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
        const v4StopStreak = v4Closed.findIndex((p) => p.exitReason !== 'STOP_LOSS');
        const consecutiveStops = v4StopStreak === -1 ? v4Closed.length : v4StopStreak;
        const v4MaxStops = v4Closed[0]?.config.btcV4?.maxConsecutiveStopLosses ?? 3;
        if (consecutiveStops >= v4MaxStops) {
          s.account.entriesEnabled = false;
          // A later manual resume starts a new observed stop sequence.
          s.account.v4StopHaltAt = event.payload.candle.closeTime;
        }
          for (const p of s.positions.filter(
            (p) => !isTargetOnlyPosition(p) && Number(p.quantity) > 0 && Number(p.stopLoss) <= 0,
          ))
            await this.store.emit(
              tx,
              'notification.requested.v1',
              s.account.userId,
              {
                userId: s.account.userId,
                kind: 'UNPROTECTED_POSITION',
                text: `PAPER posición sin protección ${p.id}`,
              },
              event.correlationId,
            );
        });
      },event.payload.candle.openTime);
  }
}
@Injectable()
export class StrategyServiceV2 {
  constructor(
    private readonly store: StoreService,
    private readonly engine: StrategyEngine,
    private readonly positions: PositionManagerService,
    private readonly settings: SimulationSettings,
    private readonly cache: RedisCacheService,
  ) {}
  price(event: DomainEvent<'market.price.observed.v1'>): Promise<void> {
    return this.positions.price(event);
  }
  async history(at: number): Promise<MarketHistory> {
    const cached = await this.cache.get<MarketHistory>(`history:${at}`);
    if (cached) return cached;
    const history: MarketHistory = { '1m': [], '5m': [], '1h': [] };
    for (const timeframe of ['1m', '5m', '1h'] as const) {
      const rows = await this.store.db
        .getRepository(CandleRow)
        .createQueryBuilder('c')
        .where('c.timeframe = :timeframe', { timeframe })
        .andWhere("(c.data->>'closeTime')::bigint <= :at", { at })
        .orderBy('c.openTime', 'DESC')
        .take(timeframe === '1h' ? 500 : timeframe === '5m' ? BTC_V5_FIVE_MINUTE_HISTORY : 100)
        .getMany();
      history[timeframe] = rows.reverse().map((x) => x.data);
    }
    // Do not cache a partial snapshot while the simultaneous 5m/1h close is in transit.
    if (alignedHistory(history, at)) await this.cache.set(`history:${at}`, history);
    return history;
  }
  private async activeStrategy(): Promise<ReturnType<typeof selectedStrategy>> {
    const rows = await this.store.db.getRepository(StrategyVersionRow).find();
    const active = rows.find((row) => row.state.active)?.id;
    if (active === 'legacy-v1' || active === 'btc-v2' || active === 'btc-v3' || active === 'btc-v4' || active === 'btc-v5' || active === 'btc-v6') return active;
    return selectedStrategy();
  }
  private configurationFor(strategy: ReturnType<typeof selectedStrategy>) {
    const config = strategyConfiguration(strategy, this.settings.config);
    if (strategy === 'btc-v3' && this.settings.btcV3Calibration)
      config.btcV3Calibration = this.settings.btcV3Calibration;
    return config;
  }
  async candle(event: DomainEvent<'market.candle.closed.v1'>): Promise<void> {
    const candle: Candle = event.payload.candle;
    if (candle.timeframe !== '1m') return;
    const history = await this.history(candle.closeTime);
    // Position supervision always runs, regardless of entry enablement or signal availability.
    await this.positions.candle(event, history);
    const strategy = await this.activeStrategy();
    const configuration = this.configurationFor(strategy);
    const requiredTimeframes = strategy === 'btc-v5' && configuration.btcV5?.trendMinutes === 15
      ? ['1m', '5m'] as const : strategy === 'btc-v4' ? ['1m', '1h'] as const : ['1m', '5m', '1h'] as const;
    const alignedRequired = strategy === 'btc-v6' ? ['1m', '5m'] as const : requiredTimeframes;
    if ((strategy === 'btc-v2'||strategy==='btc-v3'||strategy==='btc-v4'||strategy==='btc-v5'||strategy==='btc-v6') && !alignedHistory(history, candle.closeTime, alignedRequired)) {
      if (event.payload.recovered) return;
      throw new Error('WAITING_FOR_ALIGNED_CLOSED_TIMEFRAMES');
    }
    const signal = this.engine.evaluate(history, strategy, configuration);
    await this.store.db.transaction(async (tx) => {
      const row = await tx.findOneOrFail(StrategyVersionRow, {
        where: { id: strategy },
        lock: { mode: 'pessimistic_write' },
      });
      if (candle.closeTime <= row.state.lastCandleTime) return;
      await this.store.once(tx, `strategy:${strategy}`, event.eventId, async () => {
        const publish = shouldPublishSignal(strategy, !!signal, row.state.eligible);
        const assessment = this.engine.lastAssessment;
        row.state = { ...row.state, eligible: !!signal, lastCandleTime: candle.closeTime,
          lastDecision:this.engine.lastV3Assessment?{decision:this.engine.lastV3Assessment.decision,reason:this.engine.lastV3Assessment.reason,features:this.engine.lastV3Assessment.features}:assessment?{decision:assessment.eligible?'BUY':'NO_TRADE',reason:assessment.reason,features:{regime:assessment.regime,conditions:assessment.conditions,...(assessment.features??{})}}:undefined,
          configuration, configurationHash: configurationHash(strategy, revisionFor(strategy), configuration) };
        if (
          publish &&
          !event.payload.recovered &&
          Date.now() - candle.closeTime <= simulationConfig().signalMaxAgeMs
        ) {
          await tx.insert(MarketSignalRow, { id: signal!.id, data: signal! });
          await this.store.emit(
            tx,
            'strategy.signal.created.v1',
            'BTCUSDT',
            { signal: signal! },
            signal!.id,
          );
          row.state.lastSignalTime = candle.closeTime;
        }
        row.revision = revisionFor(strategy);
        await tx.save(row);
      });
    });
  }
}
