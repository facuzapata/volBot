import { MigrationInterface, QueryRunner } from 'typeorm';
export class BtcV31795185000000 implements MigrationInterface {
  name='BtcV31795185000000';
  async up(q:QueryRunner):Promise<void>{
    await q.query(`INSERT INTO v2_strategy_versions(id,revision,state) VALUES ('btc-v3','2026-11-20.v3.1','{"eligible":false,"lastCandleTime":0,"lastSignalTime":0}'),('trend-reference','2026-11-20.trend.1','{"eligible":false,"lastCandleTime":0,"lastSignalTime":0}') ON CONFLICT(id) DO NOTHING`);
  }
  async down():Promise<void>{throw new Error('Destructive rollback disabled')}
}
