import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MultiBinanceService } from '../../src/binance/services/multi-binance.service';
import { PublicMarketClient } from '../../src/v2/market/public-market.client';
import { simulationConfig, databaseUrl } from '../../src/v2/config';
import { PaperExecutionAdapter, newAccount } from '../../src/v2/execution/paper-execution.adapter';
import { signal } from './fixtures';

describe('Paper-only capability boundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TRADING_MODE;
  });
  it('never makes HTTP calls when matching or cancelling simulated orders', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
    const s = newAccount('a', 'u');
    s.account.entriesEnabled = true;
    const paper = new PaperExecutionAdapter();
    paper.reserve(s, signal(), signal().candleTime);
    paper.execute(s, s.orders[0].id, 100000, signal().candleTime, 1);
    const exit = paper.requestExit(s, s.positions[0].id, signal().candleTime + 1, 'TEST')!;
    paper.cancel(s, exit.id, signal().candleTime + 2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('blocks all archived real trading entrypoints before touching a client', async () => {
    const legacy = Object.create(MultiBinanceService.prototype) as MultiBinanceService;
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
    await expect(legacy.onModuleInit()).rejects.toThrow('LIVE_TRADING_COMPILED_OUT');
    await expect(
      legacy.createOrderForUser('u', {
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 1,
      }),
    ).rejects.toThrow('LIVE_TRADING_COMPILED_OUT');
    await expect(
      legacy.createOCOOrderForUser(
        'u',
        {
          symbol: 'BTCUSDT',
          side: 'SELL',
          quantity: 1,
          price: 101,
          stopPrice: 99,
          stopLimitPrice: 98,
        },
        'tp',
        'sl',
      ),
    ).rejects.toThrow('LIVE_TRADING_COMPILED_OUT');
    await expect(legacy.cancelOCOOrderForUser('u', 'BTCUSDT', 1)).rejects.toThrow(
      'LIVE_TRADING_COMPILED_OUT',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects LIVE configuration and a V1 database URL', () => {
    process.env.TRADING_MODE = 'LIVE';
    expect(() => simulationConfig()).toThrow('Only PAPER');
    const old = process.env.V2_DATABASE_URL;
    process.env.V2_DATABASE_URL = 'postgres://test:test@localhost/legacy';
    expect(() => databaseUrl()).toThrow('dedicated');
    if (old === undefined) delete process.env.V2_DATABASE_URL;
    else process.env.V2_DATABASE_URL = old;
  });
  it('allows only public GET data endpoints without credentials or signatures', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const client = new PublicMarketClient();
    await client.request('exchangeInfo', { symbol: 'BTCUSDT' });
    expect(spy).toHaveBeenCalledWith(
      'https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT',
      expect.objectContaining({ method: 'GET' }),
    );
    await expect(client.request('order' as never, {})).rejects.toThrow(
      'PRIVATE_ENDPOINT_FORBIDDEN',
    );
    await expect(client.request('klines', { signature: 'forbidden' })).rejects.toThrow(
      'PRIVATE_PARAMETERS_FORBIDDEN',
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('keeps exchange SDK and legacy Binance modules out of both process graphs', () => {
    const root = resolve(__dirname, '../../src');
    const seen = new Set<string>();
    const visit = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/from ['"]binance-api-node['"]/);
      expect(source).not.toMatch(
        /(?:client\.order\(|client\.orderOco\(|client\.cancelOpenOrders\()/,
      );
      for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        const dependency = resolve(path, '..', `${match[1]}.ts`);
        visit(dependency);
      }
    };
    visit(resolve(root, 'main.ts'));
    visit(resolve(root, 'worker.ts'));
  });
});
