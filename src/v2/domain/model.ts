export type Timeframe = '1m' | '5m' | '1h';
import type { BtcV3Parameters, BtcV3Calibration } from '../strategy/btc-v3.config';
export type StrategyId = 'legacy-v1' | 'btc-v2' | 'btc-v3' | 'trend-reference';
export const SIMULATOR_REVISION = 'paper-2026-11-20.causal-2';
export interface Candle {
  symbol: 'BTCUSDT';
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface SimulationConfig {
  btcV3?:BtcV3Parameters;
  btcV3Calibration?:BtcV3Calibration;
  buyCommissionAsset?: 'USDT' | 'BTC';
  stopModel?: 'STRUCTURE_ATR' | 'ATR_ONLY';
  confirmation5m?: boolean;
  disabledConditions?: string[];
  timeExit?: boolean;
  invalidationExit?: boolean;
  feeRate: number;
  spreadBps: number;
  slippageBps: number;
  participationRate: number;
  stepSize: number;
  tickSize: number;
  minQty: number;
  minNotional: number;
  takeProfit: number;
  atrMultiplier: number;
  maxStopPercent: number;
  maxRiskPerTrade: number;
  maxExposure: number;
  dailyLossLimit: number;
  maxHoldingMs: number;
  trailing: boolean;
  trailingActivation: number;
  trendFilter: boolean;
  signalMaxAgeMs: number;
}
export const DEFAULT_SIMULATION: SimulationConfig = {
  feeRate: 0.001,
  spreadBps: 2,
  slippageBps: 3,
  participationRate: 0.001,
  stepSize: 0.00001,
  tickSize: 0.01,
  minQty: 0.00001,
  minNotional: 5,
  takeProfit: 0.01,
  atrMultiplier: 1.5,
  maxStopPercent: 0.02,
  maxRiskPerTrade: 0.02,
  maxExposure: 0.8,
  dailyLossLimit: 0.03,
  maxHoldingMs: 86400000,
  trailing: false,
  trailingActivation: 0.008,
  trendFilter: true,
  signalMaxAgeMs: 120000,
};
export interface MarketSignal {
  id: string;
  strategy: StrategyId;
  strategyRevision: string;
  symbol: 'BTCUSDT';
  candleTime: number;
  referencePrice: number;
  atr: number;
  swingLow: number;
  regime: string;
  conditions: Record<string, boolean>;
  config: SimulationConfig;
  protection?: { stopPrice: number; targetPrice: number; horizonMs: number; timeframe: '5m'|'1h'|'4h' };
  forecast?:{calibrationId:string;sampleCount:number;expectedGrossReturn:number;expectedGrossLower95:number;favorablePotentialP25:number;roundTripBreakEven:number};
}
export interface ExecutionRisk {
  at: number;
  referencePrice: string;
  executedPrice: string;
  unroundedStop: string;
  stopPrice: string;
  stopRounding: string;
  distanceFromReferencePct: number;
  distanceFromExecutedPct: number;
  grossRiskFromReference: string;
  grossRiskFromExecuted: string;
  estimatedNetStopLoss: string;
  estimatedNetTargetPnl:string;
  roundTripFeesQuote: string;
  roundTripExecutionImpactQuote: string;
  untradableQuantity: string;
  riskLimitQuote: string;
  equityQuote: string;
  accepted: boolean;
  reason: string;
}
export interface LiquidityObservation { openTime: number; closeTime: number; volume: number }
export interface CausalLiquidityBudget {
  barOpenTime: number;
  sourceCloseTime: number | null;
  capacity: number;
  used: number;
}
export interface UserSignalDecision {
  id: string;
  signalId: string;
  accountId: string;
  accepted: boolean;
  action?:'BUY'|'NO_TRADE';
  reason: string;
  at: number;
}
export interface OrderIntent {
  id: string;
  accountId: string;
  positionId: string;
  signalId: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'PROTECTION';
  quantity: string;
  limitPrice?: string;
  reason: string;
  createdAt: number;
}
export interface ExchangeOrder extends OrderIntent {
  /** Venue inherited from the position at order creation. */
  executionMode: 'PAPER' | 'LIVE';
  status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'UNKNOWN';
  filledQuantity: string;
  reservedQuote: string;
  rejection?: string;
  executionRisk?: ExecutionRisk;
  deferredReason?: string;
}
export interface Fill {
  id: string;
  orderId: string;
  positionId: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  quote: string;
  commission: string;
  commissionAsset: 'USDT' | 'BTC';
  commissionQuote?: string;
  referencePrice?: string;
  spreadCostQuote?: string;
  slippageCostQuote?: string;
  roundingCostQuote?: string;
  at: number;
  executionPhase?: 'OPEN'|'INTRABAR'|'CLOSE'|'DECISION';
  liquiditySourceCloseTime?: number | null;
  liquidityCapacity?: number;
}
export interface LedgerEntry {
  id: string;
  orderId: string;
  positionId: string;
  asset: 'USDT' | 'BTC';
  availableDelta: string;
  reservedDelta: string;
  reason: string;
  at: number;
}
export interface Position {
  id: string;
  accountId: string;
  signalId: string;
  strategy: StrategyId;
  /** Execution venue chosen when this position was opened; never rewritten by later account changes. */
  executionMode: 'PAPER' | 'LIVE';
  strategyRevision?: string;
  protectionMode?: 'ABSOLUTE'|'REANCHORED';
  plannedStop?: string;
  plannedTarget?: string;
  entryReferenceQuote?: string;
  signalReferencePrice?:number;
  forecast?:MarketSignal['forecast'];
  executionRisk?: ExecutionRisk;
  regime: string;
  status: 'OPENING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'REJECTED' | 'DUST';
  quantity: string;
  entryQuantity: string;
  entryGrossQuantity?: string;
  entryQuote: string;
  entryFees: string;
  remainingCost: string;
  averageEntry: string;
  realizedPnl: string;
  stopLoss: string;
  takeProfit: string;
  highWater: string;
  atr: string;
  stopDistance: number;
  targetDistance: number;
  openedAt: number;
  closedAt?: number;
  exitReason?: string;
  config: SimulationConfig;
}
export interface VirtualAccount {
  id: string;
  userId: string;
  initialCapital: string;
  available: string;
  reserved: string;
  entriesEnabled: boolean;
  /** Default venue for new positions. Existing positions retain their own executionMode. */
  executionMode: 'PAPER' | 'LIVE';
  maxPositions: number;
  usdtPerTrade: string;
  lastCandleTime: number;
  day: string;
  dayStartEquity: string;
  dayPnl: string;
  lastLiquidityObservation?: LiquidityObservation;
}
export interface AccountState {
  account: VirtualAccount;
  positions: Position[];
  orders: ExchangeOrder[];
  fills: Fill[];
  ledger: LedgerEntry[];
  decisions: UserSignalDecision[];
}
export const isOrderOpen = (o: ExchangeOrder): boolean =>
  ['PENDING', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(o.status);
export const isPositionOpen = (p: Position): boolean =>
  ['OPENING', 'OPEN', 'CLOSING', 'DUST'].includes(p.status);
