import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('exchange credential migration', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/v2/persistence/migrations/1795220000000-ExchangeCredentials.ts'), 'utf8');
  it('stores encrypted values and has one connection per user', () => {
    expect(source).toContain('v2_exchange_credentials');
    expect(source).toContain('"userId" uuid NOT NULL UNIQUE');
    expect(source).toContain('"apiKeyCiphertext" text NOT NULL');
    expect(source).toContain('"secretCiphertext" text NOT NULL');
  });
});
