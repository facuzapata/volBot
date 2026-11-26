import { Candle, MarketSignal } from '../domain/model';
import { PriceObservation } from '../execution/dynamic-take-profit';

export interface Payloads {
  'market.price.observed.v1': PriceObservation;
  'market.candle.closed.v1': { candle: Candle; recovered: boolean };
  'strategy.signal.created.v1': { signal: MarketSignal };
  'execution.command.v1': { accountId: string; orderId: string; signalTime: number; price: number };
  'execution.order.updated.v1': { accountId: string; orderId: string; status: string };
  'position.updated.v1': { accountId: string; positionId: string; status: string; netPnl: string };
  'notification.requested.v1': { userId: string; kind: string; text: string };
}
export type Topic = keyof Payloads;
export const TOPICS: Topic[] = [
  'market.price.observed.v1',
  'market.candle.closed.v1',
  'strategy.signal.created.v1',
  'execution.command.v1',
  'execution.order.updated.v1',
  'position.updated.v1',
  'notification.requested.v1',
];
export interface DomainEvent<T extends Topic = Topic> {
  eventId: string;
  schemaVersion: 1;
  topic: T;
  key: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  payload: Payloads[T];
}
