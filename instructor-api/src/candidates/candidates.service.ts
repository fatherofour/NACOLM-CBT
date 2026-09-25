import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.js';
import { CreateCandidateDto } from './dto/create-candidate.dto.js';
import { BulkImportDto } from './dto/bulk-import.dto.js';
import { UpdateCandidateDto } from './dto/update-candidate.dto.js';

// The venue's local-exam-server verifies check-in against a roster CSV
// loaded from disk (service_number,rank,full_name,pin) — see
// local-exam-server/internal/roster. That CSV is built here, from whichever
// create/bulk-import response last had the plaintext PIN in it: like a
// staff password, a candidate's PIN is never stored in the clear and is
// only ever returned once — a lost admission slip means resetting the PIN
// and reprinting, not looking the old one up.
const PUBLIC_FIELDS = {
  id: true,
  sessionId: true,
  armyNumber: true,
  rank: true,
  fullName: true,
  active: true,
  createdAt: true,
} as const;

const generatePin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(sessionId: string) {
    return this.prisma.candidate.findMany({
      where: { sessionId },
      select: PUBLIC_FIELDS,
      orderBy: [{ active: 'desc' }, { armyNumber: 'asc' }],
    });
  }

  async create(dto: CreateCandidateDto) {
    const armyNumber = dto.armyNumber.trim().toUpperCase();
    const rank = dto.rank.trim();
    const fullName = dto.fullName.trim();
    const pin = dto.pin ?? generatePin();
    const pinHash = await hashPassword(pin);

    try {
      const candidate = await this.prisma.candidate.create({
        data: { sessionId: dto.sessionId, armyNumber, rank, fullName, pinHash },
        select: PUBLIC_FIELDS,
      });
      return { candidate, generatedPin: dto.pin ? undefined : pin };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`${armyNumber} is already registered for this session.`);
      throw err;
    }
  }

  /** Registers a batch (e.g. a whole class) in one go — every PIN is
   * generated, since there's no reasonable UI for typing one per row. Rows
   * with an Army Number already registered for this session are skipped,
   * not overwritten, and reported back so the caller can see what happened. */
  async bulkImport(dto: BulkImportDto) {
    const created: { armyNumber: string; rank: string; fullName: string; pin: string }[] = [];
    const skipped: string[] = [];

    for (const row of dto.candidates) {
      const armyNumber = row.armyNumber.trim().toUpperCase();
      const rank = row.rank.trim();
      const fullName = row.fullName.trim();
      const existing = await this.prisma.candidate.findUnique({
        where: { sessionId_armyNumber: { sessionId: dto.sessionId, armyNumber } },
      });
      if (existing) {
        skipped.push(armyNumber);
        continue;
      }
      const pin = generatePin();
      await this.prisma.candidate.create({
        data: { sessionId: dto.sessionId, armyNumber, rank, fullName, pinHash: await hashPassword(pin) },
      });
      created.push({ armyNumber, rank, fullName, pin });
    }

    return { created, skipped };
  }

  async update(id: string, dto: UpdateCandidateDto) {
    const data: { rank?: string; fullName?: string; active?: boolean } = {};
    if (dto.rank) data.rank = dto.rank.trim();
    if (dto.fullName) data.fullName = dto.fullName.trim();
    if (dto.active !== undefined) data.active = dto.active;

    return this.prisma.candidate.update({ where: { id }, data, select: PUBLIC_FIELDS }).catch((err) => {
      if (isNotFound(err)) throw new NotFoundException('Candidate not found.');
      throw err;
    });
  }

  async resetPin(id: string) {
    const pin = generatePin();
    const candidate = await this.prisma.candidate
      .update({
        where: { id },
        data: { pinHash: await hashPassword(pin) },
        select: { armyNumber: true, rank: true, fullName: true },
      })
      .catch((err) => {
        if (isNotFound(err)) throw new NotFoundException('Candidate not found.');
        throw err;
      });
    return { ...candidate, generatedPin: pin };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';
}
