import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '../events/contracts';
import { StoreService } from '../persistence/store.service';
import { V2User, VirtualAccountRow } from '../persistence/entities';

@Injectable()
export class NotificationServiceV2 {
  private readonly logger = new Logger(NotificationServiceV2.name);
  constructor(private readonly store: StoreService) {}
  async deliver(event: DomainEvent<'notification.requested.v1'>): Promise<void> {
    await this.store.db.transaction(async (tx) => {
      await this.store.once(tx, 'notifications', event.eventId, async () => {
        const user = await tx.findOneByOrFail(V2User, { id: event.payload.userId });
        if (!user.active) return;
        if (process.env.V2_TELEGRAM_ENABLED === 'true' && user.telegramChatId) {
          const token = process.env.V2_TELEGRAM_BOT_TOKEN;
          if (!token) throw new Error('TELEGRAM_NOT_CONFIGURED');
          const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(8000),
            body: JSON.stringify({ chat_id: user.telegramChatId, text: event.payload.text }),
          });
          if (!response.ok) throw new Error('TELEGRAM_DELIVERY_FAILED');
        }
        this.logger.log(
          JSON.stringify({
            event: 'notification_processed',
            eventId: event.eventId,
            kind: event.payload.kind,
          }),
        );
      });
    });
  }
  async dailySummary(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const accounts = await this.store.db.getRepository(VirtualAccountRow).find();
    for (const row of accounts)
      await this.store.db.transaction(async (tx) => {
        await this.store.once(tx, `daily:${row.id}`, day, async () => {
          const state = await this.store.readAccount(row.id, tx);
          const closed = state.positions.filter(
            (p) => p.closedAt && new Date(p.closedAt).toISOString().slice(0, 10) === day,
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
