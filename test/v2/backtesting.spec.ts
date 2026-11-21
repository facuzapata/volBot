import { BacktestingEngine, CandleAggregator } from '../../src/v2/backtesting/backtesting.engine';
import { Candle } from '../../src/v2/domain/model';
import { StrategyEngine } from '../../src/v2/strategy/strategy-engine';
import { bar } from './fixtures';

describe('Backtesting engine chronology and reproducibility', () => {
  const options = {
    strategy: 'legacy-v1' as const,
    initialCapital: 500,
    maxPositions: 5,
    usdtPerTrade: 30,
  };
  const bars = Array.from({ length: 120 }, (_, i) =>
    bar(1735689600000 + i * 60000, {
      open: 100000 + i * 10,
      close: 100005 + i * 10,
      high: 100100 + i * 10,
      low: 99900 + i * 10,
    }),
  );
  it('normalizes reverse order and returns reproducible reports', () => {
    const engine = new BacktestingEngine();
    expect(engine.run([...bars].reverse(), options)).toEqual(engine.run(bars, options));
  });
  it('rejects duplicated, missing or non-BTCUSDT candles', () => {
    const engine = new BacktestingEngine();
    expect(() => engine.run([...bars, bars[0]], options)).toThrow('CONTIGUOUS');
    expect(() => engine.run(bars.slice(0, 10).concat(bars.slice(11)), options)).toThrow(
      'CONTIGUOUS',
    );
    expect(() =>
      engine.run([{ ...bars[0], symbol: 'BTC/USD' } as unknown as Candle], options),
    ).toThrow('CONTIGUOUS');
  });
  it('never passes a higher timeframe candle closing after the current decision', () => {
    const engine = new StrategyEngine();
    const seen: number[] = [];
    jest.spyOn(engine, 'evaluate').mockImplementation((h) => {
      const at = h['1m'].slice(-1)[0].closeTime;
      seen.push(at);
      expect(h['5m'].every((c) => c.closeTime <= at)).toBe(true);
      expect(h['1h'].every((c) => c.closeTime <= at)).toBe(true);
      return null;
    });
    new BacktestingEngine(engine).run(bars, options);
    expect(seen).toHaveLength(120);
  });
  it('does not emit partial higher-timeframe buckets', () => {
    const aggregator = new CandleAggregator();
    expect(aggregator.push(bars[0])).toEqual([]);
    let results: Candle[] = [];
    for (const b of bars.slice(1, 5)) results = aggregator.push(b);
    expect(results).toHaveLength(1);
    expect(results[0].timeframe).toBe('5m');
    expect(results[0].open).toBe(bars[0].open);
    expect(results[0].close).toBe(bars[4].close);
  });
  it('exposes losses in statistics rather than filtering by closing reason', () => {
    const report = new BacktestingEngine().run(bars, options);
    expect(report.metrics).toHaveProperty('netRealizedPnl');
    expect(report.metrics).toHaveProperty('maxDrawdown');
    expect(report).toHaveProperty('datasetHash');
  });
  it('records research gaps and resets history instead of inventing candles', () => {
    const engine = new StrategyEngine(); const lengths:number[]=[];
    jest.spyOn(engine,'evaluate').mockImplementation(h=>{lengths.push(h['1m'].length);return null});
    const report=new BacktestingEngine(engine).run(bars.slice(0,10).concat(bars.slice(11)),{...options,allowDataGaps:true});
    expect(report.dataQuality.missingMinutes).toBe(1);
    expect(lengths[10]).toBe(1);
  });
  it('produces identical results when reusing an engine with closed-timeframe caches', () => {
    const engine=new BacktestingEngine(new StrategyEngine());
    const original=engine.run(bars,options);
    expect(engine.run(bars,options)).toEqual(original);
    expect(original).toEqual(new BacktestingEngine(new StrategyEngine()).run(bars,options));
  });
});
