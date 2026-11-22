import { createHash } from 'crypto';
import {
  AccountState,
  Candle,
  isPositionOpen,
  MarketSignal,
  SimulationConfig,
  StrategyId,
  Timeframe,
  SIMULATOR_REVISION,
} from '../domain/model';
import { newAccount, PaperExecutionAdapter } from '../execution/paper-execution.adapter';
import { INTERVAL_MS, validCandle } from '../market/public-market.client';
import { MarketHistory, StrategyEngine } from '../strategy/strategy-engine';
import { RiskPolicy } from '../risk/risk-policy';
import { causalLiquidity } from '../execution/causal-liquidity';
import { strategyConfiguration, revisionFor } from '../strategy/versions';
import { validV3Parameters } from '../strategy/btc-v3.strategy';
import { validV4Parameters } from '../strategy/btc-v4.strategy';
import { validV5Parameters } from '../strategy/btc-v5.strategy';

export interface BacktestOptions {
  strategy: StrategyId;
  initialCapital: number;
  maxPositions: number;
  usdtPerTrade: number;
  config?: Partial<SimulationConfig>;
  allowDataGaps?: boolean;
}
export function statistics(s: AccountState, lastPrice: number, equityCurve: number[] = []) {
  const closed = s.positions.filter((p) => p.status === 'CLOSED');
  const wins = closed.filter((p) => Number(p.realizedPnl) > 0);
  const losses = closed.filter((p) => Number(p.realizedPnl) < 0);
  const positive = wins.reduce((n, p) => n + Number(p.realizedPnl), 0);
  const negative = -losses.reduce((n, p) => n + Number(p.realizedPnl), 0);
  const net = s.positions.reduce((n, p) => n + Number(p.realizedPnl), 0);
  const unrealized = s.positions.reduce(
    (n, p) => n + Number(p.quantity) * lastPrice - Number(p.remainingCost),
    0,
  );
  let peak = Number(s.account.initialCapital);
  let drawdown = 0;
  for (const equity of equityCurve) {
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak > 0 ? (peak - equity) / peak : 0);
  }
  const regimes: Record<string, { trades: number; netPnl: number }> = {};
  for (const p of closed) {
    regimes[p.regime] ??= { trades: 0, netPnl: 0 };
    regimes[p.regime].trades++;
    regimes[p.regime].netPnl += Number(p.realizedPnl);
  }
  return {
    mode: 'PAPER',
    closedTrades: closed.length,
    openPositions: s.positions.filter(isPositionOpen).length,
    netRealizedPnl: net,
    unrealizedPnl: unrealized,
    equity: Number(s.account.initialCapital) + net + unrealized,
    profitFactor: negative > 0 ? positive / negative : null,
    profitFactorUndefined: negative === 0,
    expectancy: closed.length ? (positive - negative) / closed.length : 0,
    winRate: closed.length ? wins.length / closed.length : 0,
    averageWin: wins.length ? positive / wins.length : 0,
    averageLoss: losses.length ? negative / losses.length : 0,
    maxDrawdown: equityCurve.length ? drawdown : null,
    averageHoldingMs: closed.length
      ? closed.reduce((n, p) => n + p.closedAt! - p.openedAt, 0) / closed.length
      : 0,
    immobilizedCapital:
      Number(s.account.reserved) + s.positions.reduce((n, p) => n + Number(p.remainingCost), 0),
    totalCommissions: s.fills.reduce((n, f) => n + Number(f.commissionQuote ?? f.commission), 0),
    regimes,
  };
}
/** Incremental aggregation emits only complete UTC-aligned buckets. */
export class CandleAggregator {
  private pending = new Map<Timeframe, Candle[]>();
  push(c: Candle): Candle[] {
    const completed: Candle[] = [];
    for (const tf of ['5m', '1h'] as Timeframe[]) {
      const step = INTERVAL_MS[tf];
      const bucket = Math.floor(c.openTime / step) * step;
      let bars = this.pending.get(tf) || [];
      if (bars.length && Math.floor(bars[0].openTime / step) * step !== bucket) bars = [];
      bars.push(c);
      this.pending.set(tf, bars);
      if (c.closeTime === bucket + step - 1) {
        if (bars.length === step / 60000 && bars[0].openTime === bucket)
          completed.push({
            symbol: 'BTCUSDT',
            timeframe: tf,
            openTime: bucket,
            closeTime: c.closeTime,
            open: bars[0].open,
            close: c.close,
            high: Math.max(...bars.map((b) => b.high)),
            low: Math.min(...bars.map((b) => b.low)),
            volume: bars.reduce((n, b) => n + b.volume, 0),
          });
        this.pending.set(tf, []);
      }
    }
    return completed;
  }
}
export class BacktestingEngine {
  constructor(
    private readonly strategy = new StrategyEngine(),
    private readonly paper = new PaperExecutionAdapter(),
    private readonly risk = new RiskPolicy(),
  ) {}
  run(input: Candle[], options: BacktestOptions, tradeStart?: number, tradeEnd?: number) {
    if (
      !['legacy-v1', 'btc-v2','btc-v3','btc-v4','btc-v5','trend-reference'].includes(options.strategy) ||
      !Number.isFinite(options.initialCapital) ||
      options.initialCapital < 10 ||
      !Number.isInteger(options.maxPositions) ||
      options.maxPositions < 1 ||
      options.maxPositions > 20 ||
      !Number.isFinite(options.usdtPerTrade) ||
      options.usdtPerTrade < 5
    )
      throw new Error('INVALID_BACKTEST_OPTIONS');
    const candles = [...input].sort((a, b) => a.openTime - b.openTime);
    if (
      !candles.length ||
      candles.some(
        (c, i) =>
          !validCandle(c) ||
          c.timeframe !== '1m' ||
          (i > 0 &&
            (c.openTime <= candles[i - 1].openTime ||
              (!options.allowDataGaps && c.openTime !== candles[i - 1].openTime + 60000))),
      )
    )
      throw new Error('BACKTEST_REQUIRES_CONTIGUOUS_UNIQUE_BTCUSDT_1M');
    const config = strategyConfiguration(options.strategy,options.config);
    if(options.strategy==='btc-v3'&&!validV3Parameters(config.btcV3!))throw new Error('INVALID_BTC_V3_CONFIG');
    if(options.strategy==='btc-v4'&&!validV4Parameters(config.btcV4!))throw new Error('INVALID_BTC_V4_CONFIG');
    if(options.strategy==='btc-v5'&&!validV5Parameters(config.btcV5!))throw new Error('INVALID_BTC_V5_CONFIG');
    if (
      Object.entries(config).some(
        ([key, value]) =>
          typeof value === 'number' &&
          (!Number.isFinite(value) || value < 0 || (key.endsWith('Size') && value === 0)),
      ) ||
      config.feeRate > 0.01 ||
      config.slippageBps > 100 ||
      config.spreadBps > 100 ||
      config.participationRate <= 0 ||
      config.participationRate > 1 ||
      config.minQty <= 0
      || (config.buyCommissionAsset !== undefined && !['BTC','USDT'].includes(config.buyCommissionAsset))
    )
      throw new Error('INVALID_SIMULATION_CONFIG');
    const state = newAccount(
      'backtest',
      'backtest',
      options.initialCapital,
      options.maxPositions,
      options.usdtPerTrade,
    );
    state.account.entriesEnabled = true;
    const history: MarketHistory = { '1m': [], '5m': [], '1h': [] };
    const aggregator = new CandleAggregator();
    const equityCurve: number[] = [];
    let maxSimultaneous = 0;
    let eligible = false;
    let pending: MarketSignal | null = null;
    let gapCount = 0;
    let missingMinutes = 0;
    const abstentions:Record<string,number>={};
    let previousTime: number | undefined;
    for (const c of candles) {
      if (tradeEnd !== undefined && c.openTime > tradeEnd) break;
      const trading = tradeStart === undefined || c.openTime >= tradeStart;
      if (previousTime !== undefined && c.openTime !== previousTime + 60000) {
        gapCount++;
        missingMinutes += (c.openTime - previousTime) / 60000 - 1;
        pending = null;
        eligible = false;
        history['1m'] = [];
        history['5m'] = [];
        history['1h'] = [];
      }
      previousTime = c.openTime;
      const budget=causalLiquidity(c.openTime,history['1m'].at(-1),config.participationRate);
      if (pending && trading) {
        const decision = this.risk.reserve(state, pending, c.openTime);
        if (decision.accepted) {
          const o = state.orders.find((o) => o.signalId === pending!.id && o.side === 'BUY')!;
          this.paper.execute(
            state,
            o.id,
            c.open,
            c.openTime,
            budget,
            'OPEN',
          );
        }
      }
      pending = null;
      // Only prior higher timeframe bars can invalidate a position during the current candle.
      if (trading) this.paper.onCandle(state, c, this.strategy.invalidated(history),()=>true,budget);
      for (const bar of [c, ...aggregator.push(c)]) {
        history[bar.timeframe].push(bar);
        history[bar.timeframe] = history[bar.timeframe].slice(bar.timeframe === '1h' ? -500 : -100);
      }
      const signal = this.strategy.evaluate(history, options.strategy, config);
      if(trading&&options.strategy==='btc-v3'&&this.strategy.lastV3Assessment?.decision==='NO_TRADE'){
        const reason=this.strategy.lastV3Assessment.reason;abstentions[reason]=(abstentions[reason]??0)+1;
      } else if (trading && (options.strategy === 'btc-v4' || options.strategy === 'btc-v5') && this.strategy.lastAssessment && !this.strategy.lastAssessment.eligible) {
        const reason=this.strategy.lastAssessment.reason;abstentions[reason]=(abstentions[reason]??0)+1;
      }
      if (signal && !eligible && trading) pending = signal;
      eligible = !!signal;
      if (trading) {
        equityCurve.push(this.paper.equity(state, c.close).toNumber());
        maxSimultaneous = Math.max(maxSimultaneous, state.positions.filter(isPositionOpen).length);
      }
    }
    const last = candles
      .filter((c) => tradeEnd === undefined || c.openTime <= tradeEnd)
      .slice(-1)[0];
    return {
      strategy: options.strategy,
      strategyRevision: revisionFor(options.strategy),
      simulatorRevision: SIMULATOR_REVISION,
      dataQuality: {
        gapCount,
        missingMinutes,
        policy: options.allowDataGaps
          ? 'no invented bars; reset indicators; manage existing positions at next known bar'
          : 'reject gaps',
      },
      options: { ...options, config },
      datasetHash: createHash('sha256').update(JSON.stringify(candles)).digest('hex'),
      firstTime: candles[0].openTime,
      lastTime: last.closeTime,
      tradeStart,
      tradeEnd,
      executionPolicy:
        'signal at close; entry next open; causal previous-minute volume, shared across phases; stop first on ambiguous bars; gaps use worse open; no forced final liquidation',
      metrics: { ...statistics(state, last.close, equityCurve), maxSimultaneous },
      equityCurve,
      trades: state.positions,
      orders: state.orders,
      fills: state.fills,
      ledger: state.ledger,
      decisions: state.decisions,
      abstentions,
      balance: state.account,
    };
  }
  compare(candles: Candle[], base: Omit<BacktestOptions, 'strategy'>) {
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const train = Math.floor(sorted.length * 0.7);
    const validation = Math.floor(sorted.length * 0.85);
    if (train < 1 || validation >= sorted.length) throw new Error('INSUFFICIENT_SPLIT_DATA');
    const variants: BacktestOptions[] = [
      { ...base, strategy: 'legacy-v1' },
      { ...base, strategy: 'btc-v2' },
      { ...base, strategy: 'btc-v2', config: { ...base.config, trendFilter: false } },
      { ...base, strategy: 'btc-v2', config: { ...base.config, atrMultiplier: 2 } },
      { ...base, strategy: 'btc-v2', config: { ...base.config, takeProfit: 0.008 } },
      {
        ...base,
        strategy: 'btc-v2',
        config: { ...base.config, takeProfit: 0.015, trailing: true },
      },
    ];
    return {
      splitPolicy:
        'chronological 70/15/15, independent capital, previous bars only for warmup; no automatic parameter selection',
      variants: variants.map((options) => ({
        options,
        training: this.run(sorted.slice(0, train), options),
        validation: this.run(sorted.slice(0, validation), options, sorted[train].openTime),
        outOfSample: this.run(sorted, options, sorted[validation].openTime),
      })),
    };
  }
}
