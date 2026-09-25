import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import { LoginThrottle } from './login-throttle.js';
import type { SessionUser } from './decorators.js';

export const SESSION_COOKIE = 'nacolm_session';
const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // a session never outlives a working day
const IDLE_TTL_MS = 60 * 60 * 1000; // sign out after an hour of inactivity
const TOUCH_EVERY_MS = 60 * 1000; // don't write lastSeenAt on every request

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private readonly throttle = new LoginThrottle();

  constructor(private readonly prisma: PrismaService) {}

  async login(serviceNumber: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const key = serviceNumber.trim().toUpperCase();
    const locked = this.throttle.lockedFor(key);
    if (locked > 0) {
      const minutes = Math.ceil(locked / 60000);
      throw new HttpException(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { serviceNumber: key } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      this.throttle.recordFailure(key);
      throw new UnauthorizedException('Service number or password is incorrect.');
    }
    this.throttle.recordSuccess(key);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ABSOLUTE_TTL_MS);
    await this.prisma.authSession.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt,
        ipAddress: meta.ip?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });
    return { token, expiresAt, user: toSessionUser(user) };
  }

  /** Returns the user for a valid session token, or null. */
  async validate(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || !session.user.active) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_TTL_MS) return null;
    if (now - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }
    return toSessionUser(session.user);
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.authSession.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function toSessionUser(u: { id: string; serviceNumber: string; rank: string; fullName: string; role: SessionUser['role'] }): SessionUser {
  return { id: u.id, serviceNumber: u.serviceNumber, rank: u.rank, fullName: u.fullName, role: u.role };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
