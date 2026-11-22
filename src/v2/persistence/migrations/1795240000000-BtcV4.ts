import { MigrationInterface, QueryRunner } from 'typeorm';

/** Registers the frozen BTC-V4 PAPER candidate without altering prior strategies. */
export class BtcV41795240000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO v2_strategy_versions(id, revision, state)
      VALUES ('btc-v4', '2026-11-22.v4.4', '{"eligible":false,"lastCandleTime":0,"lastSignalTime":0}')
      ON CONFLICT(id) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM v2_strategy_versions WHERE id = 'btc-v4'");
  }
}
