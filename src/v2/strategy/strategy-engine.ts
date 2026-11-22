import { createHash } from 'crypto';
import * as indicators from '../../utils/indicators';
import { BtcV3Strategy, V3Assessment } from './btc-v3.strategy';
import { revisionFor } from './versions';
import {
  Candle,
  DEFAULT_SIMULATION,
  MarketSignal,
  SimulationConfig,
  StrategyId,
  Timeframe,
} from '../domain/model';

export type MarketHistory = Record<Timeframe, Candle[]>;
export const STRATEGY_REVISION = '2026-11-20.1';
export interface Technical {
  sma9:number; sma21:number; sma50:number; ema12:number; ema26:number; rsi:number; atr:number;
  bb:{lower:number;middle:number;upper:number}; volumeMA:number; macd:number; signal:number; histogram:number;
}
export class StrategyEngine {
  lastV3Assessment?:V3Assessment;
  private readonly btcV3=new BtcV3Strategy(b=>this.technical(b));
  lastAssessment?: { at:number; eligible:boolean; regime:string; reason:string; conditions:Record<string,boolean> };
  private readonly closedCache = new WeakMap<Candle, { first:Candle; length:number; value:Technical|null }>();
  evaluate(
    history: MarketHistory,
    strategy: StrategyId,
    config: SimulationConfig = DEFAULT_SIMULATION,
  ): MarketSignal | null {
    if(strategy==='btc-v3'){
      const a=this.btcV3.assess(history,config);this.lastV3Assessment=a;
      this.lastAssessment={at:a.at,eligible:a.decision==='BUY',regime:a.conditions.primaryTrend?'up':'other',reason:a.reason,conditions:a.conditions};
      return a.signal??null;
    }
    this.lastV3Assessment=undefined;
    if(strategy==='trend-reference'){
      const last=history['1m'].at(-1),hourBars=history['1h'].filter(b=>b.closeTime<=(last?.closeTime??0)),hour=this.technical(hourBars.slice(-100)),one=this.technical(history['1m'].slice(-100));
      const eligible=!!last&&!!hour&&!!one&&hour.ema12>hour.ema26&&hourBars.at(-1)!.close>hour.sma21;
      this.lastAssessment={at:last?.closeTime??0,eligible,regime:eligible?'up':'other',reason:eligible?'SIGNAL_ELIGIBLE':'NO_PRIMARY_TREND',conditions:{primaryTrend:eligible}};
      if(!eligible)return null;
      return{id:createHash('sha256').update(`trend-reference:${revisionFor(strategy)}:${last.closeTime}`).digest('hex'),strategy,strategyRevision:revisionFor(strategy),symbol:'BTCUSDT',candleTime:last.closeTime,referencePrice:last.close,atr:one!.atr,swingLow:Math.min(...history['1m'].slice(-10).map(b=>b.low)),regime:'up',conditions:{primaryTrend:true},config:{...config}};
    }
    this.lastAssessment = undefined;
    const bars = history['1m'];
    const last = bars[bars.length - 1];
    if (!last || bars.length < 50) return null;
    const data = this.technical(bars.slice(-100));
    if (!data) return null;
    const { sma9, sma21, sma50, ema12, ema26, rsi, macd, signal, histogram, atr, bb, volumeMA } =
      data;
    const up = sma9 > sma21 && sma21 > sma50 && ema12 > ema26;
    const down = sma9 < sma21 && sma21 < sma50 && ema12 < ema26;
    const conditions: Record<string, boolean> = {
      trend: up || (!up && !down && macd > signal),
      rsi: rsi >= 25 && rsi <= 65,
      momentum: macd > signal || histogram > 0,
      candle: indicators.isBullishEngulfing(bars) || last.close > last.open,
      pullback: last.close <= bb.lower * 1.005 || last.close < sma9,
      volume: last.volume > volumeMA * 1.2,
      structure: last.close > sma21 * 0.995,
    };
    let eligible = Object.values(conditions).filter(Boolean).length >= 5;
    let regime = up ? 'up' : down ? 'down' : 'range';
    if (strategy === 'btc-v2') {
      // Use only higher timeframe bars already closed at the decision timestamp.
      const hour = this.technical(
        history['1h'].filter((c) => c.closeTime <= last.closeTime).slice(-100),
      );
      const five = this.technical(
        history['5m'].filter((c) => c.closeTime <= last.closeTime).slice(-100),
      );
      if (!hour || !five) return null;
      const hourBars = history['1h'].filter((c) => c.closeTime <= last.closeTime);
      const hourLast = hourBars[hourBars.length - 1];
      conditions.primaryTrend =
        hour.ema12 > hour.ema26 && hour.sma9 > hour.sma21 && hourLast.close > hour.sma50;
      conditions.confirmation = five.macd > five.signal && five.sma9 > five.sma21;
      conditions.entryMomentum = rsi >= 35 && rsi <= 65 && histogram > 0;
      conditions.rsiEntry = rsi >= 35 && rsi <= 65;
      conditions.macdEntry = histogram > 0;
      conditions.costCoverage =
        config.takeProfit >
        2 * config.feeRate + (config.spreadBps + 2 * config.slippageBps) / 10000;
      const disabled = new Set(config.disabledConditions || []);
      const required = [
        ...(config.trendFilter ? ['primaryTrend'] : []),
        ...(config.confirmation5m === false ? [] : ['confirmation']),
        'costCoverage',
        'rsiEntry',
        'macdEntry',
        'candle',
        'volume',
        'structure',
      ].filter((key) => !disabled.has(key));
      eligible = required.every((key) => conditions[key]);
      regime = conditions.primaryTrend ? 'up' : hour.ema12 < hour.ema26 ? 'down' : 'range';
      const failed = required.filter((key) => !conditions[key]);
      this.lastAssessment = {
        at: last.closeTime,
        eligible,
        regime,
        reason: eligible ? 'SIGNAL_ELIGIBLE' : failed.map((key) => `NO_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`).join('|'),
        conditions,
      };
    } else {
      this.lastAssessment = {
        at: last.closeTime,
        eligible,
        regime,
        reason: eligible ? 'SIGNAL_ELIGIBLE' : 'INSUFFICIENT_LEGACY_CONDITIONS',
        conditions,
      };
    }
    if (!eligible) return null;
    const id = createHash('sha256')
      .update(`${strategy}:${STRATEGY_REVISION}:BTCUSDT:${last.closeTime}`)
      .digest('hex');
    return {
      id,
      strategy,
      strategyRevision: STRATEGY_REVISION,
      symbol: 'BTCUSDT',
      candleTime: last.closeTime,
      referencePrice: last.close,
      atr,
      swingLow: Math.min(...bars.slice(-10).map((c) => c.low)),
      regime,
      conditions,
      config: { ...config },
    };
  }
  invalidated(history: MarketHistory): boolean {
    const bars = history['1h'];
    const t = this.technical(bars.slice(-100));
    return !!t && t.ema12 < t.ema26 && t.sma9 < t.sma21;
  }
  technical(bars: Candle[]): Technical | null {
    if (bars.length < 50) return null;
    // Closed candles are immutable. Cache only repeated 5m/1h snapshots, never future candles.
    const last = bars[bars.length-1]; const cached = this.closedCache.get(last);
    if (last.timeframe !== '1m' && cached?.first === bars[0] && cached.length === bars.length) return cached.value;
    const value = this.calculateTechnical(bars);
    if (last.timeframe !== '1m') this.closedCache.set(last, { first:bars[0], length:bars.length, value });
    return value;
  }
  private calculateTechnical(bars: Candle[]): Technical | null {
    if (bars.length < 50) return null;
    const closes = bars.map((c) => c.close);
    const volumes = bars.map((c) => c.volume);
    const sma9 = indicators.calculateSMA(closes, 9);
    const sma21 = indicators.calculateSMA(closes, 21);
    const sma50 = indicators.calculateSMA(closes, 50);
    const ema12 = indicators.calculateEMA(closes, 12);
    const ema26 = indicators.calculateEMA(closes, 26);
    const rsi = indicators.calculateRSI(closes, 14);
    const m = indicators.calculateMACD(closes);
    const atr = indicators.calculateATR(bars.slice(-20), 14);
    const bb = indicators.calculateBollingerBands(closes, 20);
    const volumeMA = indicators.calculateSMA(volumes, 10);
    if ([sma9, sma21, sma50, ema12, ema26, rsi, atr, volumeMA].some((x) => x === null) || !m || !bb)
      return null;
    return {
      sma9: sma9!,
      sma21: sma21!,
      sma50: sma50!,
      ema12: ema12!,
      ema26: ema26!,
      rsi: rsi!,
      atr: atr!,
      bb,
      volumeMA: volumeMA!,
      macd: m.macdLine[m.macdLine.length - 1],
      signal: m.signalLine[m.signalLine.length - 1],
      histogram: m.histogram[m.histogram.length - 1],
    };
  }
}
