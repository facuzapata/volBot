import { Injectable, Logger, Optional } from '@nestjs/common';
import { DomainEvent } from '../events/contracts';
import { StoreService } from '../persistence/store.service';
import { V2User, VirtualAccountRow } from '../persistence/entities';
import { TelegramClient } from './telegram.client';
import { telegramLabel } from './telegram-format';
export { TelegramDeliveryError } from './telegram.client';

export function telegramStatus(user: Pick<V2User, 'active' | 'telegramChatId'>) {
  const enabled = process.env.V2_TELEGRAM_ENABLED === 'true';
  const botConfigured = !!process.env.V2_TELEGRAM_BOT_TOKEN?.trim();
  const chatLinked = !!user.telegramChatId?.trim();
  return { enabled, botConfigured, chatLinked, ready: enabled && botConfigured && chatLinked && user.active };
}

@Injectable()
export class NotificationServiceV2 {
  private readonly logger = new Logger(NotificationServiceV2.name);
  private readonly telegram: TelegramClient;
  constructor(private readonly store: StoreService, @Optional() telegram?: TelegramClient) {
    this.telegram = telegram ?? new TelegramClient();
  }
  async deliver(event: DomainEvent<'notification.requested.v1'>): Promise<void> {
    await this.store.db.transaction(async (tx) => {
      await this.store.once(tx, 'notifications', event.eventId, async () => {
        const user = await tx.findOneByOrFail(V2User, { id: event.payload.userId });
        if (!user.active) return;
        let delivery = 'DISABLED';
        if (process.env.V2_TELEGRAM_ENABLED === 'true' && user.telegramChatId) {
          const token = process.env.V2_TELEGRAM_BOT_TOKEN?.trim();
          if (!token) throw new Error('TELEGRAM_NOT_CONFIGURED');
          await this.telegram.send(user.telegramChatId, event.payload.text, event.payload.parseMode);
          delivery = 'SENT';
        } else if (process.env.V2_TELEGRAM_ENABLED === 'true') {
          delivery = 'CHAT_NOT_LINKED';
        }
        this.logger.log(
          JSON.stringify({
            event: 'notification_processed',
            eventId: event.eventId,
            kind: event.payload.kind,
            delivery,
          }),
        );
      });
    });
  }
  async reply(event: DomainEvent<'telegram.reply.requested.v1'>): Promise<void> {
    await this.store.db.transaction(async (tx) => {
      await this.store.once(tx, 'notifications', event.eventId, async () => {
        if (process.env.V2_TELEGRAM_ENABLED !== 'true') return;
        const reply = event.payload;
        if (reply.kind === 'ACCOUNT_QUERY') {
          // Recheck ownership at delivery: queued replies must not survive an unlink/reassignment.
          const owners = await tx.find(V2User, { where: { telegramChatId: reply.chatId, active: true }, take: 2 });
          if (owners.length !== 1 || owners[0].id !== reply.userId) return;
        } else if (reply.kind !== 'HELP') return;
        await this.telegram.send(reply.chatId, reply.text, reply.parseMode);
        this.logger.log(JSON.stringify({ event: 'telegram_reply_sent', eventId: event.eventId }));
      });
    });
  }
  async dailySummary(): Promise<void> {
    // Summarize the last COMPLETE UTC day, including its final minute.
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const accounts = await this.store.db.getRepository(VirtualAccountRow).find();
    for (const row of accounts)
      await this.store.db.transaction(async (tx) => {
        await this.store.once(tx, `daily:${row.id}`, day, async () => {
          const state = await this.store.readAccount(row.id, tx);
          const closed = state.positions.filter(
            (p) => p.status === 'CLOSED' && p.closedAt && new Date(p.closedAt).toISOString().slice(0, 10) === day,
          );
          const net = closed.reduce((n, p) => n + Number(p.realizedPnl), 0);
          await this.store.emit(
            tx,
            'notification.requested.v1',
            row.userId,
            {
              userId: row.userId,
              kind: 'DAILY_SUMMARY',
              parseMode: 'HTML',
              text: ['📅 <b>VolBot · Resumen diario</b>',
                `${telegramLabel(state.account.executionMode ?? 'PAPER')} · ${day} (UTC)`, '',
                `Operaciones cerradas: <b>${closed.length}</b>`,
                `${net > 0 ? '🟢' : net < 0 ? '🔴' : '⚪'} Resultado neto: <b>${net.toFixed(4)} USDT</b>`, '',
                '📊 Ver cuenta: /resumen · 📂 Ver posiciones: /abiertas',
              ].join('\n'),
            },
            `daily:${day}`,
          );
        });
      });
  }
}
