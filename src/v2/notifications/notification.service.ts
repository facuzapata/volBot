import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '../events/contracts';
import { StoreService } from '../persistence/store.service';
import { V2User, VirtualAccountRow } from '../persistence/entities';

export function telegramStatus(user: Pick<V2User, 'active' | 'telegramChatId'>) {
  const enabled = process.env.V2_TELEGRAM_ENABLED === 'true';
  const botConfigured = !!process.env.V2_TELEGRAM_BOT_TOKEN?.trim();
  const chatLinked = !!user.telegramChatId?.trim();
  return { enabled, botConfigured, chatLinked, ready: enabled && botConfigured && chatLinked && user.active };
}
export class TelegramDeliveryError extends Error {
  constructor(readonly retryAfterMs = 0) { super('TELEGRAM_DELIVERY_FAILED'); }
}

@Injectable()
export class NotificationServiceV2 {
  private readonly logger = new Logger(NotificationServiceV2.name);
  constructor(private readonly store: StoreService) {}
  async deliver(event: DomainEvent<'notification.requested.v1'>): Promise<void> {
    await this.store.db.transaction(async (tx) => {
      await this.store.once(tx, 'notifications', event.eventId, async () => {
        const user = await tx.findOneByOrFail(V2User, { id: event.payload.userId });
        if (!user.active) return;
        let delivery = 'DISABLED';
        if (process.env.V2_TELEGRAM_ENABLED === 'true' && user.telegramChatId) {
          const token = process.env.V2_TELEGRAM_BOT_TOKEN?.trim();
          if (!token) throw new Error('TELEGRAM_NOT_CONFIGURED');
          const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(8000),
            body: JSON.stringify({ chat_id: user.telegramChatId, text: event.payload.text }),
          });
          const result = await response.json().catch(() => null) as
            { ok?: boolean; parameters?: { retry_after?: number } } | null;
          if (!response.ok || result?.ok !== true) {
            const seconds = result?.parameters?.retry_after;
            throw new TelegramDeliveryError(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
              ? Math.min(seconds, 86400) * 1000 : 0);
          }
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
              text: `PAPER resumen UTC ${day}: ${closed.length} cierres, neto ${net.toFixed(4)} USDT`,
            },
            `daily:${day}`,
          );
        });
      });
  }
}
