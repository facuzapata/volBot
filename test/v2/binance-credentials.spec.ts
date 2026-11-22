import { ConflictException } from '@nestjs/common';
import { BinanceCredentialsService } from '../../src/v2/execution/binance-credentials.service';
import { ExchangeCredentialRow } from '../../src/v2/persistence/entities';

describe('BinanceCredentialsService', () => {
  const rows: ExchangeCredentialRow[] = [];
  const repository = {
    findOneBy: async ({ userId }: { userId: string }) => rows.find((row) => row.userId === userId) ?? null,
    save: async (row: ExchangeCredentialRow) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index >= 0) rows[index] = { ...rows[index], ...row };
      else rows.push({ ...row });
      return row;
    },
  };
  const service = new BinanceCredentialsService({ getRepository: () => repository } as never);
  const originalFetch = global.fetch;

  beforeEach(() => {
    rows.splice(0);
    process.env.V2_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ canTrade: true }), { status: 200 }));
  });
  afterAll(() => {
    global.fetch = originalFetch;
    delete process.env.V2_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('verifies before storing and never persists raw credentials', async () => {
    const result = await service.saveAndVerify('11111111-1111-4111-8111-111111111111', 'key-0123456789abcdef', 'secret-0123456789abcdef', 'TESTNET');
    expect(result).toMatchObject({ configured: true, environment: 'TESTNET' });
    expect(rows[0].apiKeyCiphertext).not.toContain('key-0123456789abcdef');
    expect(rows[0].secretCiphertext).not.toContain('secret-0123456789abcdef');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/testnet\.binance\.vision\/api\/v3\/account\?.*signature=/),
      expect.objectContaining({ headers: { 'X-MBX-APIKEY': 'key-0123456789abcdef' } }),
    );
  });

  it('does not replace a valid stored connection when Binance rejects the new one', async () => {
    await service.saveAndVerify('11111111-1111-4111-8111-111111111111', 'key-0123456789abcdef', 'secret-0123456789abcdef', 'TESTNET');
    const saved = rows[0].secretCiphertext;
    global.fetch = jest.fn(async () => new Response(null, { status: 401 }));
    await expect(service.saveAndVerify('11111111-1111-4111-8111-111111111111', 'other-0123456789abcd', 'other-secret-0123456789abcd', 'LIVE')).rejects.toBeInstanceOf(ConflictException);
    expect(rows[0].secretCiphertext).toEqual(saved);
  });
});
