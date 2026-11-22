import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ApiService } from '../../src/v2/api/api.service';
import { AuthControllerV2 } from '../../src/v2/api/controllers';
import { RedisCacheService } from '../../src/v2/market/redis-cache.service';
import { BacktestingEngine } from '../../src/v2/backtesting/backtesting.engine';
import { PaperExecutionAdapter } from '../../src/v2/execution/paper-execution.adapter';
import { StoreService } from '../../src/v2/persistence/store.service';
import { RefreshTokenRow, V2User } from '../../src/v2/persistence/entities';
import { StrategyApprovalService } from '../../src/v2/strategy/approval.service';
import { SimulationSettings } from '../../src/v2/market/simulation-settings';

describe('refresh token sessions', () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@example.com',
    name: 'Admin',
    passwordHash: '',
    role: 'admin' as const,
    active: true,
    tokenVersion: 0,
  };
  const sessions: RefreshTokenRow[] = [];
  const refreshRepository = {
    save: async (row: RefreshTokenRow) => {
      const at = sessions.findIndex((candidate) => candidate.id === row.id);
      if (at >= 0) sessions[at] = { ...sessions[at], ...row };
      else sessions.push({ ...row });
      return row;
    },
    findOne: async ({ where }: { where: { id: string } }) =>
      sessions.find((session) => session.id === where.id) ?? null,
    findOneBy: async ({ id }: { id: string }) => sessions.find((session) => session.id === id) ?? null,
    update: async (criteria: string | { userId: string }, patch: Partial<RefreshTokenRow>) => {
      for (const session of sessions) {
        const matches =
          typeof criteria === 'string'
            ? session.id === criteria
            : session.userId === criteria.userId && !session.revokedAt;
        if (matches) Object.assign(session, patch);
      }
    },
  };
  const userRepository = {
    createQueryBuilder: () => ({
      addSelect: () => ({
        where: () => ({ getOne: async () => user }),
      }),
    }),
    findOneBy: async ({ id }: { id: string }) => (id === user.id ? user : null),
  };
  const getRepository = (entity: unknown) => {
    if (entity === RefreshTokenRow) return refreshRepository;
    if (entity === V2User) return userRepository;
    throw new Error('Unexpected repository');
  };
  const db = {
    manager: { getRepository },
    getRepository,
    transaction: async <T>(callback: (tx: { getRepository: typeof getRepository }) => Promise<T>) =>
      callback({ getRepository }),
  };
  const jwt = { signAsync: jest.fn(async () => `access-${sessions.length}`) } as unknown as JwtService;
  const service = new ApiService(
    { db } as unknown as StoreService,
    jwt,
    new PaperExecutionAdapter(),
    { ready: true } as RedisCacheService,
    new BacktestingEngine(),
    {} as StrategyApprovalService,
    {} as SimulationSettings,
    {} as never,
  );

  beforeAll(async () => {
    user.passwordHash = await bcrypt.hash('correct horse battery staple', 4);
  });
  beforeEach(() => {
    sessions.splice(0);
    user.active = true;
    user.tokenVersion = 0;
  });

  it('persists only a hash of an opaque refresh token', async () => {
    const session = await service.login(user.email, 'correct horse battery staple', '127.0.0.1');
    expect(session.refreshToken).toContain('.');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toContain(session.refreshToken);
    expect(sessions[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rotates refresh tokens and revokes all sessions when a rotated token is reused', async () => {
    const first = await service.login(user.email, 'correct horse battery staple', '127.0.0.1');
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toEqual(first.refreshToken);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(sessions[0].replacedById).toEqual(sessions[1].id);

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.every((session) => session.revokedAt)).toBe(true);
  });

  it('revokes the presented refresh token on logout', async () => {
    const session = await service.login(user.email, 'correct horse battery staple', '127.0.0.1');
    await service.logout(session.refreshToken);
    expect(sessions[0].revokedAt).toBeInstanceOf(Date);
    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns only an access token and writes the refresh token as an HttpOnly cookie', async () => {
    const api = {
      login: jest.fn(async () => ({
        accessToken: 'short-lived-access-token',
        refreshToken: 'opaque-refresh-token',
        user: { id: user.id, email: user.email, name: user.name, role: user.role, active: true },
      })),
    } as unknown as ApiService;
    const controller = new AuthControllerV2(api);
    const response = {
      setHeader: jest.fn(),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    const result = await controller.login(
      { email: user.email, password: 'correct horse battery staple' },
      { ip: '127.0.0.1', headers: {} } as never,
      response as never,
    );

    expect(result).toEqual({
      accessToken: 'short-lived-access-token',
      user: expect.objectContaining({ email: user.email }),
    });
    expect(result).not.toHaveProperty('refreshToken');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.cookie).toHaveBeenCalledWith(
      'volbot_refresh',
      'opaque-refresh-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/api/auth' }),
    );
  });
});
