import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExchangeCredentials1795220000000 implements MigrationInterface {
  name = 'ExchangeCredentials1795220000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE v2_exchange_credentials (
      id uuid PRIMARY KEY,
      "userId" uuid NOT NULL UNIQUE REFERENCES v2_users(id),
      environment varchar NOT NULL CHECK(environment IN ('TESTNET','LIVE')),
      "apiKeyCiphertext" text NOT NULL,
      "secretCiphertext" text NOT NULL,
      "verifiedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(): Promise<void> { throw new Error('Credential deletion requires explicit operator action'); }
}
