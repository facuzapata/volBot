import Decimal from 'decimal.js';
import { AccountState, Candle, isOrderOpen, isPositionOpen, Position } from '../domain/model';
import { statistics } from '../backtesting/backtesting.engine';
import { telegramBold as bold, telegramCode as code, telegramEscape as escape, telegramLabel as label } from './telegram-format';

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
    '🤖 <b>VolBot · Tu cuenta, a mano</b>', '',
    ...(linked ? [] : ['Este chat no está vinculado a una única cuenta activa.',
      `Tu ID de chat: ${escape(chatId)}`, 'Pedile al administrador que lo vincule desde VolBot.', '']),
    '📊 /resumen — saldo y resultados',
    '📂 /abiertas — BTC comprado y objetivos de salida',
    '📋 /ordenes — compras y ventas pendientes',
    '₿ /btc — último cierre de BTC/USDT',
    '💬 /ayuda — este menú', '',
    '<i>Solo consultas. Estos comandos no compran, venden ni cancelan órdenes.</i>',
  ].join('\n');
}
function quote(candle: Candle | null, now: number): string {
  if (!candle) return '₿ <b>BTC/USDT</b>\nPrecio no disponible.';
  const stale = now - candle.closeTime > 180000;
  return `₿ <b>BTC/USDT · ${money(candle.close)} USDT</b>\n<i>Último cierre 1m: ${time(candle.closeTime)} (Buenos Aires)</i>${stale ? '\n⚠️ Precio desactualizado; no representa una cotización actual.' : ''}`;
}
function exitState(position: Position, state: AccountState): string {
  const sell = state.orders.find((o) => o.positionId === position.id && o.side === 'SELL' && isOrderOpen(o));
  const buy = state.orders.find((o) => o.positionId === position.id && o.side === 'BUY' && isOrderOpen(o));
  if (sell) return `Venta ${label(sell.status)}${sell.limitPrice ? ` · límite ${money(sell.limitPrice)} USDT` : ''}`;
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
    const stats = candle ? statistics(state, candle.close) : null;
    const resultIcon = net.gt(0) ? '🟢' : net.lt(0) ? '🔴' : '⚪';
    return ['📊 <b>VolBot · Resumen de cuenta</b>', label(state.account.executionMode ?? 'PAPER'), '',
      '💰 <b>Saldos</b>',
      `Disponible: ${code(`${money(state.account.available)} USDT`)}`,
      `Reservado: ${code(`${money(state.account.reserved)} USDT`)}`,
      `BTC total: ${code(btc(totalBTC))}`, '',
      `${resultIcon} <b>Resultados</b>`,
      `P&amp;L realizado neto: ${bold(`${money(net)} USDT`)}`,
      ...(stats ? [`P&amp;L abierto: ${bold(`${money(stats.unrealizedPnl)} USDT`)}`,
        '<i>Sin comisión futura de venta.</i>',
        `Equity estimada: ${bold(`${money(stats.equity)} USDT`)}`] : ['P&amp;L abierto y equity: sin precio disponible.']),
      `Cierres: ${closed.length} · ganadores: ${wins} · perdedores: ${losses} · neutros: ${closed.length - wins - losses}`, '',
      '⚙️ <b>Operativa</b>',
      `Entradas: ${state.account.entriesEnabled ? '🟢 habilitadas' : '⏸ pausadas'} · ticket: ${money(state.account.usdtPerTrade)} USDT`,
      `Posiciones abiertas (incluye polvo): ${state.positions.filter(isPositionOpen).length}`, '',
      quote(candle, now), '', '📂 Ver posiciones: /abiertas · 📋 Ver órdenes: /ordenes',
    ].join('\n');
  }
  if (page < 1) return `Usá /${command} o /${command} 2 para cambiar de página.`;
  const records = command === 'abiertas' ? state.positions.filter(isPositionOpen) : state.orders.filter(isOrderOpen);
  const pageSize = command === 'abiertas' ? 5 : 8;
  if (!records.length) return command === 'abiertas'
    ? '📂 <b>Posiciones abiertas</b>\n\nNo tenés posiciones abiertas.\n\n📊 Ver cuenta: /resumen'
    : '📋 <b>Órdenes pendientes</b>\n\nNo tenés órdenes pendientes, parciales o sin conciliar.\n\n📊 Ver cuenta: /resumen';
  const pages = Math.ceil(records.length / pageSize);
  if (page > pages) return `Hay ${pages} página(s). Usá /${command} ${pages}.`;
  const rows = command === 'abiertas'
    ? state.positions.filter(isPositionOpen).slice((page - 1) * pageSize, page * pageSize).map((p, i) => [
      `📂 ${bold(`${(page - 1) * pageSize + i + 1}. ${p.strategy}`)}`,
      `${label(p.executionMode ?? 'PAPER')} · ${label(p.status)}`,
      `BTC restante: ${code(btc(p.quantity))} · entrada media: ${money(p.averageEntry)} USDT`,
      `Importe comprado: ${money(p.entryQuote)} USDT · costo restante: ${money(p.remainingCost)} USDT`,
      `🎯 Objetivo: ${bold(`${money(p.dynamicTakeProfit?.originalTarget ?? p.takeProfit)} USDT`)}`,
      exitState(p, state), `<i>Abierta: ${time(p.openedAt)} (Buenos Aires)</i>`,
    ].join('\n'))
    : state.orders.filter(isOrderOpen).slice((page - 1) * pageSize, page * pageSize).map((o, i) => [
      `${o.side === 'BUY' ? '🟢' : '🔴'} ${bold(`${(page - 1) * pageSize + i + 1}. ${o.side === 'BUY' ? 'COMPRA' : 'VENTA'}`)}`,
      `${label(o.executionMode ?? 'PAPER')} · <b>${label(o.status)}</b>`,
      `${label(o.type)} · motivo: ${escape(o.reason)}`,
      `BTC: ${code(btc(o.quantity))}`,
      `Ejecutado: ${code(btc(o.filledQuantity))} · ${new Decimal(o.quantity).gt(0) ? Decimal.min(100, new Decimal(o.filledQuantity).div(o.quantity).mul(100)).toFixed(1) : '0.0'}%`,
      ...(o.limitPrice ? [`Precio límite: ${bold(`${money(o.limitPrice)} USDT`)}`] : []),
    ].join('\n'));
  return [`${command === 'abiertas' ? '📂' : '📋'} <b>VolBot · ${command === 'abiertas' ? 'Posiciones abiertas' : 'Órdenes pendientes'}</b>\n<i>Página ${page}/${pages} · total: ${records.length}</i>`,
    ...rows,
    ...(page < pages ? [`➡️ Siguiente: /${command} ${page + 1}`] : []),
    '📊 Ver cuenta: /resumen',
  ].join('\n\n');
}
export function splitTelegramReply(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  const open: string[] = [];
  const closing = () => [...open].reverse().map((tag) => `</${tag}>`).join('');
  // Keep inline markup, escaped entities and Unicode characters intact across messages.
  const tokens = text.match(/<\/?(?:b|i|code)>|&(?:amp|lt|gt);|[^<&\n]+|[\s\S]/gu) ?? [];
  for (const token of tokens) {
    const parts = token.length > 3500 ? Array.from(token) : [token];
    for (const part of parts) {
      if (chunk.length + part.length + closing().length > 3750) {
        chunks.push(chunk + closing());
        chunk = open.map((tag) => `<${tag}>`).join('');
      }
      chunk += part;
      const tag = /^<(b|i|code)>$/.exec(part);
      if (tag) open.push(tag[1]);
      else if (/^<\/(b|i|code)>$/.test(part)) open.pop();
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
