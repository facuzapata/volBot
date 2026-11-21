import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { V2User } from '../persistence/entities';

export const Public = () => SetMetadata('v2-public', true);
export const Admin = () => SetMetadata('v2-admin', true);
export type AuthRequest = Request & { user: V2User };
export function jwtSecret(): string {
  const key = process.env.V2_JWT_SECRET;
  if (!key || key.length < 32 || /change|example|replace/i.test(key))
    throw new Error('V2_JWT_SECRET must be a unique secret of at least 32 characters');
  return key;
}
@Injectable()
export class AuthGuardV2 implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DataSource,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride('v2-public', [context.getHandler(), context.getClass()]))
      return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) throw new UnauthorizedException();
    let payload: { sub: string; version: number };
    try {
      payload = await this.jwt.verifyAsync(token, {
        issuer: 'volbot-v2',
        audience: 'volbot-v2-api',
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.db.getRepository(V2User).findOneBy({ id: payload.sub });
    if (!user || !user.active || user.tokenVersion !== payload.version)
      throw new UnauthorizedException();
    if (
      this.reflector.getAllAndOverride('v2-admin', [context.getHandler(), context.getClass()]) &&
      user.role !== 'admin'
    )
      throw new ForbiddenException();
    req.user = user;
    return true;
  }
}
