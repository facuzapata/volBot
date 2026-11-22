import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The prospective 30-day experiment is retired. Its append-only evidence is
 * preserved as JSONB before its specialised tables are removed.
 */
export class ArchiveProspectivePaper1795210000000 implements MigrationInterface {
  name = 'ArchiveProspectivePaper1795210000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS v2_archived_paper_records (
      source_table varchar NOT NULL,
      record_id varchar NOT NULL,
      data jsonb NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(source_table, record_id)
    )`);
    await q.query(`DO $$
    BEGIN
      IF to_regclass('public.v2_paper_experiments') IS NOT NULL THEN
        INSERT INTO v2_archived_paper_records(source_table, record_id, data)
        SELECT 'v2_paper_experiments', e.id::text, to_jsonb(e) FROM v2_paper_experiments e
        ON CONFLICT(source_table, record_id) DO NOTHING;
      END IF;
      IF to_regclass('public.v2_paper_observations') IS NOT NULL THEN
        INSERT INTO v2_archived_paper_records(source_table, record_id, data)
        SELECT 'v2_paper_observations', o.id::text, to_jsonb(o) FROM v2_paper_observations o
        ON CONFLICT(source_table, record_id) DO NOTHING;
      END IF;
      IF to_regclass('public.v2_paper_equity') IS NOT NULL THEN
        INSERT INTO v2_archived_paper_records(source_table, record_id, data)
        SELECT 'v2_paper_equity', e.experiment_id::text || ':' || e.bot || ':' || e.at::text, to_jsonb(e)
        FROM v2_paper_equity e ON CONFLICT(source_table, record_id) DO NOTHING;
      END IF;
      IF to_regclass('public.v2_paper_reports') IS NOT NULL THEN
        INSERT INTO v2_archived_paper_records(source_table, record_id, data)
        SELECT 'v2_paper_reports', r.experiment_id::text || ':' || r.period, to_jsonb(r)
        FROM v2_paper_reports r ON CONFLICT(source_table, record_id) DO NOTHING;
      END IF;
      IF to_regclass('public.v2_paper_feed') IS NOT NULL THEN
        INSERT INTO v2_archived_paper_records(source_table, record_id, data)
        SELECT 'v2_paper_feed', f.id, to_jsonb(f) FROM v2_paper_feed f
        ON CONFLICT(source_table, record_id) DO NOTHING;
      END IF;
      IF to_regclass('public.v2_paper_quotes') IS NOT NULL THEN
        INSERT INTO v2_archived_paper_records(source_table, record_id, data)
        SELECT 'v2_paper_quotes', q.id, to_jsonb(q) FROM v2_paper_quotes q
        ON CONFLICT(source_table, record_id) DO NOTHING;
      END IF;
    END $$`);
    await q.query('DROP TABLE IF EXISTS v2_paper_equity');
    await q.query('DROP TABLE IF EXISTS v2_paper_reports');
    await q.query('DROP TABLE IF EXISTS v2_paper_observations');
    await q.query('DROP TABLE IF EXISTS v2_paper_experiments');
    await q.query('DROP TABLE IF EXISTS v2_paper_quotes');
    await q.query('DROP TABLE IF EXISTS v2_paper_feed');
    await q.query('DROP FUNCTION IF EXISTS v2_paper_immutable_config()');
    await q.query('DROP FUNCTION IF EXISTS v2_paper_append_only()');
  }

  async down(): Promise<void> {
    throw new Error('Prospective PAPER tables are archived; restoration requires a reviewed migration');
  }
}
