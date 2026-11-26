import Decimal from 'decimal.js';
import { AccountState, Candle, isOrderOpen, isPositionOpen, Position } from '../domain/model';
import { statistics } from '../backtesting/backtesting.engine';

export type TelegramCommand = 'help' | 'abiertas' | 'ordenes' | 'btc' | 'resumen';
const aliases: Record<string, TelegramCommand> = {
  start: 'help', help: 'help', ayuda: 'help', abiertas: 'abiertas', posiciones: 'abiertas',
  senales: 'abiertas', signals: 'abiertas', signas: 'abiertas', ordenes: 'ordenes',
  btc: 'btc', precio: 'btc', resumen: 'resumen', estado: 'resumen',
};
export function parseTelegramCommand(text: string, botUsername: string) {
  const match = /^\/([a-z_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match || (match[2] && match[2].toLowerCase() !== botUsername.toLowerCase())) return null;
  const command = aliases[match[1].toLowerCase()] ?? 'help';
  const argument = match[3]?.trim() ?? '';
  const page = argument ? (/^[1-9]\d{0,5}$/.test(argument) ? Number(argument) : 0) : 1;
  return { command, page };
}
const money = (value: Decimal.Value) => new Decimal(value).toFixed(2);
const btc = (value: Decimal.Value) => new Decimal(value).toFixed(8);
const time = (at: number) => new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Buenos_Aires', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(at));
export function telegramHelp(chatId: string, linked: boolean): string {
  return [
    'VolBot · consultas de tu cuenta',
    ...(linked ? [] : ['Este chat no está vinculado a una única cuenta activa.',
      `Tu ID de chat: ${chatId}`, 'Pedile al administrador que lo vincule desde VolBot.']),
    '/abiertas — BTC comprado, entrada, objetivo y salida pendiente',
    '/ordenes — compras y ventas pendientes o parciales',
    '/btc — último precio de cierre BTC/USDT disponible',
    '/resumen — saldo y resultados de tu cuenta',
    '/ayuda — este menú',
    'Son consultas: estos comandos no compran, venden ni cancelan órdenes.',
  ].join('\n');
}
function quote(candle: Candle | null, now: number): string {
  if (!candle) return 'BTC/USDT: precio no disponible.';
  const stale = now - candle.closeTime > 180000;
  return `BTC/USDT: ${money(candle.close)} USDT\nÚltimo cierre 1m: ${time(candle.closeTime)} (Buenos Aires)${stale ? '\n⚠ Precio desactualizado; no representa una cotización actual.' : ''}`;
}
function exitState(position: Position, state: AccountState): string {
  const sell = state.orders.find((o) => o.positionId === position.id && o.side === 'SELL' && isOrderOpen(o));
  const buy = state.orders.find((o) => o.positionId === position.id && o.side === 'BUY' && isOrderOpen(o));
  if (sell) return `Venta ${sell.status}${sell.limitPrice ? ` · límite ${money(sell.limitPrice)} USDT` : ''}`;
  if (position.status === 'DUST') return 'Polvo: remanente por debajo de los filtros de venta.';
  if (buy) return new Decimal(position.quantity).gt(0) ? 'Compra parcial; queda BTC por comprar y vender.' : 'Compra pendiente; todavía sin BTC ejecutado.';
  if (position.dynamicTakeProfit?.phase === 'TRACKING_PRICE')
    return `Objetivo alcanzado; siguiendo máximo ${money(position.dynamicTakeProfit.peak)} USDT. Venta todavía sin solicitar.`;
  return 'BTC comprado; esperando las condiciones de salida. Venta todavía sin solicitar.';
}
export function telegramAccountReply(command: TelegramCommand, page: number, state: AccountState | null,
  candle: Candle | null, now = Date.now()): string {
  if (command === 'btc') return quote(candle, now);
  if (!state) return 'Tu usuario no tiene una cuenta de trading disponible.';
  if (command === 'resumen') {
    const totalBTC = state.ledger.filter((e) => e.asset === 'BTC')
      .reduce((sum, e) => sum.plus(e.availableDelta).plus(e.reservedDelta), new Decimal(0));
    const net = state.positions.reduce((sum, p) => sum.plus(p.realizedPnl), new Decimal(0));
    const closed = state.positions.filter((p) => p.status === 'CLOSED');
    const wins = closed.filter((p) => new Decimal(p.realizedPnl).gt(0)).length;
    const losses = closed.filter((p) => new Decimal(p.realizedPnl).lt(0)).length;
    return [`VolBot · ${state.account.executionMode ?? 'PAPER'}`,
      `Disponible: ${money(state.account.available)} USDT · reservado: ${money(state.account.reserved)} USDT`,
      `BTC total: ${btc(totalBTC)}`,
      `Entradas: ${state.account.entriesEnabled ? 'habilitadas' : 'pausadas'} · ticket: ${money(state.account.usdtPerTrade)} USDT`,
      `Posiciones abiertas (incluye polvo): ${state.positions.filter(isPositionOpen).length}`,
      `Cierres: ${closed.length} · ganadores: ${wins} · perdedores: ${losses} · neutros: ${closed.length - wins - losses}`,
      `P&L realizado neto: ${money(net)} USDT`,
      ...(candle ? [`P&L abierto: ${money(statistics(state, candle.close).unrealizedPnl)} USDT (sin comisión futura de venta)`,
        `Equity estimada: ${money(statistics(state, candle.close).equity)} USDT`] : ['P&L abierto y equity: sin precio disponible.']),
      quote(candle, now), 'Para ver qué falta vender: /abiertas',
    ].join('\n');
  }
  if (page < 1) return `Usá /${command} o /${command} 2 para cambiar de página.`;
  const records = command === 'abiertas' ? state.positions.filter(isPositionOpen) : state.orders.filter(isOrderOpen);
  const pageSize = command === 'abiertas' ? 5 : 8;
  if (!records.length) return command === 'abiertas' ? 'No tenés posiciones abiertas.' : 'No tenés órdenes pendientes, parciales o sin conciliar.';
  const pages = Math.ceil(records.length / pageSize);
  if (page > pages) return `Hay ${pages} página(s). Usá /${command} ${pages}.`;
  const rows = command === 'abiertas'
    ? state.positions.filter(isPositionOpen).slice((page - 1) * pageSize, page * pageSize).map((p, i) => [
      `${(page - 1) * pageSize + i + 1}. ${p.strategy} · ${p.executionMode ?? 'PAPER'} · ${p.status}`,
      `BTC restante: ${btc(p.quantity)} · entrada media: ${money(p.averageEntry)} USDT`,
      `Importe comprado: ${money(p.entryQuote)} USDT · costo restante: ${money(p.remainingCost)} USDT`,
      `Objetivo: ${money(p.dynamicTakeProfit?.originalTarget ?? p.takeProfit)} USDT`,
      exitState(p, state), `Abierta: ${time(p.openedAt)} (Buenos Aires)`,
    ].join('\n'))
    : state.orders.filter(isOrderOpen).slice((page - 1) * pageSize, page * pageSize).map((o, i) => [
      `${(page - 1) * pageSize + i + 1}. ${o.side === 'BUY' ? 'COMPRA' : 'VENTA'} · ${o.executionMode ?? 'PAPER'} · ${o.status}`,
      `${o.type} · motivo: ${o.reason}`,
      `BTC: ${btc(o.quantity)} · ejecutado: ${btc(o.filledQuantity)}`,
      ...(o.limitPrice ? [`Precio límite: ${money(o.limitPrice)} USDT`] : []),
    ].join('\n'));
  return [`VolBot · ${command === 'abiertas' ? 'tus posiciones abiertas' : 'tus órdenes pendientes'}`,
    `Página ${page}/${pages} · total: ${records.length}`, ...rows,
    ...(page < pages ? [`Siguiente: /${command} ${page + 1}`] : []),
  ].join('\n\n');
}
export function splitTelegramReply(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const line of text.split('\n')) {
    for (let start = 0; start < line.length || start === 0; start += 3500) {
      const part = line.slice(start, start + 3500);
      if (chunk.length + part.length + 1 > 3800) { chunks.push(chunk); chunk = ''; }
      chunk += (chunk ? '\n' : '') + part;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
