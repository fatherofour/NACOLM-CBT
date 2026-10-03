import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { PublishPaperDto } from './dto/publish-paper.dto.js';
import { toSnapshot } from '../theory-scripts/marking.js';

@Injectable()
export class PapersService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(dto: PublishPaperDto) {
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
      include: { markingScheme: { include: { conceptGroups: { orderBy: { order: 'asc' } } } } },
    });
    if (approved.length === 0) {
      throw new BadRequestException('no approved questions to publish — nothing to package');
    }

    // Nothing the AI drafted counts until a person approves it: every theory
    // question needs an approved marking scheme before the paper goes out.
    const unapproved = approved.filter((q) => q.type === 'THEORY' && q.markingScheme?.status !== 'APPROVED');
    if (unapproved.length) {
      throw new BadRequestException(
        `${unapproved.length} theory question(s) don't have an approved marking scheme yet. Approve each scheme in review before publishing.`,
      );
    }
    // Frozen with the paper: scripts are marked against exactly what was approved.
    const snapshots = new Map(approved.filter((q) => q.markingScheme).map((q) => [q.id, toSnapshot(q.markingScheme!)]));

    return this.prisma.$transaction(async (tx) => {
      const existingPaper = await tx.paper.findFirst({ where: { sessionId: dto.sessionId, title: dto.title } });
      const paper = existingPaper
        ? dto.durationMinutes || dto.passMark
          ? await tx.paper.update({
              where: { id: existingPaper.id },
              data: { durationMinutes: dto.durationMinutes, passMark: dto.passMark, theoryOnPaper: dto.theoryOnPaper ?? existingPaper.theoryOnPaper },
            })
          : dto.theoryOnPaper !== undefined
            ? await tx.paper.update({ where: { id: existingPaper.id }, data: { theoryOnPaper: dto.theoryOnPaper } })
            : existingPaper
        : await tx.paper.create({
            data: {
              sessionId: dto.sessionId,
              title: dto.title,
              durationMinutes: dto.durationMinutes ?? 60,
              passMark: dto.passMark ?? 50,
              theoryOnPaper: dto.theoryOnPaper ?? true,
            },
          });

      const lastVersion = await tx.paperVersion.findFirst({
        where: { paperId: paper.id },
        orderBy: { versionNumber: 'desc' },
      });
      const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

      const signatureHash = createHash('sha256')
        .update(approved.map((q) => `${q.id}:${q.body}:${JSON.stringify(snapshots.get(q.id) ?? null)}`).join('|'))
        .digest('hex');

      const version = await tx.paperVersion.create({
        data: {
          paperId: paper.id,
          versionNumber,
          examDate: new Date(dto.examDate),
          publishedBy: dto.publishedBy,
          signatureHash,
          items: {
            create: approved.map((q, i) => ({ questionId: q.id, position: i, markingSnapshot: (snapshots.get(q.id) ?? undefined) as never })),
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
