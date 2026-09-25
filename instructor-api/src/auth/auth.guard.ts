import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, SESSION_COOKIE, readCookie } from './auth.service.js';
import { IS_PUBLIC, ROLES } from './decorators.js';
import type { UserRole } from '../generated/prisma/enums.js';

// Applied to every route (APP_GUARD). Routes opt out with @Public().
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = await this.auth.validate(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!user) throw new UnauthorizedException('Sign in to continue.');
    req.user = user;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role can’t do this.');
    }
    return true;
  }
}
