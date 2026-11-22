import { ApiService } from '../../src/v2/api/api.service';
import { BacktestingEngine } from '../../src/v2/backtesting/backtesting.engine';
import { PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { RedisCacheService } from '../../src/v2/market/redis-cache.service';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';
import { StrategyVersionRow } from '../../src/v2/persistence/entities';
import { StoreService } from '../../src/v2/persistence/store.service';
import { StrategyApprovalService } from '../../src/v2/strategy/approval.service';

describe('strategy activation', () => {
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
