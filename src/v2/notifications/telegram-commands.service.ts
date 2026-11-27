import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { StoreService } from '../persistence/store.service';
import { CandleRow, V2User, VirtualAccountRow } from '../persistence/entities';
import { TelegramClient, TelegramDeliveryError, TelegramUpdate } from './telegram.client';
import { parseTelegramCommand, splitTelegramReply, telegramAccountReply, telegramHelp } from './telegram-commands';

interface BotIdentity { id: number; username: string; is_bot: boolean }
export class TelegramPollingUnavailable extends Error {
  constructor(readonly code: string) { super(code); }
}
/** Worker-only reader. Account answers use the existing durable notification outbox. */
@Injectable()
export class TelegramCommandsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramCommandsService.name);
  private stopped = false;
  private task?: Promise<void>;
  private readonly abort = new AbortController();
  private lease?: QueryRunner;
  private leaseKey?: string;
  private timer?: NodeJS.Timeout;
  private wake?: () => void;
  ready = false;
  constructor(private readonly store: StoreService, private readonly telegram: TelegramClient) {}
  onModuleInit(): void {
    if (process.env.V2_TELEGRAM_ENABLED !== 'true' || process.env.V2_TELEGRAM_COMMANDS_ENABLED === 'false') return;
    if (!process.env.V2_TELEGRAM_BOT_TOKEN?.trim()) {
      this.logger.warn(JSON.stringify({ event: 'telegram_commands_unavailable', code: 'TELEGRAM_NOT_CONFIGURED' }));
      return;
    }
    this.task = this.run();
  }
  private wait(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(() => { this.wake = undefined; resolve(); }, ms);
    });
  }
  private async releaseLease(): Promise<void> {
    const lease = this.lease;
    this.lease = undefined;
    if (lease && !lease.isReleased) {
      // Release the session-scoped advisory lock as well as its pooled connection.
      if (this.leaseKey)
        await lease.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [this.leaseKey]).catch(() => undefined);
      await lease.release().catch(() => undefined);
    }
    this.leaseKey = undefined;
  }
  async checkpoint(botId: number): Promise<{ offset?: number; handledAt: number }> {
    const rows: { updateId: string; processedAt: Date | string }[] = await this.store.db.query(
      `SELECT split_part(id, ':', 3)::bigint AS "updateId", "processedAt" FROM v2_inbox
       WHERE id LIKE $1 ORDER BY "processedAt" DESC, "updateId" DESC LIMIT 1`,
      [`telegram-command:${botId}:%`],
    );
    const row = rows[0];
    const handledAt = row ? new Date(row.processedAt).getTime() : 0;
    // Telegram may choose a random update_id after a week without updates.
    const offset = row && Date.now() - handledAt < 6 * 86400000 ? Number(row.updateId) + 1 : undefined;
    return { offset, handledAt };
  }
  private async run(): Promise<void> {
    let failures = 0;
    while (!this.stopped) {
      let delay = 10000;
      try {
        const bot = await this.telegram.request<BotIdentity>('getMe', {}, 10000, this.abort.signal);
        if (!Number.isSafeInteger(bot.id) || bot.id <= 0 || !bot.is_bot || !bot.username)
          throw new TelegramPollingUnavailable('TELEGRAM_INVALID_BOT_IDENTITY');
        this.lease = this.store.db.createQueryRunner();
        await this.lease.connect();
        this.leaseKey = `telegram-poller:${bot.id}`;
        const [lock] = await this.lease.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
          [this.leaseKey]) as { acquired: boolean }[];
        if (!lock?.acquired) throw new TelegramPollingUnavailable('TELEGRAM_POLLER_ALREADY_RUNNING');
        const webhook = await this.telegram.request<{ url?: string }>('getWebhookInfo', {}, 10000, this.abort.signal);
        if (webhook.url) throw new TelegramPollingUnavailable('TELEGRAM_WEBHOOK_ALREADY_CONFIGURED');
        let { offset, handledAt } = await this.checkpoint(bot.id);
        this.ready = true;
        this.logger.log(JSON.stringify({ event: 'telegram_commands_started', bot: bot.username }));
        while (!this.stopped) {
          await this.lease.query('SELECT 1');
          if (Date.now() - handledAt >= 6 * 86400000) offset = undefined;
          const updates = await this.telegram.request<TelegramUpdate[]>('getUpdates', {
            ...(offset === undefined ? {} : { offset }), limit: 100, timeout: 25, allowed_updates: ['message'],
          }, 35000, this.abort.signal);
          if (this.stopped) break;
          // A lost DB session must not leave a second active reader processing the same bot.
          await this.lease.query('SELECT 1');
          if (!Array.isArray(updates) || updates.some((u) => !Number.isSafeInteger(u.update_id) || u.update_id < 0))
            throw new TelegramPollingUnavailable('TELEGRAM_INVALID_UPDATE');
          for (const update of updates.sort((a, b) => a.update_id - b.update_id)) {
            if (this.stopped) break;
            await this.handleUpdate(bot, update);
            // Only acknowledge on the NEXT poll after the receipt + reply outbox commit.
            offset = update.update_id + 1;
            handledAt = Date.now();
          }
          failures = 0;
          // Avoid a tight loop if an upstream proxy incorrectly returns empty polls immediately.
          if (!updates.length) await this.wait(250);
        }
      } catch (error) {
        if (!this.stopped) {
          const code = error instanceof TelegramDeliveryError || error instanceof TelegramPollingUnavailable
            ? error.code : 'TELEGRAM_COMMAND_PROCESSING_FAILED';
          failures++;
          delay = Math.max(Math.min(60000, 1000 * 2 ** Math.min(failures, 6)),
            error instanceof TelegramDeliveryError ? error.retryAfterMs : 0);
          if (code === 'TELEGRAM_WEBHOOK_ALREADY_CONFIGURED') delay = Math.max(delay, 60000);
          this.logger.warn(JSON.stringify({ event: 'telegram_commands_unavailable', code }));
        }
      } finally {
        this.ready = false;
        await this.releaseLease();
      }
      if (!this.stopped) await this.wait(delay + Math.floor(Math.random() * 500));
    }
  }
  async handleUpdate(bot: Pick<BotIdentity, 'id' | 'username'>, update: TelegramUpdate): Promise<void> {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return;
    const message = update.message;
    const date = Number.isSafeInteger(message?.date) ? message!.date : 0;
    const receipt = `${update.update_id}:${date}`;
    await this.store.db.transaction('REPEATABLE READ', async (tx) => {
      await this.store.once(tx, `telegram-command:${bot.id}`, receipt, async () => {
        // Financial answers are never posted in groups, channels or to a forwarded sender identity.
        if (!message || message.chat?.type !== 'private' || !Number.isSafeInteger(message.chat.id) ||
          message.chat.id <= 0 || !message.from || message.from.id !== message.chat.id ||
          message.from.is_bot || typeof message.text !== 'string') return;
        const parsed = parseTelegramCommand(message.text, bot.username);
        if (!parsed) return;
        const chatId = String(message.chat.id);
        const owners = await tx.find(V2User, { where: { telegramChatId: chatId, active: true }, take: 2 });
        const owner = owners.length === 1 ? owners[0] : undefined;
        let text: string;
        let kind: 'HELP' | 'ACCOUNT_QUERY' = 'HELP';
        if (!owner || parsed.command === 'help') text = telegramHelp(chatId, !!owner);
        else {
          kind = 'ACCOUNT_QUERY';
          const account = parsed.command === 'btc' ? null : await tx.findOneBy(VirtualAccountRow, { userId: owner.id });
          const state = account ? await this.store.readAccount(account.id, tx) : null;
          const candle = parsed.command === 'btc' || parsed.command === 'resumen'
            ? await tx.getRepository(CandleRow).findOne({ where: { timeframe: '1m' }, order: { openTime: 'DESC' } }) : null;
          text = telegramAccountReply(parsed.command, parsed.page, state, candle?.data ?? null);
        }
        const replyId = `telegram-reply:${bot.id}:${receipt}`;
        for (const [index, chunk] of splitTelegramReply(text).entries()) {
          await this.store.emit(tx, 'telegram.reply.requested.v1', chatId,
            { chatId, userId: kind === 'ACCOUNT_QUERY' ? owner!.id : undefined, kind, text: chunk, parseMode: 'HTML' },
            replyId, `${replyId}:${index}`);
        }
      });
    });
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    clearTimeout(this.timer);
    this.wake?.();
    await this.task;
  }
}
