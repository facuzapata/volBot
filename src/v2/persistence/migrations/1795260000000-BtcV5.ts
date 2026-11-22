import { MigrationInterface, QueryRunner } from 'typeorm';

/** Registers the independent V5 PAPER research candidate. */
export class BtcV51795260000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO v2_strategy_versions(id, revision, state)
      VALUES ('btc-v5', '2026-11-22.v5.1', '{"eligible":false,"lastCandleTime":0,"lastSignalTime":0}')
      ON CONFLICT(id) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM v2_strategy_versions WHERE id = 'btc-v5'");
  }
}
