import { ArchiveProspectivePaper1795210000000 } from '../../src/v2/persistence/migrations/1795210000000-ArchiveProspectivePaper';

describe('prospective PAPER archive migration', () => {
  it('archives every experimental table before dropping it', async () => {
    const queries: string[] = [];
    const migration = new ArchiveProspectivePaper1795210000000();

    await migration.up({ query: async (sql: string) => queries.push(sql) } as never);

    expect(queries[0]).toContain('CREATE TABLE IF NOT EXISTS v2_archived_paper_records');
    const archive = queries[1];
    for (const table of [
      'v2_paper_experiments',
      'v2_paper_observations',
      'v2_paper_equity',
      'v2_paper_reports',
      'v2_paper_feed',
      'v2_paper_quotes',
    ])
      expect(archive).toContain(`SELECT '${table}'`);
    expect(queries).toEqual(expect.arrayContaining([
      'DROP TABLE IF EXISTS v2_paper_equity',
      'DROP TABLE IF EXISTS v2_paper_reports',
      'DROP TABLE IF EXISTS v2_paper_observations',
      'DROP TABLE IF EXISTS v2_paper_experiments',
      'DROP TABLE IF EXISTS v2_paper_quotes',
      'DROP TABLE IF EXISTS v2_paper_feed',
    ]));
  });
});
