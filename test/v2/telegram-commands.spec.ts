import { TelegramCommandsService } from '../../src/v2/notifications/telegram-commands.service';
import { NotificationServiceV2 } from '../../src/v2/notifications/notification.service';
import { TelegramClient } from '../../src/v2/notifications/telegram.client';
import { parseTelegramCommand, splitTelegramReply, telegramAccountReply } from '../../src/v2/notifications/telegram-commands';
import { commandBot, commandHarness, commandUpdate } from './telegram-command.fixtures';

describe('Read-only Telegram commands and account isolation', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['/abiertas', '/posiciones', '/signals', '/signas', '/senales'])('accepts %s and consults only the linked account', async (command) => {
    const h = commandHarness();
    const before = JSON.stringify([...h.states.values()]);
    await new TelegramCommandsService(h.store, new TelegramClient()).handleUpdate(commandBot, commandUpdate(command));
    expect(h.readAccount).toHaveBeenCalledWith('a-0', expect.anything());
    expect(h.emitted[0].payload).toMatchObject({ chatId: '111', userId: 'u-a', kind: 'ACCOUNT_QUERY' });
    expect(h.emitted[0].payload.text).toContain('btc-v6');
    expect(h.emitted[0].payload.text).not.toContain('btc-v5');
    expect(h.accountTransaction).not.toHaveBeenCalled();
    expect(JSON.stringify([...h.states.values()])).toBe(before);
  });
  it('routes another private chat to its own account, ignoring account IDs in arguments', async () => {
    const h = commandHarness();
    const service = new TelegramCommandsService(h.store, new TelegramClient());
    await service.handleUpdate(commandBot, commandUpdate('/abiertas u-a', 1, 222));
    expect(h.readAccount).toHaveBeenCalledWith('a-1', expect.anything());
    expect(h.readAccount).not.toHaveBeenCalledWith('a-0', expect.anything());
    expect(h.emitted[0].payload.userId).toBe('u-b');
    expect(h.emitted[0].payload.text).toContain('Usá /abiertas');
  });
  it.each(['unlinked', 'inactive', 'ambiguous'])('returns linking instructions without account data for %s chats', async (scenario) => {
    const h = commandHarness();
    if (scenario === 'unlinked') h.users[0].telegramChatId = null;
    if (scenario === 'inactive') h.users[0].active = false;
    if (scenario === 'ambiguous') h.users[1].telegramChatId = '111';
    await new TelegramCommandsService(h.store, new TelegramClient()).handleUpdate(commandBot, commandUpdate('/resumen'));
    expect(h.readAccount).not.toHaveBeenCalled();
    expect(h.emitted[0].payload).toMatchObject({ chatId: '111', kind: 'HELP' });
    expect(h.emitted[0].payload.text).toContain('Tu ID de chat: 111');
    expect(h.emitted[0].payload.text).not.toMatch(/\d+\.\d{2} USDT|btc-v6|btc-v5/);
  });
  it.each(['group', 'wrong-sender', 'bot-sender', 'ordinary-text', 'other-bot'])('ignores %s updates', async (scenario) => {
    const h = commandHarness();
    const update = commandUpdate('/abiertas');
    if (scenario === 'group') update.message!.chat.type = 'group';
    if (scenario === 'wrong-sender') update.message!.from!.id = 222;
    if (scenario === 'bot-sender') update.message!.from!.is_bot = true;
    if (scenario === 'ordinary-text') update.message!.text = 'hola';
    if (scenario === 'other-bot') update.message!.text = '/abiertas@Other_Bot';
    await new TelegramCommandsService(h.store, new TelegramClient()).handleUpdate(commandBot, update);
    expect(h.readAccount).not.toHaveBeenCalled();
    expect(h.emitted).toHaveLength(0);
  });
  it('commits one reply for repeated delivery, including after service recreation', async () => {
    const h = commandHarness();
    const update = commandUpdate('/resumen');
    await new TelegramCommandsService(h.store, new TelegramClient()).handleUpdate(commandBot, update);
    await new TelegramCommandsService(h.store, new TelegramClient()).handleUpdate(commandBot, update);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].payload.text).toContain('ticket: 30.00 USDT');
  });
  it('leaves a failed update eligible for retry before acknowledging it', async () => {
    const h = commandHarness();
    h.emit.mockRejectedValueOnce(new Error('OUTBOX_UNAVAILABLE'));
    const service = new TelegramCommandsService(h.store, new TelegramClient());
    const update = commandUpdate('/btc');
    await expect(service.handleUpdate(commandBot, update)).rejects.toThrow('OUTBOX_UNAVAILABLE');
    expect(h.receipts.size).toBe(0);
    await service.handleUpdate(commandBot, update);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].payload.text).toContain('Último cierre 1m');
  });
  it('does not send a queued private account reply after the chat is reassigned', async () => {
    const h = commandHarness();
    await new TelegramCommandsService(h.store, new TelegramClient()).handleUpdate(commandBot, commandUpdate('/resumen'));
    h.users[0].telegramChatId = '333';
    h.users[1].telegramChatId = '111';
    const send = jest.spyOn(TelegramClient.prototype, 'send').mockResolvedValue({});
    const old = process.env.V2_TELEGRAM_ENABLED;
    process.env.V2_TELEGRAM_ENABLED = 'true';
    try { await new NotificationServiceV2(h.store).reply(h.emitted[0]); }
    finally { if (old === undefined) delete process.env.V2_TELEGRAM_ENABLED; else process.env.V2_TELEGRAM_ENABLED = old; }
    expect(send).not.toHaveBeenCalled();
  });
  it('distinguishes bought BTC, dynamic tracking and a partially filled SELL', () => {
    const h = commandHarness(), state = h.states.get('a-0')!, position = state.positions[0];
    const plain = telegramAccountReply('abiertas', 1, state, null);
    expect(plain).toContain('BTC comprado');
    position.dynamicTakeProfit = { phase: 'TRACKING_PRICE', originalTarget: '100400', peak: '100800', noise: '1', retracement: '3',
      config: { revision: 'v6-dtp-2026-11-26.1', noiseHalfLifeMs: 30000, noiseMultiplier: 3, maxObservationAgeMs: 10000 } };
    expect(telegramAccountReply('abiertas', 1, state, null)).toContain('siguiendo máximo 100800.00');
    state.orders.push({ ...state.orders[0], id: 'sell', side: 'SELL', status: 'PARTIALLY_FILLED', type: 'LIMIT', limitPrice: '100400' });
    expect(telegramAccountReply('abiertas', 1, state, null)).toContain('Venta PARTIALLY_FILLED');
    expect(telegramAccountReply('ordenes', 1, state, null)).toContain('VENTA');
  });
  it('labels missing and stale market prices instead of inventing a current quote', () => {
    expect(telegramAccountReply('btc', 1, null, null)).toContain('no disponible');
    const h = commandHarness();
    expect(telegramAccountReply('btc', 1, null, h.latest.data, h.latest.data.closeTime + 180001)).toContain('desactualizado');
  });
  it('paginates long histories and keeps reply chunks below Telegram message limits', () => {
    const h = commandHarness(), state = h.states.get('a-0')!, first = state.positions[0];
    state.positions = Array.from({ length: 12 }, (_, i) => ({ ...first, id: `p-${i}`, strategy: 'btc-v6' }));
    const page = telegramAccountReply('abiertas', 2, state, null);
    expect(page).toContain('Página 2/3');
    expect(page).toContain('Siguiente: /abiertas 3');
    expect(splitTelegramReply('x'.repeat(10000)).every((chunk) => chunk.length <= 3800)).toBe(true);
    expect(parseTelegramCommand('/abiertas@volbot_test 2', commandBot.username)).toEqual({ command: 'abiertas', page: 2 });
  });
  it('resumes its committed cursor but resets an obsolete offset after a long idle interval', async () => {
    const h = commandHarness();
    h.db.query.mockResolvedValueOnce([{ updateId: '50', processedAt: new Date() }]);
    h.db.query.mockResolvedValueOnce([{ updateId: '50', processedAt: new Date(Date.now() - 7 * 86400000) }]);
    const service = new TelegramCommandsService(h.store, new TelegramClient());
    expect((await service.checkpoint(commandBot.id)).offset).toBe(51);
    expect((await service.checkpoint(commandBot.id)).offset).toBeUndefined();
  });
});
