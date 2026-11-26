import { DomainEvent } from '../../src/v2/events/contracts';
import { NotificationServiceV2, telegramStatus } from '../../src/v2/notifications/notification.service';
import { StoreService } from '../../src/v2/persistence/store.service';
import { newAccount } from '../../src/v2/execution/paper-execution.adapter';

describe('Telegram configuration and delivery', () => {
  const originalEnabled = process.env.V2_TELEGRAM_ENABLED;
  const originalToken = process.env.V2_TELEGRAM_BOT_TOKEN;
  const user = { active: true, telegramChatId: 'test-chat' };
  const event: DomainEvent<'notification.requested.v1'> = {
    eventId: 'notification-1', topic: 'notification.requested.v1', key: 'u', schemaVersion: 1,
    correlationId: 'trade', occurredAt: '2026-11-26T00:00:00Z',
    payload: { userId: 'u', kind: 'SIMULATED_BUY', text: 'PAPER compra' },
  };
  function service(owner = user) {
    const committed = new Set<string>();
    const emit = jest.fn();
    const tx = { findOneByOrFail: async () => owner };
    const store = {
      db: { transaction: async (action: (value: typeof tx) => Promise<void>) => action(tx) },
      once: async (_tx: unknown, group: string, id: string, action: () => Promise<void>) => {
        const key = `${group}:${id}`;
        if (committed.has(key)) return false;
        await action();
        committed.add(key);
        return true;
      }, emit,
    };
    return { notifications: new NotificationServiceV2(store as unknown as StoreService), committed };
  }
  beforeEach(() => {
    process.env.V2_TELEGRAM_ENABLED = 'true';
    process.env.V2_TELEGRAM_BOT_TOKEN = 'test-only-token';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalEnabled === undefined) delete process.env.V2_TELEGRAM_ENABLED;
    else process.env.V2_TELEGRAM_ENABLED = originalEnabled;
    if (originalToken === undefined) delete process.env.V2_TELEGRAM_BOT_TOKEN;
    else process.env.V2_TELEGRAM_BOT_TOKEN = originalToken;
  });
  it('reports readiness without returning token or chat identifiers', () => {
    expect(telegramStatus(user)).toEqual({ enabled: true, botConfigured: true, chatLinked: true, ready: true });
    expect(JSON.stringify(telegramStatus(user))).not.toMatch(/test-chat|test-only-token/);
    expect(telegramStatus({ ...user, active: false }).ready).toBe(false);
    expect(telegramStatus({ ...user, telegramChatId: null }).ready).toBe(false);
  });
  it('delivers a successful message once for a committed event', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    const { notifications } = service();
    await notifications.deliver(event);
    await notifications.deliver(event);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ chat_id: 'test-chat', text: 'PAPER compra' });
  });
  it('does not mark an HTTP-200 Telegram error as delivered and permits retry', async () => {
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    const { notifications, committed } = service();
    await expect(notifications.deliver(event)).rejects.toThrow('TELEGRAM_DELIVERY_FAILED');
    expect(committed.size).toBe(0);
    await notifications.deliver(event);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('carries Telegram retry_after to the delivery scheduler', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false,
      json: async () => ({ ok: false, parameters: { retry_after: 45 } }) } as Response);
    await expect(service().notifications.deliver(event)).rejects.toMatchObject({
      name: 'Error', message: 'TELEGRAM_DELIVERY_FAILED', retryAfterMs: 45000,
    });
  });
  it.each(['disabled', 'no-chat', 'inactive'])('does not send when %s', async (mode) => {
    const fetch = jest.spyOn(global, 'fetch');
    if (mode === 'disabled') process.env.V2_TELEGRAM_ENABLED = 'false';
    const owner = { ...user, active: mode !== 'inactive', telegramChatId: mode === 'no-chat' ? '' : user.telegramChatId };
    await service(owner).notifications.deliver(event);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails safely when enabled but the bot token is missing', async () => {
    delete process.env.V2_TELEGRAM_BOT_TOKEN;
    const fetch = jest.spyOn(global, 'fetch');
    await expect(service().notifications.deliver(event)).rejects.toThrow('TELEGRAM_NOT_CONFIGURED');
    expect(fetch).not.toHaveBeenCalled();
    expect(telegramStatus(user).ready).toBe(false);
  });
  it('summarizes the last complete UTC day, including its final minute', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-26T00:00:30Z'));
    const state = newAccount('a', 'u');
    state.positions = [
      { status: 'CLOSED', closedAt: Date.parse('2026-11-25T23:59:59Z'), realizedPnl: '0.5' },
      { status: 'CLOSED', closedAt: Date.parse('2026-11-26T00:00:01Z'), realizedPnl: '2' },
    ] as typeof state.positions;
    const emit = jest.fn();
    const tx = {};
    const store = {
      db: { getRepository: () => ({ find: async () => [{ id: 'a', userId: 'u' }] }),
        transaction: async (action: (value: object) => Promise<void>) => action(tx) },
      once: async (_tx: unknown, _group: string, _id: string, action: () => Promise<void>) => action(),
      readAccount: async () => state, emit,
    };
    await new NotificationServiceV2(store as unknown as StoreService).dailySummary();
    expect(emit).toHaveBeenCalledWith(tx, 'notification.requested.v1', 'u',
      { userId: 'u', kind: 'DAILY_SUMMARY', text: 'PAPER resumen UTC 2026-11-25: 1 cierres, neto 0.5000 USDT' }, 'daily:2026-11-25');
  });
});
