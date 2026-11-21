import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive only. Run against a dedicated database. No V1 tables are touched. */
export class InitialV21795172400000 implements MigrationInterface {
  name = 'InitialV21795172400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE v2_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar NOT NULL UNIQUE, name varchar NOT NULL,
      "passwordHash" varchar NOT NULL, role varchar NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), active boolean NOT NULL DEFAULT true,
      "tokenVersion" integer NOT NULL DEFAULT 0, "telegramChatId" varchar, "whatsappNumber" varchar, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE v2_virtual_accounts (id uuid PRIMARY KEY, "userId" uuid NOT NULL UNIQUE REFERENCES v2_users(id), data jsonb NOT NULL,
      CHECK ((data->>'available')::numeric >= 0), CHECK ((data->>'reserved')::numeric >= 0),
      CHECK ((data->>'maxPositions')::integer BETWEEN 1 AND 20), CHECK ((data->>'usdtPerTrade')::numeric > 0))`);
    for (const table of [
      'positions',
      'order_intents',
      'exchange_orders',
      'fills',
      'ledger_entries',
      'user_signal_decisions',
    ]) {
      await q.query(
        `CREATE TABLE v2_${table} (id varchar PRIMARY KEY, "accountId" uuid NOT NULL REFERENCES v2_virtual_accounts(id), data jsonb NOT NULL)`,
      );
      await q.query(`CREATE INDEX ON v2_${table} ("accountId")`);
    }
    await q.query(
      `CREATE UNIQUE INDEX v2_decision_once ON v2_user_signal_decisions ("accountId", (data->>'signalId'))`,
    );
    await q.query(`CREATE TABLE v2_market_signals (id varchar PRIMARY KEY, data jsonb NOT NULL)`);
    await q.query(`CREATE TABLE v2_candles (id varchar PRIMARY KEY, timeframe varchar NOT NULL, "openTime" bigint NOT NULL, data jsonb NOT NULL,
      UNIQUE(timeframe, "openTime"))`);
    await q.query(
      `CREATE TABLE v2_strategy_versions (id varchar PRIMARY KEY, revision varchar NOT NULL, state jsonb NOT NULL)`,
    );
    await q.query(
      `CREATE TABLE v2_outbox (id varchar PRIMARY KEY, event jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "publishedAt" timestamptz)`,
    );
    await q.query(`CREATE INDEX ON v2_outbox ("createdAt") WHERE "publishedAt" IS NULL`);
    await q.query(
      `CREATE TABLE v2_inbox (id varchar PRIMARY KEY, "processedAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE TABLE v2_delivery_attempts (id varchar PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, "nextAttemptAt" timestamptz NOT NULL, dead boolean NOT NULL DEFAULT false)`,
    );
    await q.query(
      `CREATE TABLE v2_backtest_runs (id uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES v2_users(id), report jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(`CREATE INDEX ON v2_backtest_runs ("userId")`);
    for (const id of ['legacy-v1', 'btc-v2'])
      await q.query(`INSERT INTO v2_strategy_versions(id, revision, state) VALUES ($1, $2, $3)`, [
        id,
        '2026-11-20.1',
        JSON.stringify({ eligible: false, lastCandleTime: 0, lastSignalTime: 0 }),
      ]);
  }
  async down(): Promise<void> {
    throw new Error('Destructive rollback disabled; restore a reviewed backup instead');
  }
}
