import Decimal from 'decimal.js';
import { ApiService } from '../../src/v2/api/api.service';
import { statistics } from '../../src/v2/backtesting/backtesting.engine';
import { newAccount, PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { StoreService } from '../../src/v2/persistence/store.service';
import { signal } from './fixtures';

describe('Account summary inventory and outcomes', () => {
  const paper = new PaperExecutionAdapter();
  function bought(baseFee = false) {
    const state = newAccount('a', 'u', 500, 5, 30);
    state.account.entriesEnabled = true;
    const sig = signal();
    if (baseFee) sig.config.buyCommissionAsset = 'BTC';
    paper.reserve(state, sig, sig.candleTime);
    paper.execute(state, state.orders[0].id, 100000, sig.candleTime, 1);
    expect(state.fills).toHaveLength(1);
    return state;
  }
  function serviceFor(state: ReturnType<typeof newAccount>) {
    const service = new ApiService(
      { db: { getRepository: () => ({ findOneBy: async () => ({ id: 'a' }) }) }, readAccount: async () => state } as unknown as StoreService,
      null as never, paper, null as never, null as never, null as never, null as never, null as never,
    );
    jest.spyOn(service, 'latest').mockResolvedValue(null);
    return service;
  }
  async function balance(state: ReturnType<typeof newAccount>) {
    return serviceFor(state).balance('u');
  }
  it('reports zero BTC on an empty account', async () => {
    expect(await balance(newAccount('a', 'u'))).toMatchObject({
      totalBTC: '0', assignedBTC: '0', unassignedBTC: '0', dustBTC: '0',
    });
  });
  it.each([false, true])('reconciles inventory after a buy (BTC commission: %s)', async (baseFee) => {
    const state = bought(baseFee);
    const result = await balance(state);
    expect(result.totalBTC).toBe(new Decimal(state.positions[0].quantity).toFixed());
    expect(result.assignedBTC).toBe(result.totalBTC);
    expect(result.unassignedBTC).toBe('0');
  });
  it('shows unassigned BTC and dust without double counting reserved exits', async () => {
    const state = bought();
    paper.requestExit(state, state.positions[0].id, signal().candleTime + 1, 'USER_CLOSE');
    state.positions[0].status = 'DUST';
    state.ledger.push({ id: 'extra', orderId: '', positionId: '', asset: 'BTC', availableDelta: '0.00000001', reservedDelta: '0.00000002', reason: 'ADJUSTMENT', at: 0 });
    const result = await balance(state);
    expect(new Decimal(result.reservedBTC).gt(0)).toBe(true);
    expect(result.dustBTC).toBe(result.assignedBTC);
    expect(result.unassignedBTC).toBe('0.00000003');
    expect(result.totalBTC).toBe(new Decimal(result.assignedBTC).plus('0.00000003').toFixed());
  });
  it('counts ledger transfers to reserved BTC once', async () => {
    const state = bought();
    const quantity = state.positions[0].quantity;
    state.ledger.push({ id: 'reserve', orderId: '', positionId: '', asset: 'BTC', availableDelta: new Decimal(quantity).neg().toFixed(), reservedDelta: quantity, reason: 'RESERVE', at: 1 });
    expect(await balance(state)).toMatchObject({
      totalBTC: new Decimal(quantity).toFixed(), assignedBTC: new Decimal(quantity).toFixed(), unassignedBTC: '0', dustBTC: '0',
    });
  });
  it.each([false, true])('reconciles partial exits and actual dust (BTC commission: %s)', async (baseFee) => {
    const state = bought(baseFee);
    const position = state.positions[0];
    const exit = paper.requestExit(state, position.id, signal().candleTime + 1, 'USER_CLOSE')!;
    paper.execute(state, exit.id, 101000, signal().candleTime + 2, 0.00002);
    expect(position.status).toBe('CLOSING');
    const partial = await balance(state);
    expect(partial.totalBTC).toBe(new Decimal(position.quantity).toFixed());
    expect(partial.assignedBTC).toBe(partial.totalBTC);
    expect(partial.unassignedBTC).toBe('0');
    paper.execute(state, exit.id, 101000, signal().candleTime + 3, 1);
    expect(position.status).toBe(baseFee ? 'DUST' : 'CLOSED');
    const result = await balance(state);
    const remaining = new Decimal(position.quantity).toFixed();
    expect(result).toMatchObject({ totalBTC: remaining, assignedBTC: remaining, unassignedBTC: '0', dustBTC: remaining });
  });
  it('reads existing history on every summary request without mutating it', async () => {
    const state = newAccount('a', 'u');
    const service = serviceFor(state);
    expect((await service.balance('u')).totalBTC).toBe('0');
    Object.assign(state, bought());
    const before = JSON.stringify(state);
    expect((await service.balance('u')).totalBTC).toBe(new Decimal(state.positions[0].quantity).toFixed());
    await service.stats('u');
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each([100000, 100100, 101000])('classifies a completed trade at %s using proceeds after both fees', async (exitPrice) => {
    const state = bought();
    const position = state.positions[0];
    const exit = paper.requestExit(state, position.id, signal().candleTime + 1, 'USER_CLOSE')!;
    paper.execute(state, exit.id, exitPrice, signal().candleTime + 2, 1);
    expect(position.status).toBe('CLOSED');
    const [buy, sell] = state.fills;
    const net = new Decimal(sell.quote).minus(sell.commission).minus(buy.quote).minus(buy.commission);
    expect(new Decimal(position.realizedPnl).eq(net)).toBe(true);
    // 100100 is a gross gain but still a net loss after the two commissions.
    expect(await serviceFor(state).stats('u')).toMatchObject({
      closedTrades: 1, winningTrades: net.gt(0) ? 1 : 0,
      losingTrades: net.lt(0) ? 1 : 0, breakevenTrades: net.eq(0) ? 1 : 0,
    });
    expect(await balance(state)).toMatchObject({ totalBTC: '0', assignedBTC: '0', unassignedBTC: '0', dustBTC: '0' });
  });
  it('classifies only closed positions by net P&L, including breakeven separately', () => {
    const state = bought();
    const position = state.positions[0];
    state.positions = [
      { ...position, id: 'win', status: 'CLOSED', quantity: '0', realizedPnl: '1' },
      { ...position, id: 'loss', status: 'CLOSED', quantity: '0', realizedPnl: '-0.01' },
      { ...position, id: 'flat', status: 'CLOSED', quantity: '0', realizedPnl: '0' },
      { ...position, id: 'open', status: 'OPEN', realizedPnl: '5' },
      { ...position, id: 'dust', status: 'DUST', realizedPnl: '-1' },
      { ...position, id: 'rejected', status: 'REJECTED', realizedPnl: '0' },
    ];
    expect(statistics(state, 100000)).toMatchObject({
      closedTrades: 3, winningTrades: 1, losingTrades: 1, breakevenTrades: 1,
    });
    expect(statistics(newAccount('a', 'u'), 0)).toMatchObject({
      closedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
    });
  });
  it('preserves the sign of decimal outcomes without numeric underflow', () => {
    const state = bought();
    const position = state.positions[0];
    state.positions = [
      { ...position, id: 'win', status: 'CLOSED', quantity: '0', realizedPnl: '1e-400' },
      { ...position, id: 'loss', status: 'CLOSED', quantity: '0', realizedPnl: '-1e-400' },
      { ...position, id: 'flat', status: 'CLOSED', quantity: '0', realizedPnl: '0' },
    ];
    const result = statistics(state, 100000);
    expect(result).toMatchObject({ closedTrades: 3, winningTrades: 1, losingTrades: 1, breakevenTrades: 1 });
    expect(result.winningTrades + result.losingTrades + result.breakevenTrades).toBe(result.closedTrades);
  });
});
