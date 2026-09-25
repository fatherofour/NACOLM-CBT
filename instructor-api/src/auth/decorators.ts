import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../generated/prisma/enums.js';

export interface SessionUser {
  id: string;
  serviceNumber: string;
  rank: string;
  fullName: string;
  role: UserRole;
}

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES = 'auth:roles';

/** Route needs no login (health check, the login endpoint itself). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is limited to these roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** The signed-in user, set by AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** How a user is named in audit logs and on frozen papers. */
export function actorName(user: SessionUser): string {
  return `${user.rank} ${user.fullName} (${user.serviceNumber})`;
}
