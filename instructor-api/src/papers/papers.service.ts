import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { FreezePaperDto } from './dto/freeze-paper.dto.js';

@Injectable()
export class PapersService {
  constructor(private readonly prisma: PrismaService) {}

  async freeze(dto: FreezePaperDto) {
    if (dto.confirmationPhrase.trim().toLowerCase() !== dto.title.trim().toLowerCase()) {
      throw new BadRequestException('confirmationPhrase must match the paper title exactly');
    }

    const pending = await this.prisma.questionBankItem.count({
      where: { sessionId: dto.sessionId, status: 'DRAFT' },
    });
    if (pending > 0) {
      throw new BadRequestException(
        `${pending} question(s) are still pending review. Every question must be approved or rejected before freezing.`,
      );
    }

    const approved = await this.prisma.questionBankItem.findMany({
      where: { sessionId: dto.sessionId, status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
    });
    if (approved.length === 0) {
      throw new BadRequestException('no approved questions to freeze — nothing to package');
    }

    return this.prisma.$transaction(async (tx) => {
      const paper =
        (await tx.paper.findFirst({ where: { sessionId: dto.sessionId, title: dto.title } })) ??
        (await tx.paper.create({ data: { sessionId: dto.sessionId, title: dto.title } }));

      const lastVersion = await tx.paperVersion.findFirst({
        where: { paperId: paper.id },
        orderBy: { versionNumber: 'desc' },
      });
      const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

      const signatureHash = createHash('sha256')
        .update(approved.map((q) => `${q.id}:${q.body}`).join('|'))
        .digest('hex');

      const version = await tx.paperVersion.create({
        data: {
          paperId: paper.id,
          versionNumber,
          frozenBy: dto.frozenBy,
          signatureHash,
          items: {
            create: approved.map((q, i) => ({ questionId: q.id, position: i })),
          },
        },
        include: { items: { include: { question: true }, orderBy: { position: 'asc' } } },
      });

      return { paper, version };
    });
  }

  async listVersions(sessionId: string) {
    return this.prisma.paper.findMany({
      where: { sessionId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, include: { items: true } } },
    });
  }
}
