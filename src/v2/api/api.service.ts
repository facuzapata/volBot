import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DataSource, IsNull } from 'typeorm';
import { numberEnv, selectedStrategy } from '../config';
import { AccountState, isOrderOpen, StrategyId } from '../domain/model';
import { BacktestingEngine, statistics } from '../backtesting/backtesting.engine';
import { newAccount, PaperExecutionAdapter } from '../execution/paper-execution.adapter';
import { RedisCacheService } from '../market/redis-cache.service';
import {
  BacktestRunRow,
  CandleRow,
  DeliveryAttemptRow,
  MarketSignalRow,
  OutboxEventRow,
  StrategyVersionRow,
  V2User,
  VirtualAccountRow,
  StrategyValidationRow,
} from '../persistence/entities';
import { StoreService } from '../persistence/store.service';
import { StrategyApprovalService, configurationHash } from '../strategy/approval.service';
import { strategyConfiguration, revisionFor } from '../strategy/versions';
import { DEFAULT_BTC_V3 } from '../strategy/btc-v3.config';
import { SimulationSettings } from '../market/simulation-settings';
import {
  BacktestDto,
  CreateUserDto,
  MarketQueryDto,
  PageDto,
  PublicUserDto,
  TradingConfigDto,
} from './dtos';

export const publicUser = (u: V2User): PublicUserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  active: u.active,
});
@Injectable()
export class ApiService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly store: StoreService,
    private readonly jwt: JwtService,
    private readonly paper: PaperExecutionAdapter,
    private readonly cache: RedisCacheService,
    private readonly backtester: BacktestingEngine,
    private readonly approvals: StrategyApprovalService,
    private readonly settings:SimulationSettings,
  ) {}
  get db(): DataSource {
    return this.store.db;
  }
  async login(email: string, password: string, remote: string) {
    // Local rate limit is defense in depth; deploy behind an ingress with a shared limiter.
    const key = remote;
    const entry = this.attempts.get(key);
    if (entry && entry.until > Date.now() && entry.count >= 10)
      throw new UnauthorizedException('Login temporarily rate limited');
    if (this.attempts.size > 10000)
      for (const [id, a] of this.attempts) if (a.until < Date.now()) this.attempts.delete(id);
    this.attempts.set(key, {
      count: entry && entry.until > Date.now() ? entry.count + 1 : 1,
      until: Date.now() + 60000,
    });
    const user = await this.db
      .getRepository(V2User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash)))
      throw new UnauthorizedException('Invalid credentials');
    return {
      accessToken: await this.jwt.signAsync(
        { sub: user.id, version: user.tokenVersion },
        { expiresIn: '15m', issuer: 'volbot-v2', audience: 'volbot-v2-api', algorithm: 'HS256' },
      ),
      user: publicUser(user),
    };
  }
  async createUser(body: CreateUserDto) {
    const email = body.email.trim().toLowerCase();
    if (await this.db.getRepository(V2User).existsBy({ email }))
      throw new ConflictException('Email already exists');
    const capital = body.initialCapital ?? numberEnv('V2_INITIAL_CAPITAL', 500, 10, 1000000);
    const passwordHash = await bcrypt.hash(body.password, 12);
    return this.db.transaction(async (tx) => {
      const user = await tx.save(V2User, {
        email,
        name: body.name,
        passwordHash,
        role: body.role || 'user',
        active: true,
        tokenVersion: 0,
      });
      const state = newAccount(
        randomUUID(),
        user.id,
        capital,
        body.maxPositions ?? 5,
        body.usdtPerTrade ?? 30,
      );
      await tx.insert(VirtualAccountRow, {
        id: state.account.id,
        userId: user.id,
        data: state.account,
      });
      return publicUser(user);
    });
  }
  async state(userId: string): Promise<AccountState> {
    const row = await this.db.getRepository(VirtualAccountRow).findOneBy({ userId });
    if (!row) throw new NotFoundException('Virtual account not found');
    return this.store.readAccount(row.id);
  }
  async accountId(userId: string): Promise<string> {
    const row = await this.db.getRepository(VirtualAccountRow).findOneBy({ userId });
    if (!row) throw new NotFoundException('Virtual account not found');
    return row.id;
  }
  async configure(userId: string, body: TradingConfigDto) {
    const accountId = await this.accountId(userId);
    await this.store.accountTransaction(accountId, async (s) => {
      if (body.maxPositions !== undefined) s.account.maxPositions = body.maxPositions;
      if (body.usdtPerTrade !== undefined) s.account.usdtPerTrade = String(body.usdtPerTrade);
    });
    return this.configuration((await this.state(userId)).account);
  }
  configuration(a: AccountState['account']) {
    return {
      maxPositions: a.maxPositions,
      usdtPerTrade: a.usdtPerTrade,
      entriesEnabled: a.entriesEnabled,
    };
  }
  async entries(userId: string, enabled: boolean) {
    const accountId = await this.accountId(userId);
    await this.store.accountTransaction(accountId, async (s, tx) => {
      if (enabled && !await this.approvals.activeApproved(tx, selectedStrategy())) throw new ConflictException('Strategy/configuration has no explicit current approval');
      s.account.entriesEnabled = enabled;
    });
    return this.configuration((await this.state(userId)).account);
  }
  registerValidation(reportId: string, actorId: string, rationale: string) { return this.approvals.register(reportId, actorId, rationale); }
  decideValidation(id: string, actorId: string, status: 'APPROVED'|'REVOKED', rationale: string, review: Record<string,boolean>) { return this.approvals.decide(id, actorId, status, rationale, review); }
  page<T>(items: T[], query: PageDto) {
    return {
      items: items.slice(query.offset, query.offset + query.limit),
      total: items.length,
      limit: query.limit,
      offset: query.offset,
    };
  }
  async latest() {
    return this.db
      .getRepository(CandleRow)
      .findOne({ where: { timeframe: '1m' }, order: { openTime: 'DESC' } });
  }
  async balance(userId: string) {
    const s = await this.state(userId);
    const last = await this.latest();
    return {
      mode: 'PAPER',
      availableUSDT: s.account.available,
      reservedUSDT: s.account.reserved,
      assignedBTC: String(s.positions.reduce((n, p) => n + Number(p.quantity), 0)),
      reservedBTC: String(
        s.orders
          .filter((o) => o.side === 'SELL' && isOrderOpen(o))
          .reduce((n, o) => n + Number(o.quantity) - Number(o.filledQuantity), 0),
      ),
      equityUSDT: this.paper.equity(s, last?.data.close || 0).toNumber(),
      entriesEnabled: s.account.entriesEnabled,
    };
  }
  async stats(userId: string) {
    const s = await this.state(userId);
    const last = await this.latest();
    return statistics(s, last?.data.close || 0);
  }
  async close(userId: string, positionId: string) {
    const id = await this.accountId(userId);
    await this.store.accountTransaction(id, async (s) => {
      if (!s.positions.some((p) => p.id === positionId))
        throw new NotFoundException('Position not found');
      if (Date.now() - s.account.lastCandleTime > 180000)
        throw new ServiceUnavailableException('Wait for position reconciliation before requesting a close');
      this.paper.requestExit(s, positionId, Date.now(), 'USER_CLOSE');
    });
    return (await this.state(userId)).positions.find((p) => p.id === positionId)!;
  }
  async cancel(userId: string, orderId: string) {
    const id = await this.accountId(userId);
    await this.store.accountTransaction(id, async (s) => {
      if (!s.orders.some((o) => o.id === orderId)) throw new NotFoundException('Order not found');
      this.paper.cancel(s, orderId, Date.now());
    });
    return (await this.state(userId)).orders.find((o) => o.id === orderId)!;
  }
  async health() {
    let database = false;
    let marketFresh = false;
    let outboxPending = 0;
    try {
      await this.db.query('SELECT 1');
      database = true;
      const last = await this.latest();
      marketFresh = !!last && Date.now() - last.data.closeTime < 180000;
      outboxPending = await this.db
        .getRepository(OutboxEventRow)
        .countBy({ publishedAt: IsNull() });
    } catch {
      /* Health never includes connection strings or raw driver errors. */
    }
    return {
      status:
        database && this.cache.ready && marketFresh && outboxPending < 100 ? 'ok' : 'degraded',
      mode: 'PAPER',
      database,
      redis: this.cache.ready,
      marketFresh,
      outboxPending,
    };
  }
  async market() {
    const intervals: Record<string, object | null> = {};
    for (const timeframe of ['1m', '5m', '1h'])
      intervals[timeframe] =
        (
          await this.db
            .getRepository(CandleRow)
            .findOne({ where: { timeframe }, order: { openTime: 'DESC' } })
        )?.data || null;
    return {
      ...(await this.health()),
      symbol: 'BTCUSDT',
      latestPrice: (await this.latest())?.data.close || null,
      intervals,
    };
  }
  async strategies() {
    const rows = await this.db.getRepository(StrategyVersionRow).find();
    return Promise.all((['legacy-v1','btc-v2','btc-v3','trend-reference'] as StrategyId[]).map(async id=>{
      const row=rows.find(r=>r.id===id),configuration=row?.state.configuration??strategyConfiguration(id,id==='btc-v3'&&this.settings.btcV3Calibration?{btcV3Calibration:this.settings.btcV3Calibration}:{}),hash=configurationHash(id,revisionFor(id),configuration);
      const validations=await this.db.getRepository(StrategyValidationRow).find({where:{strategy:id,configHash:hash},order:{createdAt:'DESC'}});
      return {id,revision:revisionFor(id),active:id===selectedStrategy(),lastEvaluationAt:row?.state.lastCandleTime??0,eligible:row?.state.eligible??false,configuration,configurationHash:hash,calibrationReady:!!configuration.btcV3Calibration,approvalStatus:validations.some(v=>v.status==='APPROVED')?'APPROVED':validations[0]?.status??'UNREGISTERED',lastDecision:row?.state.lastDecision,
        description:id==='btc-v3'?'Experimental: tendencia 1h, retroceso/ATR 5m, recuperación 1m y abstención calibrada.':id==='btc-v2'?'Baseline original: tendencia 1h, confirmación 5m y entrada 1m.':id==='trend-reference'?'Referencia de backtest, sin selección operativa.':'Indicadores originales y puntuación 5/7.'};
    }));
  }
  async candles(query: MarketQueryDto) {
    const [rows, total] = await this.db
      .getRepository(CandleRow)
      .findAndCount({
        where: { timeframe: query.timeframe },
        order: { openTime: 'DESC' },
        take: query.limit,
        skip: query.offset,
      });
    return { items: rows.map((row) => row.data), total, limit: query.limit, offset: query.offset };
  }
  async runBacktest(userId: string, body: BacktestDto) {
    const config = {
      ...(body.btcV3?{btcV3:{...DEFAULT_BTC_V3,...body.btcV3}}:{}),
      ...(body.strategy==='btc-v3'&&this.settings.btcV3Calibration?{btcV3Calibration:this.settings.btcV3Calibration}:{}),
      ...(body.maxRiskPerTrade===undefined?{}:{maxRiskPerTrade:body.maxRiskPerTrade}),
      ...(body.feeRate === undefined ? {} : { feeRate: body.feeRate }),
      ...(body.spreadBps === undefined ? {} : { spreadBps: body.spreadBps }),
      ...(body.slippageBps === undefined ? {} : { slippageBps: body.slippageBps }),
    };
    const options = {
      strategy: body.strategy,
      initialCapital: body.initialCapital,
      maxPositions: body.maxPositions,
      usdtPerTrade: body.usdtPerTrade,
      config,
    };
    let report: object;
    try {
      report = body.compare
        ? this.backtester.compare(body.candles, options)
        : this.backtester.run(body.candles, options);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid dataset');
    }
    const id = randomUUID();
    await this.db.getRepository(BacktestRunRow).insert({ id, userId, report });
    return { id, report };
  }
  async backtest(userId: string, id: string) {
    const row = await this.db.getRepository(BacktestRunRow).findOneBy({ id, userId });
    if (!row) throw new NotFoundException('Backtest not found');
    return { id: row.id, report: row.report };
  }
  async signals(query: PageDto) {
    const [rows, total] = await this.db
      .getRepository(MarketSignalRow)
      .findAndCount({ order: { id: 'ASC' }, take: query.limit, skip: query.offset });
    return { items: rows.map((r) => r.data), total, ...query };
  }
  async replay(id: string) {
    await this.db.transaction(async (tx) => {
      const attempt = await tx.findOneBy(DeliveryAttemptRow, { id });
      if (!attempt?.dead) throw new NotFoundException('Dead letter not found');
      const originalId = id.slice(id.indexOf(':') + 1);
      const original = await tx.findOneByOrFail(OutboxEventRow, { id: originalId });
      await tx.update(DeliveryAttemptRow, id, {
        attempts: 0,
        dead: false,
        nextAttemptAt: new Date(),
      });
      // Re-send the SAME event ID; successful account transactions remain deduplicated.
      await tx.update(OutboxEventRow, original.id, { publishedAt: null });
    });
    return { id, status: 'REPLAY_QUEUED' };
  }
}
