import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefreshTokens1795190000000 implements MigrationInterface {
  name = 'RefreshTokens1795190000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE v2_refresh_tokens (
      id uuid PRIMARY KEY,
      "userId" uuid NOT NULL REFERENCES v2_users(id),
      "tokenHash" varchar NOT NULL,
      "tokenVersion" integer NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "revokedAt" timestamptz,
      "replacedById" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CHECK ("expiresAt" > "createdAt")
    )`);
    await q.query('CREATE INDEX ON v2_refresh_tokens ("userId", "expiresAt")');
  }

  async down(): Promise<void> {
    throw new Error('Destructive rollback disabled; revoke sessions instead');
  }
}
