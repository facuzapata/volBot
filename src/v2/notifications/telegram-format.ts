/** Escape account data before inserting it into Telegram's HTML templates. */
export function telegramEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const telegramBold = (value: string) => `<b>${telegramEscape(value)}</b>`;
export const telegramCode = (value: string) => `<code>${telegramEscape(value)}</code>`;

const labels: Record<string, string> = {
  PAPER: '🧪 Simulación', LIVE: '🔴 Real',
  PENDING: 'Pendiente', PARTIALLY_FILLED: 'Parcialmente ejecutada', UNKNOWN: 'Por conciliar',
  OPENING: 'En compra', OPEN: 'Abierta', CLOSING: 'En venta', DUST: 'Remanente mínimo',
  MARKET: 'A mercado', LIMIT: 'Límite', PROTECTION: 'Protección',
};
export const telegramLabel = (value: string) => telegramEscape(labels[value] ?? value);
