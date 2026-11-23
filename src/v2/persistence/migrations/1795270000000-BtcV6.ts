import { MigrationInterface, QueryRunner } from 'typeorm';

/** Registers the independent aggressive V6 PAPER candidate without activating it. */
export class BtcV61795270000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO v2_strategy_versions(id, revision, state)
      VALUES ('btc-v6', '2026-11-23.v6.1', '{"eligible":false,"lastCandleTime":0,"lastSignalTime":0}')
      ON CONFLICT(id) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM v2_strategy_versions WHERE id = 'btc-v6'");
  }
}
