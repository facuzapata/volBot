import { ApiService } from '../../src/v2/api/api.service';
import { BacktestingEngine } from '../../src/v2/backtesting/backtesting.engine';
import { PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { RedisCacheService } from '../../src/v2/market/redis-cache.service';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';
import { StrategyVersionRow } from '../../src/v2/persistence/entities';
import { StoreService } from '../../src/v2/persistence/store.service';
import { StrategyApprovalService } from '../../src/v2/strategy/approval.service';
import { strategyConfiguration } from '../../src/v2/strategy/versions';
import { BTC_V5_REVISION } from '../../src/v2/strategy/btc-v5.config';

describe('strategy activation', () => {
  const v5Service = (rows: unknown[]) => new ApiService(
    { db: { getRepository: () => ({ find: async () => rows }) } } as unknown as StoreService,
    {} as never, new PaperExecutionAdapter(), { ready: true } as RedisCacheService,
    new BacktestingEngine(), {} as StrategyApprovalService,
    { config: strategyConfiguration('btc-v5') } as SimulationSettings, {} as never,
  );

  it('does not expose a stale V5 configuration as the newly deployed revision', async () => {
    const old = strategyConfiguration('btc-v5');
    old.btcV5 = { ...old.btcV5!, revision: '2026-11-22.v5.2', trendMinutes: 60, exitMode: 'STOP_TARGET' };
    const service = v5Service([{ id: 'btc-v5', revision: '2026-11-22.v5.2',
      state: { active: true, eligible: true, lastCandleTime: 123, configuration: old,
        lastDecision: { decision: 'BUY', reason: 'OLD_SETUP' } } }]);
    const strategy = (await service.strategies()).find(s => s.id === 'btc-v5')!;
    expect(strategy).toMatchObject({ active: true, revision: BTC_V5_REVISION, eligible: false, lastEvaluationAt: 0,
      configuration: { btcV5: { revision: BTC_V5_REVISION, trendMinutes: 15, exitMode: 'TARGET_ONLY' } } });
    expect(strategy.lastDecision).toBeUndefined();
  });

  it('preserves a current V5 worker snapshot and its actual costs and decision', async () => {
    const configuration = strategyConfiguration('btc-v5', { feeRate: 0.00075 });
    const service = v5Service([{ id: 'btc-v5', revision: BTC_V5_REVISION,
      state: { active: true, eligible: true, lastCandleTime: 123, configuration,
        lastDecision: { decision: 'BUY', reason: 'CURRENT_SETUP' } } }]);
    const strategy = (await service.strategies()).find(s => s.id === 'btc-v5')!;
    expect(strategy.configuration).toBe(configuration);
    expect(strategy).toMatchObject({ eligible: true, lastEvaluationAt: 123,
      configuration: { feeRate: 0.00075 }, lastDecision: { reason: 'CURRENT_SETUP' } });
  });

  it('keeps exactly the selected strategy active for future signals', async () => {
    const rows = [
      { id: 'btc-v2', revision: '2026-11-20.1', state: { active: true, eligible: false, lastCandleTime: 0, lastSignalTime: 0 } },
      { id: 'btc-v3', revision: '2026-11-20.v3.1', state: { active: false, eligible: false, lastCandleTime: 0, lastSignalTime: 0 } },
    ];
    const versions = { find: async () => rows };
    const db = {
      getRepository: (entity: unknown) => {
        if (entity === StrategyVersionRow) return versions;
        throw new Error('Unexpected repository');
      },
      transaction: async <T>(action: (tx: { find: (entity: unknown) => Promise<typeof rows>; save: (row: unknown) => Promise<void> }) => Promise<T>) =>
        action({ find: async () => rows, save: async () => undefined }),
    };
    const service = new ApiService(
      { db } as unknown as StoreService,
      {} as never,
      new PaperExecutionAdapter(),
      { ready: true } as RedisCacheService,
      new BacktestingEngine(),
      {} as StrategyApprovalService,
      {} as SimulationSettings,
      {} as never,
    );

    const active = await service.activateStrategy('btc-v3');

    expect(active).toMatchObject({ id: 'btc-v3', active: true });
    expect(rows.map((row) => [row.id, row.state.active])).toEqual([
      ['btc-v2', false],
      ['btc-v3', true],
    ]);
  });
});
