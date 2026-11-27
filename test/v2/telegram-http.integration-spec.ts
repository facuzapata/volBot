import { TelegramClient } from '../../src/v2/notifications/telegram.client';
import { TelegramCommandsService } from '../../src/v2/notifications/telegram-commands.service';
import { NotificationServiceV2 } from '../../src/v2/notifications/notification.service';
import { commandHarness, commandUpdate } from './telegram-command.fixtures';
import { telegramFillNotice } from '../../src/v2/notifications/telegram-trades';
import { PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';

const origin = process.env.TELEGRAM_SIMULATION_ORIGIN;
const suite = origin ? describe : describe.skip;
suite('Telegram command pipeline against a local HTTP simulation (no real Telegram)', () => {
  const previousToken = process.env.V2_TELEGRAM_BOT_TOKEN;
  const previousEnabled = process.env.V2_TELEGRAM_ENABLED;
  const previousCommands = process.env.V2_TELEGRAM_COMMANDS_ENABLED;
  const url = origin ?? 'http://127.0.0.1:4017/telegram';
  const control = async (body: object) => {
    const response = await fetch(`${url}/__control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('SIMULATION_CONTROL_FAILED');
  };
  const serverState = async () => (await (await fetch(`${url}/__state`)).json()) as {
    messages: { chat_id: string; text: string; parse_mode?: string }[]; requests: { method: string; body: { offset?: number } }[];
  };
  beforeAll(() => {
    const endpoint = new URL(url);
    if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Local simulation required');
    process.env.V2_TELEGRAM_BOT_TOKEN = '999999:SIMULATION_TOKEN';
    process.env.V2_TELEGRAM_ENABLED = 'true';
    process.env.V2_TELEGRAM_COMMANDS_ENABLED = 'true';
  });
  afterAll(() => {
    for (const [key, value] of [['V2_TELEGRAM_BOT_TOKEN', previousToken], ['V2_TELEGRAM_ENABLED', previousEnabled],
      ['V2_TELEGRAM_COMMANDS_ENABLED', previousCommands]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  });
  it('receives a private command, commits its reply, sends only that account and acknowledges the offset', async () => {
    const h = commandHarness();
    await control({ updates: [commandUpdate('/abiertas', 40)] });
    const client = new TelegramClient(url);
    const receiver = new TelegramCommandsService(h.store, client);
    receiver.onModuleInit();
    try {
      const until = Date.now() + 4000;
      while (!h.emitted.length && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
      expect(h.emitted).toHaveLength(1);
      await new NotificationServiceV2(h.store, client).reply(h.emitted[0]);
      const untilAck = Date.now() + 2000;
      while (!(await serverState()).requests.some((r) => r.method === 'getUpdates' && r.body.offset === 41) && Date.now() < untilAck)
        await new Promise((resolve) => setTimeout(resolve, 25));
      const state = await serverState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].chat_id).toBe('111');
      expect(state.messages[0].text).toContain('btc-v6');
      expect(state.messages[0].parse_mode).toBe('HTML');
      expect(state.messages[0].text).toContain('<b>');
      expect(state.messages[0].text).not.toContain('btc-v5');
      expect(state.requests.some((request) => request.method === 'getUpdates' && request.body.offset === 41)).toBe(true);
      expect(h.accountTransaction).not.toHaveBeenCalled();
    } finally { await receiver.onModuleDestroy(); }
    expect(h.lease.release).toHaveBeenCalled();
  }, 10000);
  it('sends automatic buy and sell notices with HTML formatting over HTTP', async () => {
    await control({});
    const h = commandHarness(), state = h.states.get('a-0')!;
    const notifications = new NotificationServiceV2(h.store, new TelegramClient(url));
    const paper = new PaperExecutionAdapter();
    const exit = paper.requestExit(state, state.positions[0].id, Date.now(), 'TAKE_PROFIT')!;
    paper.execute(state, exit.id, 102000, Date.now(), 1);
    for (const fill of state.fills) {
      await notifications.deliver({ topic: 'notification.requested.v1', eventId: fill.id,
        key: 'u-a', correlationId: fill.orderId, schemaVersion: 1, occurredAt: new Date().toISOString(),
        payload: { userId: 'u-a', kind: `SIMULATED_${fill.side}`,
          ...telegramFillNotice(fill, state.positions[0], state.orders.find((o) => o.id === fill.orderId)) } });
    }
    const messages = (await serverState()).messages;
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.chat_id === '111' && message.parse_mode === 'HTML')).toBe(true);
    expect(messages[0].text).toContain('<b>Compra ejecutada</b>');
    expect(messages[1].text).toContain('<b>Venta ejecutada</b>');
  });
  it.each(['conflict', 'html-error', 'unauthorized'])('sanitizes %s failures without exposing the token', async (scenario) => {
    await control({ scenario });
    const client = new TelegramClient(url);
    const error = await client.request('getUpdates').catch((reason: Error) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain('SIMULATION_TOKEN');
  });
  it('honors rate-limit cooldown without issuing another HTTP request', async () => {
    await control({ scenario: 'rate-limit' });
    const client = new TelegramClient(url);
    await expect(client.request('getUpdates')).rejects.toMatchObject({ retryAfterMs: 2000 });
    await expect(client.request('getUpdates')).rejects.toMatchObject({ code: 'TELEGRAM_RATE_LIMIT' });
    expect((await serverState()).requests.filter((r) => r.method === 'getUpdates')).toHaveLength(1);
  });
  it('aborts a slow HTTP response with a sanitized timeout', async () => {
    await control({ scenario: 'delayed' });
    await expect(new TelegramClient(url).request('getUpdates', {}, 30)).rejects.toMatchObject({ code: 'TELEGRAM_NETWORK_ERROR' });
  });
  it('does not delete or compete with an existing webhook', async () => {
    const h = commandHarness();
    await control({ webhook: 'https://example.invalid/existing' });
    const receiver = new TelegramCommandsService(h.store, new TelegramClient(url));
    receiver.onModuleInit();
    try {
      const until = Date.now() + 3000;
      while (!(await serverState()).requests.some((r) => r.method === 'getWebhookInfo') && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 25));
      expect((await serverState()).requests.map((r) => r.method)).toEqual(['getMe', 'getWebhookInfo']);
      expect(h.emitted).toHaveLength(0);
    } finally { await receiver.onModuleDestroy(); }
  }, 10000);
});
