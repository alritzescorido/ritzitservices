import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ProblemException } from '../common/problem.js';

export interface AccessClaims {
  sub: string;
  roles: string[];
  ver: 'pending' | 'verified' | 'rejected' | 'suspended';
  jti: string;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Route readable without a token (the public price board, locations, auth). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route restricted to these roles. Checked server-side on every request. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessClaims => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AccessClaims }>();
  if (!req.user) throw ProblemException.unauthorized();
  return req.user;
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { user?: AccessClaims }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (token) {
      try {
        const claims = await this.jwt.verifyAsync<AccessClaims & { purpose?: string }>(token);
        // Only access tokens carry roles; a sign-in step token or anything else is not a session.
        if (!Array.isArray(claims.roles) || claims.purpose) throw new Error('not an access token');
        req.user = claims;
      } catch {
        if (!isPublic) throw ProblemException.unauthorized('Token is invalid or expired');
      }
    } else if (!isPublic) {
      throw ProblemException.unauthorized();
    }

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length) {
      if (!req.user) throw ProblemException.unauthorized();
      if (!roles.some((r) => req.user!.roles.includes(r))) throw ProblemException.forbidden('Role check failed');
    }
    return true;
  }
}
