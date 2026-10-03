import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OllamaService } from '../ollama/ollama.service.js';
import { AiQueueService } from '../ai-queue/ai-queue.service.js';
import { KEEP_ALIVE, MARKING_MODEL, thinkFlag } from '../ai-queue/models.js';
import { markingPrompt, parseMarking, toSnapshot } from '../theory-scripts/marking.js';
import { SaveMarkingSchemeDto } from './dto/save-marking-scheme.dto.js';
import { scoreAnswer, type MarkingSchemeInput } from './keyword-marking.js';
import { suggestConceptGroups } from './term-extraction.js';
import { draftPrompt, parseDraft, type SampleAnswer } from './scheme-draft.js';

const DEFAULT_CEILING_PERCENT = 50;
const DEFAULT_MIN_WORD_COUNT = 15;

const allocatedOf = (groups: { marks: number }[]) => groups.reduce((sum, g) => sum + g.marks, 0);
const sameMarks = (a: number, b: number) => Math.abs(a - b) < 0.001;

function toScorerInput(scheme: {
  totalMarks: number;
  ceilingPercent: number;
  minWordCount: number;
  conceptGroups: { canonicalTerm: string; synonyms: string[]; marks: number; required: boolean }[];
}): MarkingSchemeInput {
  return {
    totalMarks: scheme.totalMarks,
    requiredGroupCeilingPercent: scheme.ceilingPercent,
    minWordCount: scheme.minWordCount,
    groups: scheme.conceptGroups.map((g) => ({
      label: g.canonicalTerm,
      terms: [g.canonicalTerm, ...g.synonyms],
      marks: g.marks,
      required: g.required,
    })),
  };
}

const withGroups = { conceptGroups: { orderBy: { order: 'asc' as const } } };

@Injectable()
export class MarkingSchemesService implements OnModuleInit {
  private readonly logger = new Logger(MarkingSchemesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollama: OllamaService,
    private readonly queue: AiQueueService,
  ) {
    this.queue.register('scheme-draft', (id, model) => this.runDraft(id, model));
    this.queue.register('scheme-test', (id, model) => this.runTest(id, model));
  }

  /** A draft or test interrupted by a restart is put back in the queue. */
  async onModuleInit() {
    const pending = await this.prisma.markingScheme.findMany({ where: { aiTask: { not: null } }, select: { id: true, aiTask: true } });
    for (const p of pending) this.enqueue(p.id, p.aiTask === 'drafting' ? 'scheme-draft' : 'scheme-test');
  }

  private enqueue(schemeId: string, kind: 'scheme-draft' | 'scheme-test') {
    this.queue.add({ id: `scheme:${schemeId}`, target: schemeId, kind, stage: 'mark', model: MARKING_MODEL });
  }

  private async theoryQuestion(questionId: string) {
    const question = await this.prisma.questionBankItem.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException('question not found');
    if (question.type !== 'THEORY') throw new BadRequestException('only theory questions have a marking scheme');
    return question;
  }

  async get(questionId: string) {
    const scheme = await this.prisma.markingScheme.findUnique({ where: { questionId }, include: withGroups });
    if (!scheme) throw new NotFoundException('no marking scheme for this question yet');
    return scheme;
  }

  async suggest(questionId: string) {
    const question = await this.theoryQuestion(questionId);
    // A theory question sourced from the bank may already carry a reusable
    // scheme (spec: "Reused from bank" badge). Otherwise, suggest groups
    // extracted from the question for the instructor to edit into real groups.
    const existing = await this.prisma.markingScheme.findUnique({ where: { questionId }, include: withGroups });
    if (existing) return { reusedFromBank: existing.reusedFromBank, scheme: existing };

    const suggestedTotal = 10;
    return {
      reusedFromBank: false,
      scheme: null,
      suggestion: {
        totalMarks: suggestedTotal,
        ceilingPercent: DEFAULT_CEILING_PERCENT,
        minWordCount: DEFAULT_MIN_WORD_COUNT,
        conceptGroups: suggestConceptGroups(question.body, suggestedTotal),
      },
    };
  }

  /** Saving any change sends the scheme back to DRAFT: an approval covers exactly what was approved. */
  async save(questionId: string, dto: SaveMarkingSchemeDto, actor: string) {
    await this.theoryQuestion(questionId);
    const allocated = allocatedOf(dto.conceptGroups);
    if (!sameMarks(allocated, dto.totalMarks) && !dto.acknowledgeUnallocated) {
      throw new BadRequestException(
        `Marks allocated (${allocated}) don't sum to the question total (${dto.totalMarks}). ` +
          `Adjust the groups, or resubmit with acknowledgeUnallocated=true to save anyway.`,
      );
    }

    const before = await this.prisma.markingScheme.findUnique({ where: { questionId }, include: { conceptGroups: true } });
    if (before?.aiTask) throw new BadRequestException('the AI is still working on this scheme; wait for it to finish');

    const fields = {
      totalMarks: dto.totalMarks,
      ceilingPercent: dto.ceilingPercent ?? DEFAULT_CEILING_PERCENT,
      minWordCount: dto.minWordCount ?? DEFAULT_MIN_WORD_COUNT,
      ...(dto.modelAnswer !== undefined ? { modelAnswer: dto.modelAnswer.trim() || null } : {}),
      ...(dto.partialCreditNotes !== undefined ? { partialCreditNotes: dto.partialCreditNotes.trim() || null } : {}),
      ...(dto.zeroCreditNotes !== undefined ? { zeroCreditNotes: dto.zeroCreditNotes.trim() || null } : {}),
      ...(dto.sampleAnswers !== undefined ? { sampleAnswers: dto.sampleAnswers.filter((s) => s.text.trim()) as never } : {}),
      status: 'DRAFT' as const,
      approvedBy: null,
      approvedAt: null,
      testResults: null as never,
      testedAt: null,
    };
    const scheme = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.markingScheme.upsert({ where: { questionId }, create: { questionId, ...fields }, update: fields });
      await tx.conceptGroup.deleteMany({ where: { schemeId: upserted.id } });
      await tx.conceptGroup.createMany({
        data: dto.conceptGroups.map((g, i) => ({
          schemeId: upserted.id,
          canonicalTerm: g.canonicalTerm,
          synonyms: g.synonyms,
          marks: g.marks,
          required: g.required,
          notes: g.notes?.trim() || null,
          order: i,
        })),
      });
      return tx.markingScheme.findUniqueOrThrow({ where: { id: upserted.id }, include: withGroups });
    });

    await this.prisma.approvalLog.create({
      data: { questionId, action: 'edit', actor, beforeState: before as never, afterState: scheme as never },
    });
    return scheme;
  }

  /** Queues the AI to draft key points, variations, notes and sample answers from the model answer. */
  async draftWithAi(questionId: string, dto: { modelAnswer: string; totalMarks: number }, actor: string) {
    await this.theoryQuestion(questionId);
    this.queue.assertRoom();
    const existing = await this.prisma.markingScheme.findUnique({ where: { questionId } });
    if (existing?.aiTask) throw new BadRequestException('the AI is already working on this scheme');
    const fields = { modelAnswer: dto.modelAnswer.trim(), totalMarks: dto.totalMarks, aiTask: 'drafting', aiTaskError: null, status: 'DRAFT' as const, approvedBy: null, approvedAt: null };
    const scheme = await this.prisma.markingScheme.upsert({
      where: { questionId },
      create: { questionId, ceilingPercent: DEFAULT_CEILING_PERCENT, minWordCount: DEFAULT_MIN_WORD_COUNT, ...fields },
      update: fields,
      include: withGroups,
    });
    await this.prisma.approvalLog.create({ data: { questionId, action: 'ai-draft-requested', actor } });
    this.enqueue(scheme.id, 'scheme-draft');
    return scheme;
  }

  async runDraft(schemeId: string, model: string) {
    const scheme = await this.prisma.markingScheme.findUnique({ where: { id: schemeId }, include: { question: true } });
    if (!scheme || scheme.aiTask !== 'drafting' || !scheme.modelAnswer) return;
    try {
      const raw = await this.ollama.generate({
        model,
        prompt: draftPrompt(scheme.question.body, scheme.totalMarks, scheme.modelAnswer),
        json: true,
        think: thinkFlag(model),
        keepAlive: KEEP_ALIVE,
      });
      const draft = parseDraft(raw);
      await this.prisma.$transaction(async (tx) => {
        await tx.conceptGroup.deleteMany({ where: { schemeId } });
        await tx.conceptGroup.createMany({ data: draft.points.map((p, i) => ({ schemeId, ...p, order: i })) });
        await tx.markingScheme.update({
          where: { id: schemeId },
          data: {
            partialCreditNotes: draft.partialCreditNotes,
            zeroCreditNotes: draft.zeroCreditNotes,
            sampleAnswers: draft.samples as never,
            testResults: null as never,
            testedAt: null,
            aiTask: null,
            aiTaskError: null,
          },
        });
      });
      await this.prisma.approvalLog.create({ data: { questionId: scheme.questionId, action: 'ai-draft', actor: `AI (${model})`, afterState: draft as never } });
    } catch (err) {
      this.logger.error(`AI scheme draft failed for ${schemeId}: ${String(err)}`);
      await this.prisma.markingScheme.update({ where: { id: schemeId }, data: { aiTask: null, aiTaskError: `The AI draft failed: ${String(err).slice(0, 300)}` } });
    }
  }

  /** Queues the real marker over the sample answers, so the instructor sees how the scheme marks before approving it. */
  async testWithAi(questionId: string) {
    const scheme = await this.get(questionId);
    if (scheme.aiTask) throw new BadRequestException('the AI is already working on this scheme');
    if (!scheme.conceptGroups.length) throw new BadRequestException('add key points before testing');
    const samples = (scheme.sampleAnswers as SampleAnswer[] | null) ?? [];
    if (!samples.length) throw new BadRequestException('add at least one sample answer to test with');
    this.queue.assertRoom();
    await this.prisma.markingScheme.update({ where: { id: scheme.id }, data: { aiTask: 'testing', aiTaskError: null } });
    this.enqueue(scheme.id, 'scheme-test');
    return this.get(questionId);
  }

  async runTest(schemeId: string, model: string) {
    const scheme = await this.prisma.markingScheme.findUnique({ where: { id: schemeId }, include: { question: true, ...withGroups } });
    if (!scheme || scheme.aiTask !== 'testing') return;
    try {
      const snapshot = toSnapshot(scheme);
      const results = [];
      for (const sample of (scheme.sampleAnswers as SampleAnswer[] | null) ?? []) {
        const raw = await this.ollama.generate({ model, prompt: markingPrompt(scheme.question.body, snapshot, sample.text), json: true, think: thinkFlag(model), keepAlive: KEEP_ALIVE });
        const m = parseMarking(raw, snapshot);
        results.push({ label: sample.label, score: m.score, max: snapshot.totalMarks, points: m.points, justification: m.justification });
      }
      await this.prisma.markingScheme.update({ where: { id: schemeId }, data: { testResults: results as never, testedAt: new Date(), aiTask: null, aiTaskError: null } });
    } catch (err) {
      this.logger.error(`AI scheme test failed for ${schemeId}: ${String(err)}`);
      await this.prisma.markingScheme.update({ where: { id: schemeId }, data: { aiTask: null, aiTaskError: `The test run failed: ${String(err).slice(0, 300)}` } });
    }
  }

  /** The instructor's sign-off. Only an approved scheme can go on a published paper. */
  async approve(questionId: string, actor: string) {
    const scheme = await this.get(questionId);
    if (scheme.aiTask) throw new BadRequestException('wait for the AI to finish before approving');
    if (!scheme.conceptGroups.length) throw new BadRequestException('a scheme needs at least one key point');
    const allocated = allocatedOf(scheme.conceptGroups);
    if (!sameMarks(allocated, scheme.totalMarks)) {
      throw new BadRequestException(`the key points add up to ${allocated} but the question is worth ${scheme.totalMarks}; fix the marks before approving`);
    }
    const approved = await this.prisma.markingScheme.update({
      where: { id: scheme.id },
      data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date() },
      include: withGroups,
    });
    await this.prisma.approvalLog.create({ data: { questionId, action: 'approve-scheme', actor, afterState: approved as never } });
    return approved;
  }

  /** From script review: a good phrasing the scheme missed becomes an accepted variation for future papers. */
  async addVariation(questionId: string, dto: { canonicalTerm: string; phrase: string }, actor: string) {
    const scheme = await this.get(questionId);
    const group = scheme.conceptGroups.find((g) => g.canonicalTerm === dto.canonicalTerm);
    if (!group) throw new NotFoundException('that key point is not in this question’s scheme');
    const phrase = dto.phrase.trim();
    const known = [group.canonicalTerm, ...group.synonyms].map((t) => t.toLowerCase());
    if (!known.includes(phrase.toLowerCase())) {
      await this.prisma.conceptGroup.update({ where: { id: group.id }, data: { synonyms: [...group.synonyms, phrase] } });
      await this.prisma.approvalLog.create({ data: { questionId, action: 'add-variation', actor, afterState: { point: group.canonicalTerm, phrase } as never } });
    }
    return this.get(questionId);
  }

  // Stateless: used by the "test your scheme" box against an in-progress
  // (possibly unsaved) scheme definition — accepts the same
  // {canonicalTerm, synonyms} group shape the builder UI edits.
  testInline(
    answer: string,
    scheme: {
      totalMarks: number;
      ceilingPercent: number;
      minWordCount: number;
      conceptGroups: { canonicalTerm: string; synonyms: string[]; marks: number; required: boolean }[];
    },
  ) {
    return scoreAnswer(answer, toScorerInput(scheme));
  }

  async testSaved(questionId: string, answer: string) {
    const scheme = await this.get(questionId);
    return scoreAnswer(answer, toScorerInput(scheme));
  }
}
