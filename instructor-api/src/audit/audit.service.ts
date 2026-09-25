import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Every mutating action on a question (approve/edit/reject) writes one of
  // these — not optional, per the brief: it's what makes a paper defensible
  // if challenged later. `actor` is free text until real session auth lands.
  log(params: {
    questionId: string;
    action: 'approve' | 'edit' | 'reject';
    actor: string;
    reason?: string | null;
    beforeState?: unknown;
    afterState?: unknown;
  }) {
    return this.prisma.approvalLog.create({
      data: {
        questionId: params.questionId,
        action: params.action,
        actor: params.actor,
        reason: params.reason ?? null,
        beforeState: params.beforeState as never,
        afterState: params.afterState as never,
      },
    });
  }
}
