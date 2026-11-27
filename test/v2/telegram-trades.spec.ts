import { DataSource } from 'typeorm';
import { StoreService } from '../../src/v2/persistence/store.service';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { RiskManagerService } from '../../src/v2/trading/trading.services';
import { RiskPolicy } from '../../src/v2/risk/risk-policy';
import { telegramClosedNotice, telegramFillNotice, telegramSignalNotice } from '../../src/v2/notifications/telegram-trades';
import { signal } from './fixtures';
import { commandHarness } from './telegram-command.fixtures';

describe('Automatic Telegram trade notices', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits formatted signal, buy, sell and closure events through the real producers', async () => {
    const state = newAccount('a', 'u', 500, 5, 30);
    state.account.entriesEnabled = true;
    const tx = {
      query: async () => [], existsBy: async () => false,
      findOneOrFail: async () => ({ id: 'a' }), findOneByOrFail: async () => ({ active: true }),
      update: async () => undefined, insert: async () => undefined,
      getRepository: () => ({ upsert: async () => undefined, insert: async () => undefined }),
    };
    const store = new StoreService({ transaction: async (action: (value: typeof tx) => Promise<void>) => action(tx) } as unknown as DataSource);
    jest.spyOn(store, 'readAccount').mockImplementation(async () => state);
    const emit = jest.spyOn(store, 'emit').mockResolvedValue(undefined);
    const sig = signal('trade', Date.now());
    const paper = new PaperExecutionAdapter();
    await new RiskManagerService(store, new RiskPolicy()).reserve('a', sig, 'signal-event');
    await store.accountTransaction('a', async (s) => {
      paper.execute(s, s.orders[0].id, 100000, sig.candleTime + 1, 1);
    });
    await store.accountTransaction('a', async (s) => {
      const exit = paper.requestExit(s, s.positions[0].id, sig.candleTime + 2, 'TAKE_PROFIT')!;
      paper.execute(s, exit.id, 102000, sig.candleTime + 3, 1);
    });
    const notices = emit.mock.calls.filter((call) => call[1] === 'notification.requested.v1')
      .map((call) => call[3] as { kind: string; text: string; parseMode?: string });
    expect(notices.map((event) => event.kind)).toEqual(['SIGNAL_DETECTED', 'SIMULATED_BUY', 'SIMULATED_PROFIT', 'SIMULATED_SELL']);
    expect(notices.every((event) => event.parseMode === 'HTML')).toBe(true);
    expect(notices[0].text).toContain('Compra pendiente de ejecución');
    expect(notices[1].text).toContain('<b>Compra ejecutada</b>');
    expect(notices[1].text).toContain('100000.00 USDT');
    expect(notices[2].text).toContain('<b>Posición cerrada</b>');
    expect(notices[2].text).toContain('Objetivo alcanzado');
    expect(notices[3].text).toContain('<b>Venta ejecutada</b>');
    expect(notices[3].text).toContain('Comisión:');
  });

  it('preserves BTC fee precision and labels partial execution without claiming a closed position', () => {
    const state = commandHarness().states.get('a-0')!;
    const fill = { ...state.fills[0], commissionAsset: 'BTC' as const, commission: '0.00000029' };
    const notice = telegramFillNotice(fill, state.positions[0], { ...state.orders[0], status: 'PARTIALLY_FILLED' });
    expect(notice.text).toContain('<b>Compra parcial ejecutada</b>');
    expect(notice.text).toContain('0.00000029 BTC');
    expect(notice.text).toContain('queda cantidad pendiente');
    expect(notice.text).not.toContain('Posición cerrada');
  });

  it('uses each trade execution mode, escapes data and distinguishes losses from profits', () => {
    const state = commandHarness().states.get('a-0')!;
    Object.assign(state.positions[0], { strategy: 'A < B & C', executionMode: 'LIVE' });
    const notice = telegramFillNotice(state.fills[0], state.positions[0], state.orders[0]);
    expect(notice.text).toContain('🔴 Real');
    expect(notice.text).toContain('A &lt; B &amp; C');
    const signalNotice = telegramSignalNotice(signal(), { ...state.orders[0], executionMode: 'LIVE' });
    expect(signalNotice.text).toContain('🔴 Real');
    expect(signalNotice.text).not.toContain('Compra ejecutada');
    const closed = telegramClosedNotice({ ...state.positions[0], realizedPnl: '-1.23456', exitReason: 'STOP_LOSS' });
    expect(closed.text).toContain('🔴 Resultado neto: <b>-1.2346 USDT</b>');
    expect(closed.text).toContain('Stop de protección');
  });
});
