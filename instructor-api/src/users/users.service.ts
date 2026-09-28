import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.js';
import type { SessionUser } from '../auth/decorators.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

// Same shape create-user.mjs generates when --password is left out.
const generatePassword = () => randomBytes(12).toString('base64url');

const PUBLIC_FIELDS = {
  id: true,
  username: true,
  serviceNumber: true,
  rank: true,
  fullName: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: [{ active: 'desc' }, { username: 'asc' }] });
  }

  async create(dto: CreateUserDto) {
    const username = dto.username.trim().toLowerCase();
    const serviceNumber = dto.serviceNumber.trim().toUpperCase();
    const password = dto.password ?? generatePassword();
    const passwordHash = await hashPassword(password);

    try {
      const user = await this.prisma.user.create({
        data: { username, serviceNumber, rank: dto.rank.trim(), fullName: dto.fullName.trim(), role: dto.role, passwordHash },
        select: PUBLIC_FIELDS,
      });
      // Only returned when the caller didn't supply one — this is the one
      // moment the plaintext password exists outside the admin's own head.
      return { user, generatedPassword: dto.password ? undefined : password };
    } catch (err) {
      const field = uniqueViolationField(err);
      if (field === 'username') throw new ConflictException(`Username ${username} is already in use.`);
      if (field === 'serviceNumber') throw new ConflictException(`Service number ${serviceNumber} is already in use.`);
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto, actingUser: SessionUser) {
    if (id === actingUser.id) {
      if (dto.role && dto.role !== actingUser.role) {
        throw new BadRequestException("You can't change your own role.");
      }
      if (dto.active === false) {
        throw new BadRequestException("You can't deactivate your own account.");
      }
    }

    const data = { ...dto };
    if (dto.username) data.username = dto.username.trim().toLowerCase();
    if (dto.rank) data.rank = dto.rank.trim();
    if (dto.fullName) data.fullName = dto.fullName.trim();

    const user = await this.prisma.user
      .update({ where: { id }, data, select: PUBLIC_FIELDS })
      .catch((err) => {
        if (isNotFound(err)) throw new NotFoundException('User not found.');
        if (uniqueViolationField(err) === 'username') throw new ConflictException(`Username ${data.username} is already in use.`);
        throw err;
      });

    // Deactivating (or, defensively, any update) doesn't retroactively end a
    // live session on its own — revoke explicitly so "deactivate" actually
    // signs them out immediately rather than just blocking future logins.
    if (dto.active === false) {
      await this.prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return user;
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    const password = dto.password ?? generatePassword();
    const passwordHash = await hashPassword(password);

    await this.prisma.user
      .update({ where: { id }, data: { passwordHash }, select: { id: true } })
      .catch((err) => {
        if (isNotFound(err)) throw new NotFoundException('User not found.');
        throw err;
      });

    // A password reset should force re-authentication everywhere, not just
    // block future logins with the old password.
    await this.prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });

    return { generatedPassword: dto.password ? undefined : password };
  }
}

// Prisma's P2002 error identifies which unique constraint fired, so the
// caller can say exactly which field collided (username vs. serviceNumber)
// instead of a generic "already in use". Prisma 7's @prisma/adapter-pg
// driver puts the constraint's index name (e.g. "User_username_key") at
// meta.driverAdapterError.cause.constraint.index rather than the classic
// meta.target column-name array — this checks both shapes.
function uniqueViolationField(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || (err as { code?: string }).code !== 'P2002') return null;
  const meta = (err as { meta?: Record<string, unknown> }).meta;
  const target = meta?.target as string[] | string | undefined;
  if (target) return Array.isArray(target) ? (target[0] ?? null) : target;

  const driverErr = meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  const index = driverErr?.cause?.constraint?.index;
  const match = index ? /^\w+_(.+)_key$/.exec(index) : null;
  return match ? match[1] : (index ?? null);
}
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';
}
