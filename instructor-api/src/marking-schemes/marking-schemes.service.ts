import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SaveMarkingSchemeDto } from './dto/save-marking-scheme.dto.js';
import { scoreAnswer, type MarkingSchemeInput } from './keyword-marking.js';
import { suggestConceptGroups } from './term-extraction.js';

const DEFAULT_CEILING_PERCENT = 50;
const DEFAULT_MIN_WORD_COUNT = 15;

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

@Injectable()
export class MarkingSchemesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(questionId: string) {
    const scheme = await this.prisma.markingScheme.findUnique({
      where: { questionId },
      include: { conceptGroups: { orderBy: { order: 'asc' } } },
    });
    if (!scheme) throw new NotFoundException('no marking scheme for this question yet');
    return scheme;
  }

  async suggest(questionId: string) {
    const question = await this.prisma.questionBankItem.findUniqueOrThrow({ where: { id: questionId } });
    if (question.type !== 'THEORY') {
      throw new BadRequestException('only theory questions have a marking scheme');
    }
    // A theory question sourced from the bank may already carry a reusable
    // scheme (spec: "Reused from bank" badge). Otherwise, suggest groups
    // extracted from the model answer (`body` doubles as the model answer
    // text here) for the instructor to edit into real groups.
    const existing = await this.prisma.markingScheme.findUnique({
      where: { questionId },
      include: { conceptGroups: { orderBy: { order: 'asc' } } },
    });
    if (existing) return { reusedFromBank: existing.reusedFromBank, scheme: existing };

    const suggestedTotal = 10;
    const suggested = suggestConceptGroups(question.body, suggestedTotal);
    return {
      reusedFromBank: false,
      scheme: null,
      suggestion: {
        totalMarks: suggestedTotal,
        ceilingPercent: DEFAULT_CEILING_PERCENT,
        minWordCount: DEFAULT_MIN_WORD_COUNT,
        conceptGroups: suggested,
      },
    };
  }

  async save(questionId: string, dto: SaveMarkingSchemeDto, actor: string) {
    const question = await this.prisma.questionBankItem.findUniqueOrThrow({ where: { id: questionId } });
    if (question.type !== 'THEORY') {
      throw new BadRequestException('only theory questions have a marking scheme');
    }

    const allocated = dto.conceptGroups.reduce((sum, g) => sum + g.marks, 0);
    if (allocated !== dto.totalMarks && !dto.acknowledgeUnallocated) {
      throw new BadRequestException(
        `Marks allocated (${allocated}) don't sum to the question total (${dto.totalMarks}). ` +
          `Adjust the groups, or resubmit with acknowledgeUnallocated=true to save anyway.`,
      );
    }

    const before = await this.prisma.markingScheme.findUnique({
      where: { questionId },
      include: { conceptGroups: true },
    });

    const scheme = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.markingScheme.upsert({
        where: { questionId },
        create: {
          questionId,
          totalMarks: dto.totalMarks,
          ceilingPercent: dto.ceilingPercent ?? DEFAULT_CEILING_PERCENT,
          minWordCount: dto.minWordCount ?? DEFAULT_MIN_WORD_COUNT,
        },
        update: {
          totalMarks: dto.totalMarks,
          ceilingPercent: dto.ceilingPercent ?? DEFAULT_CEILING_PERCENT,
          minWordCount: dto.minWordCount ?? DEFAULT_MIN_WORD_COUNT,
        },
      });
      await tx.conceptGroup.deleteMany({ where: { schemeId: upserted.id } });
      await tx.conceptGroup.createMany({
        data: dto.conceptGroups.map((g, i) => ({
          schemeId: upserted.id,
          canonicalTerm: g.canonicalTerm,
          synonyms: g.synonyms,
          marks: g.marks,
          required: g.required,
          order: i,
        })),
      });
      return tx.markingScheme.findUniqueOrThrow({
        where: { id: upserted.id },
        include: { conceptGroups: { orderBy: { order: 'asc' } } },
      });
    });

    await this.prisma.approvalLog.create({
      data: {
        questionId,
        action: 'edit',
        actor,
        beforeState: before as never,
        afterState: scheme as never,
      },
    });

    return scheme;
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
    return scoreAnswer(
      answer,
      toScorerInput({
        totalMarks: scheme.totalMarks,
        ceilingPercent: scheme.ceilingPercent,
        minWordCount: scheme.minWordCount,
        conceptGroups: scheme.conceptGroups,
      }),
    );
  }
}
