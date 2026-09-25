import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CreateBankItemDto } from './dto/create-bank-item.dto.js';
import { EditQuestionDto } from './dto/edit-question.dto.js';
import type { QuestionStatus, QuestionType } from '../generated/prisma/enums.js';

@Injectable()
export class QuestionBankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(sessionId: string, filters: { status?: QuestionStatus; type?: QuestionType; topic?: string }) {
    return this.prisma.questionBankItem.findMany({
      where: { sessionId, ...filters },
      include: { markingScheme: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  reviewProgress(sessionId: string) {
    return this.prisma.questionBankItem.groupBy({
      by: ['status'],
      where: { sessionId },
      _count: true,
    });
  }

  create(dto: CreateBankItemDto) {
    return this.prisma.questionBankItem.create({ data: dto });
  }

  async approve(id: string, actor: string) {
    const before = await this.getOrThrow(id);
    const after = await this.prisma.questionBankItem.update({
      where: { id },
      data: { status: 'APPROVED', rejectReason: null },
    });
    await this.audit.log({ questionId: id, action: 'approve', actor, beforeState: before, afterState: after });
    return after;
  }

  async reject(id: string, reason: string, actor: string) {
    const before = await this.getOrThrow(id);
    const after = await this.prisma.questionBankItem.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason },
    });
    await this.audit.log({
      questionId: id,
      action: 'reject',
      actor,
      reason,
      beforeState: before,
      afterState: after,
    });
    return after;
  }

  async edit(id: string, dto: EditQuestionDto, actor: string) {
    const before = await this.getOrThrow(id);
    if (before.type === 'OBJECTIVE' && dto.options && dto.correctIndex !== undefined) {
      if (dto.correctIndex < 0 || dto.correctIndex >= dto.options.length) {
        throw new BadRequestException('correctIndex is out of range for the given options');
      }
    }
    const after = await this.prisma.questionBankItem.update({
      where: { id },
      data: { ...dto, version: { increment: 1 } },
    });
    await this.audit.log({ questionId: id, action: 'edit', actor, beforeState: before, afterState: after });
    return after;
  }

  auditLog(questionId: string) {
    return this.prisma.approvalLog.findMany({ where: { questionId }, orderBy: { createdAt: 'desc' } });
  }

  private async getOrThrow(id: string) {
    const item = await this.prisma.questionBankItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('question not found');
    return item;
  }
}
