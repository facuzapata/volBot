import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { DEFAULT_SIMULATION, MarketSignal, SIMULATOR_REVISION, SimulationConfig } from '../domain/model';
import { BacktestRunRow, StrategyValidationRow, StrategyVersionRow } from '../persistence/entities';
import { revisionFor } from './versions';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function configurationHash(strategy: string, revision: string, config: SimulationConfig, simulatorRevision=SIMULATOR_REVISION): string {
  return createHash('sha256').update(canonical({ strategy, revision, simulator: simulatorRevision, config: { ...DEFAULT_SIMULATION, ...config } })).digest('hex');
}
@Injectable()
export class StrategyApprovalService {
  constructor(private readonly db: DataSource) {}
  private async lock(tx: EntityManager, hash: string): Promise<void> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`strategy-approval:${hash}`]);
  }
  async approved(tx: EntityManager, signal: Pick<MarketSignal, 'strategy'|'strategyRevision'|'config'>): Promise<boolean> {
    const hash = configurationHash(signal.strategy, signal.strategyRevision, signal.config);
    await this.lock(tx, hash);
    return tx.existsBy(StrategyValidationRow, { strategy: signal.strategy, revision: signal.strategyRevision, configHash: hash, simulatorRevision: SIMULATOR_REVISION, status: 'APPROVED' });
  }
  async activeApproved(tx: EntityManager, strategy: string): Promise<boolean> {
    const version = await tx.findOneBy(StrategyVersionRow, { id: strategy });
    if (!version?.state.configuration || version.revision !== revisionFor(strategy)) return false;
    return this.approved(tx, { strategy: strategy as MarketSignal['strategy'], strategyRevision: version.revision, config: version.state.configuration });
  }
  async register(reportId: string, actorId: string, rationale: string): Promise<StrategyValidationRow> {
    const report = await this.db.getRepository(BacktestRunRow).findOneBy({ id: reportId });
    if (!report) throw new NotFoundException('Evaluation report not found');
    const data = report.report as { strategy?: string; strategyRevision?: string; simulatorRevision?: string; options?: { config: SimulationConfig }; metrics?: object; datasetHash?: string };
    if (!data.strategy || !data.options?.config || !data.metrics || data.simulatorRevision !== SIMULATOR_REVISION || data.strategyRevision !== revisionFor(data.strategy))
      throw new ConflictException('Register a single, current-version evaluation report; legacy/unversioned reports cannot be approved');
    return this.db.getRepository(StrategyValidationRow).save({ id: randomUUID(), strategy: data.strategy, revision: data.strategyRevision,
      simulatorRevision: data.simulatorRevision, configHash: configurationHash(data.strategy, data.strategyRevision, data.options.config),
      reportId, evidenceHash: createHash('sha256').update(canonical(report.report)).digest('hex'), status: 'PENDING',
      registeredBy: actorId, decidedBy: null, decidedAt: null, rationale, review: {} });
  }
  async decide(id: string, actorId: string, status: 'APPROVED'|'REVOKED', rationale: string, review: Record<string, boolean>): Promise<StrategyValidationRow> {
    return this.db.transaction(async tx => {
      const initial = await tx.findOneBy(StrategyValidationRow, { id });
      if (!initial) throw new NotFoundException('Validation not found');
      await this.lock(tx, initial.configHash);
      const row = await tx.findOneOrFail(StrategyValidationRow, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (status === 'APPROVED') {
        if (row.status === 'REVOKED') throw new ConflictException('A revoked validation is immutable; register a new review');
        if (!['simulatorReviewed','outOfSampleReviewed','costsReviewed','riskReviewed'].every(key => review[key] === true)) throw new ConflictException('Explicit human review of all four areas is required');
        const source = await tx.findOneByOrFail(BacktestRunRow, { id: row.reportId });
        if (createHash('sha256').update(canonical(source.report)).digest('hex') !== row.evidenceHash) throw new ConflictException('Evaluation evidence has changed');
      }
      if (status === 'REVOKED') {
        await tx.createQueryBuilder().update(StrategyValidationRow).set({ status:'REVOKED', decidedBy:actorId, decidedAt:new Date(), rationale, review })
          .where('"configHash" = :hash AND status = :status', {hash:initial.configHash,status:'APPROVED'}).execute();
      }
      row.status = status; row.decidedBy = actorId; row.decidedAt = new Date(); row.rationale = rationale; row.review = review;
      await tx.save(row); return row;
    });
  }
}
