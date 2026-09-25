import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiGenerationService } from '../ai-generation/ai-generation.service.js';
import { CreateBlueprintDto } from './dto/create-blueprint.dto.js';
import { allocateByWeight, allocateEvenly } from './allocation.js';
import { isNearDuplicate } from './duplicate-detection.js';
import type { QuestionType } from '../generated/prisma/enums.js';

export interface Shortfall {
  topic: string;
  type: QuestionType;
  needed: number;
  found: number;
}

@Injectable()
export class BlueprintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiGeneration: AiGenerationService,
  ) {}

  listForSession(sessionId: string) {
    return this.prisma.blueprint.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreateBlueprintDto) {
    if (dto.objectiveCount + dto.theoryCount !== dto.totalCount) {
      throw new BadRequestException('objectiveCount + theoryCount must equal totalCount');
    }
    if ((dto.sourceMode === 'study_material_only' || dto.sourceMode === 'both') && dto.topics.length === 0) {
      throw new BadRequestException('at least one topic is required to draft from study material');
    }

    const distribution = allocateEvenly(dto.totalCount, dto.topics);

    return this.prisma.blueprint.create({
      data: {
        sessionId: dto.sessionId,
        sourceMode: dto.sourceMode,
        pastQuestionRatio: dto.pastQuestionRatio ?? 1.0,
        targetCount: dto.totalCount,
        objectiveCount: dto.objectiveCount,
        theoryCount: dto.theoryCount,
        distribution,
      },
    });
  }

  async coverage(blueprintId: string) {
    const blueprint = await this.getOrThrow(blueprintId);
    const distribution = (blueprint.distribution as Record<string, number>) ?? {};

    const items = await this.prisma.questionBankItem.findMany({
      where: { sessionId: blueprint.sessionId, topic: { in: Object.keys(distribution) } },
    });

    return Object.entries(distribution).map(([topic, target]) => {
      const forTopic = items.filter((i) => i.topic === topic);
      const approved = forTopic.filter((i) => i.status === 'APPROVED');
      return {
        topic,
        target,
        approved: approved.length,
        pending: forTopic.filter((i) => i.status === 'DRAFT').length,
        rejected: forTopic.filter((i) => i.status === 'REJECTED').length,
        byDifficulty: {
          easy: approved.filter((i) => i.difficulty === 'easy').length,
          medium: approved.filter((i) => i.difficulty === 'medium').length,
          hard: approved.filter((i) => i.difficulty === 'hard').length,
        },
        gap: Math.max(0, target - approved.length),
      };
    });
  }

  async generate(blueprintId: string) {
    const blueprint = await this.getOrThrow(blueprintId);
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: blueprint.sessionId },
      include: { course: true },
    });
    const distribution = (blueprint.distribution as Record<string, number>) ?? {};

    let created = 0;
    let skippedDuplicates = 0;
    const shortfalls: Shortfall[] = [];

    const existingBodies = (
      await this.prisma.questionBankItem.findMany({
        where: { sessionId: blueprint.sessionId },
        select: { body: true },
      })
    ).map((q) => q.body);

    for (const topic of Object.keys(distribution)) {
      const topicTarget = distribution[topic];
      const typeSplit = allocateByWeight(topicTarget, {
        OBJECTIVE: blueprint.objectiveCount,
        THEORY: blueprint.theoryCount,
      });

      for (const type of ['OBJECTIVE', 'THEORY'] as QuestionType[]) {
        const needed = typeSplit[type];
        if (needed === 0) continue;

        const result = await this.fillFromSources({
          sessionId: blueprint.sessionId,
          courseCode: session.course.code,
          sessionLabel: session.label,
          topic,
          type,
          needed,
          sourceMode: blueprint.sourceMode as 'past_only' | 'study_material_only' | 'both',
          pastQuestionRatio: blueprint.pastQuestionRatio,
          existingBodies,
        });

        created += result.created;
        skippedDuplicates += result.skippedDuplicates;
        if (result.found < needed) {
          shortfalls.push({ topic, type, needed, found: result.found });
        }
      }
    }

    return { created, skippedDuplicates, shortfalls };
  }

  private async fillFromSources(params: {
    sessionId: string;
    courseCode: string;
    sessionLabel: string;
    topic: string;
    type: QuestionType;
    needed: number;
    sourceMode: 'past_only' | 'study_material_only' | 'both';
    pastQuestionRatio: number;
    existingBodies: string[];
  }): Promise<{ created: number; found: number; skippedDuplicates: number }> {
    let found = 0;
    let created = 0;
    let skippedDuplicates = 0;

    // "Past questions only" / the bank-first half of "both": pull existing
    // bank items instantly, no AI call. These already exist as rows, so
    // "found" just counts them — nothing new to create.
    if (params.sourceMode === 'past_only' || params.sourceMode === 'both') {
      const pastNeeded =
        params.sourceMode === 'past_only' ? params.needed : Math.round(params.needed * params.pastQuestionRatio);

      const pastAvailable = await this.prisma.questionBankItem.findMany({
        where: {
          sessionId: params.sessionId,
          topic: params.topic,
          type: params.type,
          source: 'PAST_PAPER',
          status: { in: ['DRAFT', 'APPROVED'] },
        },
        take: pastNeeded,
      });
      found += pastAvailable.length;
    }

    // "Study material only" / the AI half of "both": whatever's still
    // needed after the bank is drafted via central-api's RAG pipeline.
    if (params.sourceMode === 'study_material_only' || params.sourceMode === 'both') {
      const aiNeeded = params.needed - found;
      if (aiNeeded > 0) {
        const drafted = await this.aiGeneration.draftQuestions({
          courseCode: params.courseCode,
          sessionLabel: params.sessionLabel,
          topic: params.topic,
          questionType: params.type,
          count: aiNeeded,
          source: 'study_material',
        });

        for (const item of drafted) {
          if (isNearDuplicate(item.stem, params.existingBodies)) {
            skippedDuplicates++;
            continue;
          }
          await this.prisma.questionBankItem.create({
            data: {
              sessionId: params.sessionId,
              topic: item.topic,
              difficulty: item.difficulty,
              type: params.type,
              source: 'AI_DRAFTED',
              status: 'DRAFT',
              body: item.stem,
              options: item.options ?? undefined,
              correctIndex: item.correct_index ?? undefined,
              citation: 'AI-drafted from study material', // page-level citation is a follow-up — see README
            },
          });
          params.existingBodies.push(item.stem); // avoid drafting near-duplicates of each other within this same run
          created++;
          found++;
        }
      }
    }

    return { created, found, skippedDuplicates };
  }

  private async getOrThrow(id: string) {
    const blueprint = await this.prisma.blueprint.findUnique({ where: { id } });
    if (!blueprint) throw new NotFoundException('blueprint not found');
    return blueprint;
  }
}
