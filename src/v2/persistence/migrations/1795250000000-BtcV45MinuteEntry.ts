import { MigrationInterface, QueryRunner } from 'typeorm';

/** Records the V4.5 minute-entry revision and clears any prior eligibility edge. */
export class BtcV45MinuteEntry1795250000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE v2_strategy_versions
      SET revision = '2026-11-22.v4.5',
          state = jsonb_set(state, '{eligible}', 'false'::jsonb, true)
      WHERE id = 'btc-v4'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE v2_strategy_versions
      SET revision = '2026-11-22.v4.4',
          state = jsonb_set(state, '{eligible}', 'false'::jsonb, true)
      WHERE id = 'btc-v4'
    `);
  }
}
