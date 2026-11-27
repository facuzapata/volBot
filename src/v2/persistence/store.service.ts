import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AccountState, CausalLiquidityBudget } from '../domain/model';
import { causalLiquidity } from '../execution/causal-liquidity';
import { telegramClosedNotice, telegramDynamicNotice, telegramFillNotice } from '../notifications/telegram-trades';
import { DomainEvent, Payloads, Topic } from '../events/contracts';
import {
  ExchangeOrderRow,
  FillRow,
  InboxEventRow,
  LedgerEntryRow,
  OrderIntentRow,
  OutboxEventRow,
  PositionRow,
  UserSignalDecisionRow,
  VirtualAccountRow,
  CandleRow,
} from './entities';

@Injectable()
export class StoreService {
  constructor(readonly db: DataSource) {}
  async emit<T extends Topic>(
    tx: EntityManager,
    topic: T,
    key: string,
    payload: Payloads[T],
    correlationId: string,
    eventId: string = randomUUID(),
  ): Promise<void> {
    const event: DomainEvent<T> = {
      eventId,
      topic,
      key,
      payload,
      correlationId,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
    };
    await tx
      .createQueryBuilder()
      .insert()
      .into(OutboxEventRow)
      .values({ id: eventId, event: event as DomainEvent })
      .orIgnore()
      .execute();
  }
  async once(
    tx: EntityManager,
    group: string,
    eventId: string,
    action: () => Promise<void>,
  ): Promise<boolean> {
    const id = `${group}:${eventId}`;
    // Database lock, not an in-process mutex: safe across worker replicas and restarts.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
    if (await tx.existsBy(InboxEventRow, { id })) return false;
    await action();
    await tx.insert(InboxEventRow, { id });
    return true;
  }
  async readAccount(accountId: string, tx: EntityManager = this.db.manager): Promise<AccountState> {
    const row = await tx.findOneByOrFail(VirtualAccountRow, { id: accountId });
    const [positions, orders, fills, ledger, decisions] = await Promise.all([
      tx.findBy(PositionRow, { accountId }),
      tx.findBy(ExchangeOrderRow, { accountId }),
      tx.findBy(FillRow, { accountId }),
      tx.findBy(LedgerEntryRow, { accountId }),
      tx.findBy(UserSignalDecisionRow, { accountId }),
    ]);
    return {
      account: row.data,
      positions: positions.map((x) => x.data).sort((a,b)=>a.openedAt-b.openedAt||a.id.localeCompare(b.id)),
      orders: orders.map((x) => x.data).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)),
      fills: fills.map((x) => x.data).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)),
      ledger: ledger.map((x) => x.data).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)),
      decisions: decisions.map((x) => x.data).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)),
    };
  }
  async accountTransaction(
    accountId: string,
    action: (s: AccountState, tx: EntityManager) => Promise<void>,
    liquidityMinute?:number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Always lock the shared symbol/minute before an account. Same transaction as fills/inbox.
      if(liquidityMinute!==undefined)await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`paper-liquidity:BTCUSDT:${liquidityMinute}`]);
      await tx.findOneOrFail(VirtualAccountRow, {
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      const state = await this.readAccount(accountId, tx);
      const before = JSON.parse(JSON.stringify(state)) as AccountState;
      await action(state, tx);
      await tx.update(VirtualAccountRow, accountId, { data: state.account });
      // Mutable rows are upserted only if changed; fills, decisions and ledger are append-only.
      for (const [kind, entity] of [
        ['positions', PositionRow],
        ['orders', ExchangeOrderRow],
      ] as const) {
        for (const item of state[kind]) {
          const old = before[kind].find((x) => x.id === item.id);
          if (JSON.stringify(old) !== JSON.stringify(item))
            await tx
              .getRepository(entity)
              .upsert({ id: item.id, accountId, data: item } as never, ['id']);
        }
      }
      for (const o of state.orders.filter((o) => !before.orders.some((x) => x.id === o.id))) {
        await tx.insert(OrderIntentRow, { id: o.id, accountId, data: { ...o } });
      }
      for (const [kind, entity] of [
        ['fills', FillRow],
        ['ledger', LedgerEntryRow],
        ['decisions', UserSignalDecisionRow],
      ] as const) {
        for (const item of state[kind].filter((x) => !before[kind].some((b) => b.id === x.id)))
          await tx.getRepository(entity).insert({ id: item.id, accountId, data: item } as never);
      }
      for (const o of state.orders.filter(
        (o) => JSON.stringify(o) !== JSON.stringify(before.orders.find((x) => x.id === o.id)),
      ))
        await this.emit(
          tx,
          'execution.order.updated.v1',
          accountId,
          { accountId, orderId: o.id, status: o.status },
          o.signalId,
        );
      for (const p of state.positions.filter(
        (p) => JSON.stringify(p) !== JSON.stringify(before.positions.find((x) => x.id === p.id)),
      )) {
        const previous = before.positions.find((x) => x.id === p.id);
        if (p.dynamicTakeProfit?.activatedAt !== undefined && previous?.dynamicTakeProfit?.activatedAt === undefined)
          await this.emit(tx, 'notification.requested.v1', state.account.userId, {
            userId: state.account.userId, kind: 'DYNAMIC_TP_ACTIVATED',
            ...telegramDynamicNotice(p, false),
          }, p.signalId, `${p.id}:dynamic-tp-activated`);
        if (p.dynamicTakeProfit?.exitRequestedAt !== undefined && previous?.dynamicTakeProfit?.exitRequestedAt === undefined)
          await this.emit(tx, 'notification.requested.v1', state.account.userId, {
            userId: state.account.userId, kind: 'DYNAMIC_TP_EXIT_REQUESTED',
            ...telegramDynamicNotice(p, true),
          }, p.signalId, `${p.id}:dynamic-tp-exit-requested`);
        await this.emit(
          tx,
          'position.updated.v1',
          accountId,
          { accountId, positionId: p.id, status: p.status, netPnl: p.realizedPnl },
          p.signalId,
        );
        if (
          p.status === 'CLOSED' &&
          before.positions.find((x) => x.id === p.id)?.status !== 'CLOSED'
        )
          await this.emit(
            tx,
            'notification.requested.v1',
            state.account.userId,
            {
              userId: state.account.userId,
              kind: Number(p.realizedPnl) >= 0 ? 'SIMULATED_PROFIT' : 'CONTROLLED_LOSS',
              ...telegramClosedNotice(p),
            },
            p.signalId,
          );
      }
      for (const f of state.fills.filter((f) => !before.fills.some((x) => x.id === f.id)))
        await this.emit(
          tx,
          'notification.requested.v1',
          state.account.userId,
          {
            userId: state.account.userId,
            kind: `SIMULATED_${f.side}`,
            ...telegramFillNotice(f, state.positions.find((p) => p.id === f.positionId), state.orders.find((o) => o.id === f.orderId)),
          },
          f.orderId,
        );
    });
  }
  async causalBudget(tx:EntityManager,openTime:number,rate:number):Promise<CausalLiquidityBudget>{
    const prior=await tx.findOneBy(CandleRow,{id:`1m:${openTime-60000}`});
    const [{used}]=await tx.query(`SELECT COALESCE(SUM((data->>'quantity')::numeric),0)::text AS used FROM v2_fills WHERE (data->>'at')::bigint >= $1 AND (data->>'at')::bigint < $2`,[openTime,openTime+60000]);
    return causalLiquidity(openTime,prior?.data,rate,Number(used));
  }
}
