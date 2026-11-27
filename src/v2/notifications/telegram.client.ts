/** Only this client handles the bot token. Errors and logs never include request URLs. */
export class TelegramDeliveryError extends Error {
  constructor(readonly retryAfterMs = 0, readonly code = 'TELEGRAM_DELIVERY_FAILED') {
    super('TELEGRAM_DELIVERY_FAILED');
  }
}
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    from?: { id: number; is_bot?: boolean };
    chat: { id: number; type: string };
  };
}
type TelegramMethod = 'getMe' | 'getWebhookInfo' | 'getUpdates' | 'sendMessage';
export class TelegramClient {
  private blockedUntil = 0;
  /** Custom origin is for local HTTP simulations; production always uses the default factory. */
  constructor(private readonly origin = 'https://api.telegram.org') {}
  async request<T>(method: TelegramMethod, body: object = {}, timeoutMs = 10000, signal?: AbortSignal): Promise<T> {
    const token = process.env.V2_TELEGRAM_BOT_TOKEN?.trim();
    if (!token) throw new Error('TELEGRAM_NOT_CONFIGURED');
    if (Date.now() < this.blockedUntil)
      throw new TelegramDeliveryError(this.blockedUntil - Date.now(), 'TELEGRAM_RATE_LIMIT');
    try {
      const response = await fetch(`${this.origin}/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json().catch(() => null) as
        { ok?: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } } | null;
      if (!response.ok || data?.ok !== true) {
        const seconds = data?.parameters?.retry_after;
        const retryAfterMs = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
          ? Math.min(seconds, 86400) * 1000 : 0;
        if (retryAfterMs) this.blockedUntil = Date.now() + retryAfterMs;
        const code = response.status === 409 || data?.error_code === 409 ? 'TELEGRAM_POLL_CONFLICT'
          : response.status === 401 || data?.error_code === 401 ? 'TELEGRAM_INVALID_TOKEN'
            : retryAfterMs ? 'TELEGRAM_RATE_LIMIT' : 'TELEGRAM_DELIVERY_FAILED';
        throw new TelegramDeliveryError(retryAfterMs, code);
      }
      return data.result as T;
    } catch (error) {
      if (error instanceof TelegramDeliveryError) throw error;
      throw new TelegramDeliveryError(0, signal?.aborted ? 'TELEGRAM_STOPPED' : 'TELEGRAM_NETWORK_ERROR');
    }
  }
  send(chatId: string, text: string, parseMode?: 'HTML'): Promise<unknown> {
    return this.request('sendMessage', { chat_id: chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}) });
  }
}
