import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OllamaService } from '../ollama/ollama.service.js';
import { AiQueueService } from '../ai-queue/ai-queue.service.js';
import { KEEP_ALIVE, MARKING_MODEL, thinkFlag } from '../ai-queue/models.js';
import { shuffle } from '../blueprints/shuffle.js';
import { isNearDuplicate } from '../blueprints/duplicate-detection.js';
import { generatePrompt, parseGenerated } from './question-generator.js';

export interface GenerationStatus {
  state: 'queued' | 'running' | 'done' | 'failed';
  requested: number;
  created: number;
  skippedDuplicates: number;
  error?: string;
  updatedAt: string;
}

/**
 * Writes new theory questions from a session's past questions with the local
 * model, so the bank grows beyond what has been asked before. Every question
 * lands as an AI-drafted DRAFT with a model answer; the instructor reviews it
 * and builds its marking scheme like any other.
 */
@Injectable()
export class QuestionGenerationService {
  private readonly logger = new Logger(QuestionGenerationService.name);
  // Per session; a run is short-lived and only needs to survive until the page polls.
  private readonly runs = new Map<string, GenerationStatus>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollama: OllamaService,
    private readonly queue: AiQueueService,
  ) {
    this.queue.register('generate-similar', (target, model) => this.run(target, model));
  }

  private async seeds(sessionId: string, topic?: string) {
    return this.prisma.questionBankItem.findMany({
      where: {
        sessionId,
        type: 'THEORY',
        status: { in: ['DRAFT', 'APPROVED'] },
        ...(topic ? { topic } : {}),
        markingScheme: { modelAnswer: { not: null } },
      },
      include: { markingScheme: true },
    });
  }

  async start(dto: { sessionId: string; count: number; topic?: string }) {
    const current = this.runs.get(dto.sessionId);
    if (current && (current.state === 'queued' || current.state === 'running')) throw new BadRequestException('Questions are already being generated for this session.');
    const seeds = await this.seeds(dto.sessionId, dto.topic);
    if (!seeds.length) throw new BadRequestException('There are no theory questions with a model answer to work from. Upload a marking scheme, or add model answers to past questions, first.');
    this.queue.assertRoom();
    const status: GenerationStatus = { state: 'queued', requested: dto.count, created: 0, skippedDuplicates: 0, updatedAt: new Date().toISOString() };
    this.runs.set(dto.sessionId, status);
    const target = JSON.stringify({ sessionId: dto.sessionId, count: dto.count, topic: dto.topic ?? null });
    this.queue.add({ id: `generate:${dto.sessionId}`, target, kind: 'generate-similar', stage: 'mark', model: MARKING_MODEL });
    return status;
  }

  status(sessionId: string): GenerationStatus | null {
    return this.runs.get(sessionId) ?? null;
  }

  async run(target: string, model: string) {
    const { sessionId, count, topic } = JSON.parse(target) as { sessionId: string; count: number; topic: string | null };
    const status = this.runs.get(sessionId) ?? { state: 'queued', requested: count, created: 0, skippedDuplicates: 0, updatedAt: '' };
    const touch = (patch: Partial<GenerationStatus>) => this.runs.set(sessionId, Object.assign(status, patch, { updatedAt: new Date().toISOString() }));
    touch({ state: 'running' });
    try {
      const seeds = shuffle(await this.seeds(sessionId, topic ?? undefined));
      const bodies = (await this.prisma.questionBankItem.findMany({ where: { sessionId }, select: { body: true } })).map((q) => q.body);
      // Spread the new questions across different past questions, cycling if asked for more than there are.
      for (let i = 0; i < count && seeds.length; i++) {
        const seed = seeds[i % seeds.length];
        const scheme = seed.markingScheme!;
        try {
          const raw = await this.ollama.generate({
            model,
            prompt: generatePrompt({ body: seed.body, topic: seed.topic, totalMarks: scheme.totalMarks, modelAnswer: scheme.modelAnswer! }),
            json: true,
            think: thinkFlag(model),
            keepAlive: KEEP_ALIVE,
          });
          const q = parseGenerated(raw, scheme.totalMarks);
          if (isNearDuplicate(q.body, bodies)) {
            touch({ skippedDuplicates: status.skippedDuplicates + 1 });
            continue;
          }
          await this.prisma.questionBankItem.create({
            data: {
              sessionId,
              topic: seed.topic,
              difficulty: seed.difficulty,
              type: 'THEORY',
              source: 'AI_DRAFTED',
              status: 'DRAFT',
              body: q.body,
              citation: `Written by the local AI from a past question: ${seed.citation ?? seed.body.slice(0, 80)}`,
              markingScheme: { create: { totalMarks: q.totalMarks, minWordCount: 3, modelAnswer: q.modelAnswer } },
            },
          });
          bodies.push(q.body);
          touch({ created: status.created + 1 });
        } catch (err) {
          this.logger.warn(`generating a question from ${seed.id} failed: ${String(err)}`);
        }
      }
      touch({ state: 'done' });
    } catch (err) {
      touch({ state: 'failed', error: String(err).slice(0, 300) });
    }
  }
}
