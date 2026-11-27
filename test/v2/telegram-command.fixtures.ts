import { DomainEvent } from '../../src/v2/events/contracts';
import { AccountState } from '../../src/v2/domain/model';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { CandleRow, V2User, VirtualAccountRow } from '../../src/v2/persistence/entities';
import { StoreService } from '../../src/v2/persistence/store.service';
import { TelegramUpdate } from '../../src/v2/notifications/telegram.client';
import { bar, signal } from './fixtures';

export const commandBot = { id: 999999, username: 'VolBot_Test', is_bot: true };
export function commandUpdate(text: string, updateId = 1, chatId = 111): TelegramUpdate {
  return { update_id: updateId, message: { message_id: updateId, date: Math.floor(Date.now() / 1000),
    text, from: { id: chatId, is_bot: false }, chat: { id: chatId, type: 'private' } } };
}
export function commandHarness() {
  const users = [
    { id: 'u-a', active: true, telegramChatId: '111' },
    { id: 'u-b', active: true, telegramChatId: '222' },
  ] as V2User[];
  const states = new Map<string, AccountState>();
  for (const [index, user] of users.entries()) {
    const state = newAccount(`a-${index}`, user.id, 500, 5, 30);
    state.account.entriesEnabled = true;
    const sig = signal();
    const paper = new PaperExecutionAdapter();
    paper.reserve(state, sig, sig.candleTime);
    paper.execute(state, state.orders[0].id, 100000 + index * 10, sig.candleTime, 1);
    state.positions[0].strategy = index ? 'btc-v5' : 'btc-v6';
    states.set(state.account.id, state);
  }
  const latest = { data: bar(Math.floor(Date.now() / 60000) * 60000 - 60000) };
  const emitted: DomainEvent<'telegram.reply.requested.v1'>[] = [];
  const receipts = new Set<string>();
  const lease = { connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockImplementation(async (sql: string) => sql.includes('pg_try_advisory_lock') ? [{ acquired: true }] : []),
    release: jest.fn().mockResolvedValue(undefined), isReleased: false };
  const tx = {
    findOneByOrFail: async (entity: unknown, where: { id: string }) => {
      if (entity !== V2User) throw new Error('UNEXPECTED_ENTITY');
      const user = users.find((user) => user.id === where.id);
      if (!user) throw new Error('USER_NOT_FOUND');
      return user;
    },
    find: jest.fn(async (entity: unknown, options: { where: { telegramChatId: string; active: boolean }; take: number }) => {
      if (entity !== V2User || options.take !== 2 || options.where.active !== true) throw new Error('UNSCOPED_USER_LOOKUP');
      return users.filter((user) => user.active && user.telegramChatId === options.where.telegramChatId).slice(0, 2);
    }),
    findOneBy: jest.fn(async (entity: unknown, where: { userId: string }) => {
      if (entity !== VirtualAccountRow) throw new Error('UNEXPECTED_ENTITY');
      return [...states.values()].map((state) => ({ id: state.account.id, userId: state.account.userId }))
        .find((account) => account.userId === where.userId) ?? null;
    }),
    getRepository: (entity: unknown) => {
      if (entity !== CandleRow) throw new Error('UNEXPECTED_REPOSITORY');
      return { findOne: async () => latest };
    },
  };
  const readAccount = jest.fn(async (id: string) => {
    const state = states.get(id);
    if (!state) throw new Error('ACCOUNT_NOT_FOUND');
    return state;
  });
  const emit = jest.fn(async (_tx: unknown, topic: 'telegram.reply.requested.v1', key: string,
    payload: DomainEvent<'telegram.reply.requested.v1'>['payload'], correlationId: string, eventId: string) => {
    emitted.push({ topic, key, payload, correlationId, eventId, schemaVersion: 1, occurredAt: new Date().toISOString() });
  });
  const accountTransaction = jest.fn().mockRejectedValue(new Error('COMMAND_MUST_NOT_TRADE'));
  const db = {
    transaction: async (...args: unknown[]) => (args.at(-1) as (value: typeof tx) => Promise<unknown>)(tx),
    createQueryRunner: () => lease,
    query: jest.fn().mockResolvedValue([]),
  };
  const store = { db, readAccount, emit, accountTransaction,
    once: async (_tx: unknown, group: string, id: string, action: () => Promise<void>) => {
      const key = `${group}:${id}`;
      if (receipts.has(key)) return false;
      await action(); receipts.add(key); return true;
    },
  } as unknown as StoreService;
  return { store, users, states, latest, emitted, receipts, readAccount, accountTransaction, emit, tx, db, lease };
}
