import Decimal from 'decimal.js';
import { ExchangeOrder, Fill, MarketSignal, Position } from '../domain/model';
import { telegramBold as bold, telegramCode as code, telegramEscape as escape, telegramLabel as label } from './telegram-format';

const money = (value: Decimal.Value) => new Decimal(value).toFixed(2);
const quantity = (value: Decimal.Value) => new Decimal(value).toFixed(8);
const notice = (lines: string[]) => ({ text: lines.join('\n'), parseMode: 'HTML' as const });
const context = (position: Position) => `${label(position.executionMode ?? 'PAPER')} · ${escape(position.strategy)} · BTC/USDT`;
const positionRef = (position: Position) => `Posición: ${code(position.id)}`;
const reasons: Record<string, string> = {
  TAKE_PROFIT: 'Objetivo alcanzado', STOP_LOSS: 'Stop de protección',
  DYNAMIC_TAKE_PROFIT: 'Salida dinámica', TIME_EXIT: 'Tiempo máximo',
  INVALIDATION: 'Señal invalidada', TRAILING_STOP: 'Stop móvil',
};
const reason = (value?: string) => escape(value ? reasons[value] ?? value : 'Sin motivo informado');

export function telegramSignalNotice(signal: MarketSignal, order: ExchangeOrder) {
  return notice(['📡 <b>Señal de compra detectada</b>',
    `${label(order.executionMode ?? 'PAPER')} · ${escape(signal.strategy)} · BTC/USDT`, '',
    `Precio de referencia: ${bold(`${money(signal.referencePrice)} USDT`)}`,
    `Saldo reservado: ${code(`${money(order.reservedQuote)} USDT`)}`, '',
    '<i>Compra pendiente de ejecución. El precio final puede variar.</i>',
    '📋 Consultar: /ordenes',
  ]);
}

export function telegramFillNotice(fill: Fill, position?: Position, order?: ExchangeOrder) {
  const buy = fill.side === 'BUY';
  const partial = order?.status === 'PARTIALLY_FILLED';
  const feeAsset = fill.commissionAsset ?? 'USDT';
  return notice([`${buy ? '🟢' : '🔴'} ${bold(`${buy ? 'Compra' : 'Venta'} ${partial ? 'parcial ejecutada' : 'ejecutada'}`)}`,
    position ? context(position) : `${label(order?.executionMode ?? 'PAPER')} · BTC/USDT`, '',
    `Precio: ${bold(`${money(fill.price)} USDT`)}`,
    `Cantidad ejecutada: ${code(`${quantity(fill.quantity)} BTC`)}`,
    `Importe: ${code(`${money(fill.quote)} USDT`)}`,
    `Comisión: ${code(`${new Decimal(fill.commission).toFixed(feeAsset === 'BTC' ? 8 : 4)} ${feeAsset}`)}`,
    ...(buy && position ? ['', `🎯 Objetivo: ${bold(`${money(position.dynamicTakeProfit?.originalTarget ?? position.takeProfit)} USDT`)}`,
      ...(new Decimal(position.stopLoss).gt(0) ? [`Protección: ${money(position.stopLoss)} USDT`] : ['<i>Sin stop de precio.</i>'])] : []),
    ...(!buy && order ? [`Motivo: ${reason(order.reason)}`] : []),
    ...(partial ? ['', '<i>La orden sigue parcialmente ejecutada; queda cantidad pendiente.</i>'] : []), '',
    `<i>${new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' }).format(new Date(fill.at))} (Buenos Aires)</i>`,
    ...(position ? [positionRef(position)] : []),
    '📂 Consultar: /abiertas · 📋 /ordenes',
  ]);
}

export function telegramClosedNotice(position: Position) {
  const net = new Decimal(position.realizedPnl);
  return notice(['🏁 <b>Posición cerrada</b>', context(position), '',
    `${net.gt(0) ? '🟢' : net.lt(0) ? '🔴' : '⚪'} Resultado neto: ${bold(`${net.toFixed(4)} USDT`)}`,
    `Motivo: ${reason(position.exitReason)}`, '', positionRef(position), '📊 Ver resultados: /resumen',
  ]);
}

export function telegramDynamicNotice(position: Position, exitRequested: boolean) {
  const dynamic = position.dynamicTakeProfit!;
  return notice([exitRequested ? '📤 <b>Venta límite solicitada</b>' : '🎯 <b>Seguimiento dinámico activado</b>',
    context(position), '',
    `Objetivo mínimo: ${bold(`${money(dynamic.originalTarget)} USDT`)}`,
    ...(exitRequested ? [`Máximo observado: ${money(dynamic.peak)} USDT`, '',
      '<i>La venta está pendiente de ejecución.</i>'] : ['',
      '<i>Objetivo alcanzado. Siguiendo el precio para evaluar la salida; todavía sin venta solicitada.</i>']),
    positionRef(position), '📂 Consultar: /abiertas · 📋 /ordenes',
  ]);
}

export function telegramOrderErrorNotice(order: ExchangeOrder) {
  return notice([`⚠️ ${bold(order.status === 'CANCELLED' ? 'Orden cancelada' : 'Orden rechazada')}`,
    `${label(order.executionMode ?? 'PAPER')} · ${order.side === 'BUY' ? 'Compra' : 'Venta'} · BTC/USDT`, '',
    ...(order.rejection ? [`Motivo: ${escape(order.rejection)}`] : []),
    `Orden: ${code(order.id)}`, '', '📋 Consultar: /ordenes',
  ]);
}

export function telegramUnprotectedNotice(position: Position) {
  return notice(['⚠️ <b>Posición sin protección</b>', context(position), '',
    'La posición no tiene un stop de precio válido.', positionRef(position), '📂 Consultar: /abiertas',
  ]);
}
