import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PublishPaperDto } from './dto/publish-paper.dto.js';
import { toSnapshot, type SchemeSnapshot } from '../theory-scripts/marking.js';
import { isChoice, sectionInstructions, type PaperFormat } from '../blueprints/paper-format.js';
import type { PaperHeader } from '../documents/marking-scheme-parser.js';

/** What a published paper freezes about its layout: the template heading and its sections. */
export interface PaperLayout {
  header: PaperHeader | null;
  sections: PaperSection[];
}

/** Reads PaperVersion.layout. */
export const layoutOf = (json: unknown): PaperLayout | null => (json ? (json as PaperLayout) : null);

/** A published paper's sections, as printed and as results count them. */
export interface PaperSection {
  letter: string;
  title: string | null;
  instructions: string;
  questions: number;
  choose?: number; // candidates answer this many; the best answers count
  marksEach?: number;
}

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
    // A paper set to a past paper's layout keeps its sections: questions are
    // printed section by section, and a "answer 3 of 4" choice is frozen with it.
    const blueprint = await this.prisma.blueprint.findFirst({ where: { sessionId: dto.sessionId, format: { not: Prisma.DbNull } }, orderBy: { createdAt: 'desc' } });
    const format = (blueprint?.format as unknown as PaperFormat | null) ?? null;
    let layout: PaperLayout | null = null;
    if (format) {
      const order = new Map(format.sections.map((sec, i) => [sec.letter, i]));
      approved.sort((a, b) => (order.get(a.section ?? '') ?? 99) - (order.get(b.section ?? '') ?? 99) || a.createdAt.getTime() - b.createdAt.getTime());
      const sections = format.sections.map((sec): PaperSection => {
        const questions = approved.filter((q) => q.section === sec.letter).length;
        return isChoice(sec)
          ? { letter: sec.letter, title: sec.title, instructions: sectionInstructions({ ...sec, count: questions }), questions, choose: sec.choose, marksEach: sec.marksEach }
          : { letter: sec.letter, title: sec.title, instructions: sectionInstructions(sec), questions };
      });
      layout = { header: format.header ?? null, sections };
      const thin = sections.find((sec) => sec.choose && sec.questions < sec.choose);
      if (thin) throw new BadRequestException(`Section ${thin.letter} has ${thin.questions} approved question(s), but candidates must answer ${thin.choose}.`);
      const stray = approved.filter((q) => !order.has(q.section ?? ''));
      if (stray.length) throw new BadRequestException(`${stray.length} approved question(s) don’t belong to any section of this paper’s layout. Reject them or set the exam without the layout.`);
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
        .update(approved.map((q) => `${q.id}:${q.body}:${JSON.stringify(snapshots.get(q.id) ?? null)}`).join('|') + (layout ? `|layout:${JSON.stringify(layout)}` : ''))
        .digest('hex');

      const version = await tx.paperVersion.create({
        data: {
          paperId: paper.id,
          versionNumber,
          examDate: new Date(dto.examDate),
          publishedBy: dto.publishedBy,
          signatureHash,
          layout: (layout ?? undefined) as never,
          items: {
            create: approved.map((q, i) => ({ questionId: q.id, position: i, section: layout ? q.section : null, markingSnapshot: (snapshots.get(q.id) ?? undefined) as never })),
          },
        },
        include: { items: { include: { question: true }, orderBy: { position: 'asc' } } },
      });

      return { paper, version };
    });
  }

  /**
   * A published version laid out for printing, in the template of the past
   * paper it follows: the same heading, sections and instructions. Questions
   * and marking schemes come from the frozen version, so the printed paper
   * and the instructors' scheme match what scripts are marked against.
   */
  async printData(paperVersionId: string) {
    const version = await this.prisma.paperVersion.findUnique({
      where: { id: paperVersionId },
      include: {
        paper: { include: { session: { include: { course: true } } } },
        items: { include: { question: { include: { markingScheme: { include: { conceptGroups: { orderBy: { order: 'asc' } } } } } } }, orderBy: { position: 'asc' } },
      },
    });
    if (!version) throw new NotFoundException('paper version not found');
    const layout = layoutOf(version.layout);
    const { course, label } = version.paper.session;

    const items = version.items.map((i, n) => {
      const q = i.question;
      const scheme = (i.markingSnapshot as unknown as SchemeSnapshot | null) ?? (q.markingScheme ? toSnapshot(q.markingScheme) : null);
      return {
        number: n + 1,
        section: i.section,
        type: q.type,
        body: q.body,
        options: (q.options as string[] | null) ?? null,
        correctIndex: q.correctIndex,
        marks: q.type === 'OBJECTIVE' ? 1 : (scheme?.totalMarks ?? 0),
        modelAnswer: scheme?.modelAnswer ?? null,
        markingNotes: scheme?.partialCreditNotes ?? null,
        points: (scheme?.conceptGroups ?? []).map((g) => ({ term: g.canonicalTerm, synonyms: g.synonyms ?? [], marks: g.marks, notes: g.notes ?? null })),
      };
    });

    // Sections as on the past paper; a paper without a layout prints as one list.
    const sections = layout?.sections.length
      ? layout.sections.map((s) => ({ ...s, items: items.filter((i) => i.section === s.letter) }))
      : [{ letter: null, title: null, instructions: null, questions: items.length, items }];
    const total = sections.reduce((sum, s) => {
      const marks = s.items.map((i) => i.marks);
      if ('choose' in s && s.choose) return sum + marks.sort((a, b) => b - a).slice(0, s.choose).reduce((a, b) => a + b, 0);
      return sum + marks.reduce((a, b) => a + b, 0);
    }, 0);
    // "Answer Section A and 3 Questions from Section B."
    const compulsory = sections.filter((s) => s.letter && !('choose' in s && s.choose)).map((s) => `Section ${s.letter}`);
    const choices = sections.filter((s) => 'choose' in s && s.choose).map((s) => `${(s as PaperSection).choose} Questions from Section ${s.letter}`);
    const parts = [...compulsory, ...choices];
    const instruction = parts.length ? `Answer ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.` : null;

    const h = layout?.header;
    const hours = version.paper.durationMinutes / 60;
    return {
      versionId: version.id,
      versionNumber: version.versionNumber,
      examDate: version.examDate,
      signature: version.signatureHash.slice(0, 12),
      header: {
        classification: h?.classification ?? 'RESTRICTED',
        institution: h?.institution ?? 'NIGERIAN ARMY COLLEGE OF LOGISTICS AND MANAGEMENT',
        department: h?.department ?? null,
        paperTitle: h?.paperTitle ?? version.paper.title,
        course: h?.course ?? `${course.code} ${label}`.trim(),
        // The past paper's time unless it has none; the print page lets the instructor change it.
        time: h?.time ?? (Number.isInteger(hours) ? `${hours}hr${hours === 1 ? '' : 's'}` : `${version.paper.durationMinutes} minutes`),
        totalMarks: h?.totalMarks?.includes('%') ? `${total}%` : String(total),
        totalLabel: h?.totalLabel ?? 'Total Marks',
        subject: h?.subject ?? null,
        // "Answer Section A and 3 Questions from Section B." from the sections, else the paper's own ("Attempt all questions").
        instruction: instruction ?? h?.instruction ?? null,
      },
      total,
      sections,
    };
  }

  async listVersions(sessionId: string) {
    return this.prisma.paper.findMany({
      where: { sessionId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, include: { items: true } } },
    });
  }
}
