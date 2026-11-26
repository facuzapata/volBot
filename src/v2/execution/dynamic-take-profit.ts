import Decimal from 'decimal.js';

/** Sampled last-trade prices from the existing 1m kline stream, not candle highs. */
export interface PriceObservation {
  symbol: 'BTCUSDT';
  at: number;
  price: string;
}
export interface DynamicTakeProfitConfig {
  revision: 'v6-dtp-2026-11-26.1';
  noiseHalfLifeMs: number;
  noiseMultiplier: number;
  maxObservationAgeMs: number;
}
export const DEFAULT_DYNAMIC_TAKE_PROFIT: Readonly<DynamicTakeProfitConfig> = {
  revision: 'v6-dtp-2026-11-26.1',
  noiseHalfLifeMs: 30000,
  noiseMultiplier: 3,
  maxObservationAgeMs: 10000,
};
export interface DynamicTakeProfitState {
  phase: 'WAITING_TARGET' | 'TRACKING_PRICE' | 'SELL_ORDER_PENDING' | 'CLOSED' | 'DUST';
  originalTarget: string;
  peak: string;
  lastPrice?: string;
  lastAt?: number;
  noise: string;
  retracement: string;
  activatedAt?: number;
  exitRequestedAt?: number;
  config: DynamicTakeProfitConfig;
}
export function validDynamicTakeProfit(c: DynamicTakeProfitConfig): boolean {
  return c.revision === DEFAULT_DYNAMIC_TAKE_PROFIT.revision &&
    Number.isFinite(c.noiseHalfLifeMs) && c.noiseHalfLifeMs >= 1000 && c.noiseHalfLifeMs <= 300000 &&
    Number.isFinite(c.noiseMultiplier) && c.noiseMultiplier >= 1 && c.noiseMultiplier <= 10 &&
    Number.isFinite(c.maxObservationAgeMs) && c.maxObservationAgeMs >= 1000 && c.maxObservationAgeMs <= 30000;
}
/** Mutates only tracking metadata. Execution and accounting remain in the paper adapter. */
export function observeDynamicPrice(
  state: DynamicTakeProfitState, observation: PriceObservation, tickSize: number, noiseBps: number,
): boolean {
  const price = new Decimal(observation.price);
  if (!Number.isSafeInteger(observation.at) || !price.isFinite() || price.lte(0) ||
    (state.lastAt !== undefined && observation.at <= state.lastAt) ||
    state.phase === 'CLOSED' || state.phase === 'DUST') return false;
  const previousAt = state.lastAt;
  if (state.lastPrice !== undefined && previousAt !== undefined) {
    const elapsed = observation.at - previousAt;
    // A data gap is not a continuous price path; do not estimate its tick noise.
    const alpha = 1 - Math.pow(0.5, elapsed / state.config.noiseHalfLifeMs);
    state.noise = elapsed > state.config.maxObservationAgeMs ? '0' :
      new Decimal(state.noise).mul(1 - alpha)
        .plus(price.minus(state.lastPrice).abs().mul(alpha)).toFixed();
  }
  state.lastAt = observation.at;
  state.lastPrice = price.toFixed();
  state.retracement = Decimal.max(
    new Decimal(tickSize).mul(2), price.mul(noiseBps).div(10000),
    new Decimal(state.noise).mul(state.config.noiseMultiplier),
  ).toFixed();
  if (state.phase === 'SELL_ORDER_PENDING') return true;
  if (state.phase === 'WAITING_TARGET') {
    if (price.gte(state.originalTarget)) {
      state.phase = 'TRACKING_PRICE';
      state.activatedAt = observation.at;
      state.peak = price.toFixed();
    }
    return false;
  }
  state.peak = Decimal.max(state.peak, price).toFixed();
  return price.lte(state.originalTarget) ||
    new Decimal(state.peak).minus(price).gte(state.retracement);
}
