import { MigrationInterface, QueryRunner } from 'typeorm';
export class StrategyApprovals1795180000000 implements MigrationInterface {
  name = 'StrategyApprovals1795180000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE v2_strategy_validations (
      id uuid PRIMARY KEY, strategy varchar NOT NULL, revision varchar NOT NULL, "simulatorRevision" varchar NOT NULL,
      "configHash" varchar NOT NULL, "reportId" uuid NOT NULL REFERENCES v2_backtest_runs(id), "evidenceHash" varchar NOT NULL,
      status varchar NOT NULL CHECK(status IN ('PENDING','APPROVED','REVOKED')), "registeredBy" uuid NOT NULL REFERENCES v2_users(id),
      "decidedBy" uuid REFERENCES v2_users(id), "decidedAt" timestamptz, rationale text NOT NULL, review jsonb NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX ON v2_strategy_validations(strategy, revision, "configHash", status)`);
    // Safety transition changes entry permission only; inventory, orders and balances are preserved.
    await q.query(`UPDATE v2_virtual_accounts SET data = jsonb_set(data, '{entriesEnabled}', 'false'::jsonb)`);
  }
  async down(): Promise<void> { throw new Error('Destructive rollback disabled'); }
}
