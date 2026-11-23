import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { liveTradingEnabled, numberEnv, refreshTokenTtlDays, selectedStrategy } from '../config';
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
  RefreshTokenRow,
} from '../persistence/entities';
import { StoreService } from '../persistence/store.service';
import { StrategyApprovalService, configurationHash } from '../strategy/approval.service';
import { strategyConfiguration, revisionFor } from '../strategy/versions';
import { DEFAULT_BTC_V3 } from '../strategy/btc-v3.config';
import { SimulationSettings } from '../market/simulation-settings';
import { BinanceCredentialsService } from '../execution/binance-credentials.service';
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
export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: PublicUserDto;
};
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
    private readonly credentials: BinanceCredentialsService,
  ) {}
  get db(): DataSource {
    return this.store.db;
  }
  private accessToken(user: V2User): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, version: user.tokenVersion },
      { expiresIn: '15m', issuer: 'volbot-v2', audience: 'volbot-v2-api', algorithm: 'HS256' },
    );
  }
  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
  private newRefreshToken(id = randomUUID()): { id: string; token: string } {
    return { id, token: `${id}.${randomBytes(48).toString('base64url')}` };
  }
  private async createSession(user: V2User, tx?: EntityManager): Promise<AuthSession> {
    const refresh = this.newRefreshToken();
    const repo = (tx ?? this.db.manager).getRepository(RefreshTokenRow);
    await repo.save({
      id: refresh.id,
      userId: user.id,
      tokenHash: this.tokenHash(refresh.token),
      tokenVersion: user.tokenVersion,
      expiresAt: new Date(Date.now() + refreshTokenTtlDays() * 86400000),
      revokedAt: null,
      replacedById: null,
    });
    return { accessToken: await this.accessToken(user), refreshToken: refresh.token, user: publicUser(user) };
  }
  async login(email: string, password: string, remote: string): Promise<AuthSession> {
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
    return this.createSession(user);
  }
  async refresh(rawToken: string): Promise<AuthSession> {
    const parts = rawToken.split('.');
    const [id, secret] = parts;
    if (!id || !secret || parts.length !== 2) throw new UnauthorizedException('Invalid refresh token');
    return this.db.transaction(async (tx) => {
      const sessions = tx.getRepository(RefreshTokenRow);
      const current = await sessions.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new UnauthorizedException('Invalid refresh token');
      const invalid =
        current.revokedAt ||
        current.expiresAt.getTime() <= Date.now() ||
        current.tokenHash !== this.tokenHash(rawToken);
      if (invalid) {
        // A reused rotated token invalidates all sessions for this user.
        await sessions.update({ userId: current.userId, revokedAt: IsNull() }, { revokedAt: new Date() });
        throw new UnauthorizedException('Refresh token expired or revoked');
      }
      const user = await tx.getRepository(V2User).findOneBy({ id: current.userId });
      if (!user || !user.active || user.tokenVersion !== current.tokenVersion) {
        await sessions.update(current.id, { revokedAt: new Date() });
        throw new UnauthorizedException('Session revoked');
      }
      const next = this.newRefreshToken();
      const now = new Date();
      await sessions.save({
        id: next.id,
        userId: user.id,
        tokenHash: this.tokenHash(next.token),
        tokenVersion: user.tokenVersion,
        expiresAt: new Date(Date.now() + refreshTokenTtlDays() * 86400000),
        revokedAt: null,
        replacedById: null,
      });
      await sessions.update(current.id, { revokedAt: now, replacedById: next.id });
      return { accessToken: await this.accessToken(user), refreshToken: next.token, user: publicUser(user) };
    });
  }
  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    const parts = rawToken.split('.');
    const [id, secret] = parts;
    if (!id || !secret || parts.length !== 2) return;
    const sessions = this.db.getRepository(RefreshTokenRow);
    const session = await sessions.findOneBy({ id });
    if (session && session.tokenHash === this.tokenHash(rawToken) && !session.revokedAt)
      await sessions.update(id, { revokedAt: new Date() });
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
      executionMode: a.executionMode ?? 'PAPER',
    };
  }
  async exchangeConnection(userId: string) {
    return this.credentials.status(userId);
  }
  async saveExchangeConnection(userId: string, apiKey: string, secret: string, environment: 'TESTNET' | 'LIVE') {
    return this.credentials.saveAndVerify(userId, apiKey, secret, environment);
  }
  async executionMode(userId: string, mode: 'PAPER' | 'LIVE') {
    const accountId = await this.accountId(userId);
    if (mode === 'LIVE') {
      const connection = await this.credentials.verify(userId);
      if (connection.environment === 'LIVE' && !liveTradingEnabled())
        throw new ConflictException('Production LIVE trading is disabled by V2_LIVE_TRADING_ENABLED');
    }
    await this.store.accountTransaction(accountId, async (s) => {
      s.account.executionMode = mode;
    });
    return this.configuration((await this.state(userId)).account);
  }
  async entries(userId: string, enabled: boolean) {
    const accountId = await this.accountId(userId);
    const account = (await this.state(userId)).account;
    if (enabled && account.executionMode === 'LIVE') {
      const connection = await this.credentials.verify(userId);
      if (connection.environment === 'LIVE' && !liveTradingEnabled())
        throw new ConflictException('Production LIVE trading is disabled by V2_LIVE_TRADING_ENABLED');
      // The current worker is still the deterministic PAPER execution engine. Refuse rather than
      // labeling simulated fills as exchange trades until the broker order/reconciliation lifecycle is wired.
      throw new ConflictException('LIVE order execution is not enabled yet; configure and validate on TESTNET first');
    }
    await this.store.accountTransaction(accountId, async (s) => {
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
      mode: s.account.executionMode ?? 'PAPER',
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
    return Promise.all((['legacy-v1','btc-v2','btc-v3','btc-v4','btc-v5','btc-v6','trend-reference'] as StrategyId[]).map(async id=>{
      const row=rows.find(r=>r.id===id);
      const currentSnapshot=id==='btc-v5'
        ? row?.revision===revisionFor(id)&&row.state.configuration?.btcV5?.revision===revisionFor(id)
        : id==='btc-v6'
          ? row?.revision===revisionFor(id)&&row.state.configuration?.btcV6?.revision===revisionFor(id)
          : true;
      const savedConfiguration=currentSnapshot?row?.state.configuration:undefined;
      const configuration=savedConfiguration??strategyConfiguration(id,id==='btc-v5'?this.settings.config:id==='btc-v3'&&this.settings.btcV3Calibration?{btcV3Calibration:this.settings.btcV3Calibration}:{});
      const hash=configurationHash(id,revisionFor(id),configuration);
      return {id,revision:revisionFor(id),active:row?.state.active ?? id===selectedStrategy(),lastEvaluationAt:currentSnapshot?(row?.state.lastCandleTime??0):0,eligible:currentSnapshot?(row?.state.eligible??false):false,configuration,configurationHash:hash,calibrationReady:!!configuration.btcV3Calibration,lastDecision:currentSnapshot?row?.state.lastDecision:undefined,
        description:id==='btc-v6'?'Experimental PAPER V6: momentum cripto agresivo, ruptura y entrada en el mismo minuto. TARGET_ONLY sin stop ni vencimiento; no está calificada.':id==='btc-v5'?'Experimental PAPER V5.9: salto excepcional con volumen y tendencia, confirmado por el minuto siguiente. TARGET_ONLY no tiene stop ni vencimiento.':id==='btc-v4'?'Candidata PAPER V4.5: contexto y pullback 4h; entrada de recuperación evaluada cada minuto, con stop/objetivo estructurales.':id==='btc-v3'?'Experimental: tendencia 1h, retroceso/ATR 5m, recuperación 1m y abstención calibrada.':id==='btc-v2'?'Baseline original: tendencia 1h, confirmación 5m y entrada 1m.':id==='trend-reference'?'Referencia de backtest, sin selección operativa.':'Indicadores originales y puntuación 5/7.'};
    }));
  }
  async activateStrategy(id: StrategyId) {
    if (!['legacy-v1', 'btc-v2', 'btc-v3', 'btc-v4', 'btc-v5', 'btc-v6'].includes(id)) throw new BadRequestException('Strategy cannot be operationally selected');
    await this.db.transaction(async (tx) => {
      const rows = await tx.find(StrategyVersionRow);
      if (!rows.some((row) => row.id === id)) {
        const row = {
          id,
          revision: revisionFor(id),
          state: { active: false, eligible: false, lastCandleTime: 0, lastSignalTime: 0 },
        } as StrategyVersionRow;
        await tx.save(row);
        rows.push(row);
      }
      for (const row of rows) {
        const active = row.id === id;
        if (row.state.active !== active) {
          row.state = { ...row.state, active };
          await tx.save(row);
        }
      }
    });
    return (await this.strategies()).find((strategy) => strategy.id === id)!;
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
