import { BtcV5Strategy } from '../../src/v2/strategy/btc-v5.strategy';
import { BTC_V5_REVISION } from '../../src/v2/strategy/btc-v5.config';
import { strategyConfiguration, revisionFor } from '../../src/v2/strategy/versions';
import { Candle, Position } from '../../src/v2/domain/model';
import { MarketHistory } from '../../src/v2/strategy/strategy-engine';
import { RiskPolicy } from '../../src/v2/risk/risk-policy';
import { newAccount } from '../../src/v2/execution/paper-execution.adapter';

describe('BTC-V5 structure/retest candidate', () => {
  const end = Date.UTC(2025, 0, 5) - 1;
  const series = (timeframe: '1m' | '5m' | '1h', step: number, count: number, increment = 10): Candle[] =>
    Array.from({ length: count }, (_, index) => {
      const closeTime = end - (count - 1 - index) * step;
      const close = 13000 - (count - 1 - index) * increment;
      return {
        symbol: 'BTCUSDT', timeframe, closeTime, openTime: closeTime - step + 1,
        open: close - 5, high: close + 4, low: close - 10, close, volume: 100,
      };
    });
  const history = (): MarketHistory => {
    const result: MarketHistory = {
      '1m': series('1m', 60000, 100),
      '5m': series('5m', 300000, 100),
      '1h': series('1h', 3600000, 300, 1),
    };
    result['1m'].forEach((bar) => { bar.open = bar.close - 0.5; bar.high = bar.close + 0.2; bar.low = bar.close - 1; });
    result['5m'].slice(-6, -3).forEach((bar) => { bar.low -= 500; });
    result['5m'].slice(-3).forEach((bar) => { bar.volume = 200; });
    return result;
  };
  const closedStop = (at: number): Position => ({
    id: `closed-${at}`, accountId: 'v5', signalId: `signal-${at}`, strategy: 'btc-v5', executionMode: 'PAPER',
    regime: 'up', status: 'CLOSED', quantity: '0', entryQuantity: '0', entryQuote: '0', entryFees: '0',
    remainingCost: '0', averageEntry: '0', realizedPnl: '-1', stopLoss: '1', takeProfit: '2', highWater: '1', atr: '1',
    stopDistance: 0.01, targetDistance: 0.025, openedAt: at - 60000, closedAt: at, exitReason: 'STOP_LOSS',
    config: strategyConfiguration('btc-v5'),
  });

  it('emits a one-minute entry from its four-hour, one-hour, and fifteen-minute structure', () => {
    const assessment = new BtcV5Strategy().assess(history(), strategyConfiguration('btc-v5'));
    expect(assessment.decision).toBe('BUY');
    expect(assessment.signal).toMatchObject({ strategy: 'btc-v5', strategyRevision: BTC_V5_REVISION });
    expect(assessment.signal!.conditions.recoveryQuality).toBe(true);
    expect(assessment.signal!.protection).toMatchObject({ timeframe: '1h' });
  });

  it('keeps an independently versioned configuration', () => {
    expect(revisionFor('btc-v5')).toBe(BTC_V5_REVISION);
    expect(strategyConfiguration('btc-v5').btcV5?.revision).toBe(BTC_V5_REVISION);
  });

  it('rejects a retest whose fifteen-minute volume does not confirm the recovery', () => {
    const data = history();
    data['5m'].forEach((bar) => { bar.volume = 100; });
    const assessment = new BtcV5Strategy().assess(data, strategyConfiguration('btc-v5'));
    expect(assessment.decision).toBe('NO_TRADE');
    expect(assessment.reason).toContain('NO_RECOVERY_QUALITY');
  });

  it('requires quality after one stop and cools down after two without increasing ticket size', () => {
    const signal = new BtcV5Strategy().assess(history(), strategyConfiguration('btc-v5')).signal!;
    const state = newAccount('v5', 'v5');
    state.account.entriesEnabled = true;
    state.positions.push(closedStop(signal.candleTime - 60000));
    const policy = new RiskPolicy();
    const weak = { ...signal, id: 'weak', conditions: { ...signal.conditions, recoveryQuality: false } };
    expect(policy.reserve(state, weak, signal.candleTime).reason).toBe('V5_RECOVERY_QUALITY_REQUIRED');
    const strongAfterOneStop = { ...signal, id: 'strong-after-one-stop' };
    expect(policy.reserve(state, strongAfterOneStop, signal.candleTime).accepted).toBe(true);
    expect(state.orders.at(-1)?.reservedQuote).toBe('30.000000000000');

    const halted = newAccount('v5-halted', 'v5-halted');
    halted.account.entriesEnabled = true;
    halted.positions.push(closedStop(signal.candleTime - 60000));
    halted.positions.push(closedStop(signal.candleTime - 30000));
    const strong = { ...signal, id: 'strong' };
    expect(policy.reserve(halted, strong, signal.candleTime + 1).reason).toBe('V5_CONSECUTIVE_STOP_COOLDOWN');
    expect(halted.orders).toHaveLength(0);
  });
});
