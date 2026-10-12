import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SchemeSnapshot } from '../theory-scripts/marking.js';
import { readEnvelope, verifyResults } from './results-file.js';
import { itemAnalysis } from './item-analysis.js';
import { layoutOf } from '../papers/papers.service.js';

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Verifies a venue results file against its package's key and records each candidate's objective result once. */
  async importFile(text: string, actor: string) {
    const { examId } = readEnvelope(text);
    const pkg = await this.prisma.examPackage.findUnique({ where: { paperVersionId: examId } });
    if (!pkg) throw new NotFoundException('No package was built in this portal for the paper in this results file.');
    if (!pkg.resultsKeyHex) throw new BadRequestException('That paper’s package was built before signed results existed, so its results can’t be verified. Rebuild the package for the next sitting.');
    let payload;
    try {
      payload = verifyResults(text, pkg.resultsKeyHex);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const version = await this.prisma.paperVersion.findUniqueOrThrow({ where: { id: examId }, include: { paper: true } });
    const candidates = await this.prisma.candidate.findMany({ where: { sessionId: version.paper.sessionId } });
    const byNumber = new Map(candidates.map((c) => [c.armyNumber.trim().toUpperCase(), c]));
    const sourceSha256 = createHash('sha256').update(text).digest('hex');

    const summary = { centre: payload.centre, imported: 0, unchanged: 0, conflicts: [] as string[], unmatched: [] as string[], notSubmitted: payload.not_submitted ?? [] };
    for (const r of payload.candidates) {
      const existing = await this.prisma.venueResult.findUnique({ where: { paperVersionId_serviceNumber: { paperVersionId: examId, serviceNumber: r.service_number } } });
      if (existing) {
        // A candidate's submitted answers never change, so a different hash means two conflicting files.
        if (existing.responseHash === r.response_hash) summary.unchanged++;
        else summary.conflicts.push(r.service_number);
        continue;
      }
      const candidate = byNumber.get(r.service_number.trim().toUpperCase());
      if (!candidate) summary.unmatched.push(r.service_number);
      await this.prisma.venueResult.create({
        data: {
          paperVersionId: examId,
          serviceNumber: r.service_number,
          candidateId: candidate?.id,
          submittedAt: new Date(r.submitted_at),
          reference: r.reference,
          responseHash: r.response_hash,
          objectiveCorrect: r.objective_correct,
          objectiveTotal: r.objective_total,
          items: r.items.map((i) => ({ questionId: i.question_id, type: i.type, correct: i.correct, answered: i.answered })) as never,
          centre: payload.centre,
          importedBy: actor,
          sourceSha256,
        },
      });
      summary.imported++;
    }
    return summary;
  }

  /** Objective (from the venue) plus confirmed theory marks, per candidate, with item analysis. */
  async summary(paperVersionId: string) {
    const version = await this.prisma.paperVersion.findUnique({
      where: { id: paperVersionId },
      include: { paper: true, items: { include: { question: { include: { markingScheme: true } } }, orderBy: { position: 'asc' } } },
    });
    if (!version) throw new NotFoundException('paper version not found');

    const theoryItems = version.items.filter((i) => i.question.type === 'THEORY');
    const objectiveCount = version.items.length - theoryItems.length;
    const maxOf = (i: (typeof theoryItems)[number]) => (i.markingSnapshot as unknown as SchemeSnapshot | null)?.totalMarks ?? i.question.markingScheme?.totalMarks ?? 0;
    // "Answer 3 of the 4 in Section B": only a candidate's best answers in that section count.
    const choices = (layoutOf(version.layout)?.sections ?? []).filter((sec) => sec.choose).map((sec) => {
      const items = theoryItems.filter((i) => i.section === sec.letter);
      const choose = Math.min(sec.choose!, items.length);
      return { ...sec, choose, ids: new Set(items.map((i) => i.questionId)), max: items.map(maxOf).sort((a, b) => b - a).slice(0, choose).reduce((a, b) => a + b, 0) };
    });
    const inChoice = (questionId: string) => choices.some((c) => c.ids.has(questionId));
    const compulsory = theoryItems.filter((i) => !inChoice(i.questionId));
    const theoryMax = compulsory.reduce((sum, i) => sum + maxOf(i), 0) + choices.reduce((sum, c) => sum + c.max, 0);
    const theoryExpected = compulsory.length + choices.reduce((sum, c) => sum + c.choose, 0);

    const [candidates, venue, scripts] = await Promise.all([
      this.prisma.candidate.findMany({ where: { sessionId: version.paper.sessionId }, orderBy: { armyNumber: 'asc' } }),
      this.prisma.venueResult.findMany({ where: { paperVersionId } }),
      this.prisma.theoryScriptAnswer.findMany({ where: { paperVersionId } }),
    ]);

    const rows = candidates
      .filter((c) => c.active || venue.some((v) => v.candidateId === c.id))
      .map((c) => {
        const v = venue.find((x) => x.candidateId === c.id);
        const mine = scripts.filter((s) => s.candidateId === c.id);
        const marked = mine.filter((s) => s.status === 'REVIEWED' || s.status === 'PUBLISHED');
        const score = (s: (typeof marked)[number]) => s.instructorScore ?? 0;
        const compulsoryMarked = marked.filter((s) => !inChoice(s.questionId));
        const best = choices.map((c) => marked.filter((s) => c.ids.has(s.questionId)).map(score).sort((a, b) => b - a));
        const theoryScore =
          compulsoryMarked.reduce((sum, s) => sum + score(s), 0) + best.reduce((sum, scores, k) => sum + scores.slice(0, choices[k].choose).reduce((a, b) => a + b, 0), 0);
        const objectiveTotal = v?.objectiveTotal ?? objectiveCount;
        const max = objectiveTotal + theoryMax;
        const total = (v?.objectiveCorrect ?? 0) + theoryScore;
        // Complete once every compulsory answer is marked, enough answers in each
        // choice section are marked, and nothing uploaded is still waiting.
        const complete =
          !!v && compulsoryMarked.length === compulsory.length && best.every((scores, k) => scores.length >= choices[k].choose) && marked.length === mine.length;
        return {
          candidateId: c.id,
          armyNumber: c.armyNumber,
          rank: c.rank,
          fullName: c.fullName,
          objective: v ? { correct: v.objectiveCorrect, total: v.objectiveTotal, submittedAt: v.submittedAt, reference: v.reference, centre: v.centre } : null,
          theory: { score: theoryScore, max: theoryMax, marked: marked.length, expected: theoryExpected, published: mine.filter((s) => s.status === 'PUBLISHED').length },
          total,
          max,
          percent: max ? Math.round((total / max) * 1000) / 10 : null,
          complete,
          passed: complete && max ? (total / max) * 100 >= version.paper.passMark : null,
        };
      });

    const questions = new Map(version.items.map((i) => [i.questionId, { position: i.position + 1, topic: i.question.topic, body: i.question.body }]));
    const items = itemAnalysis(venue.map((v) => ({ objectiveCorrect: v.objectiveCorrect, items: v.items as { questionId: string; type: string; correct: boolean }[] }))).map((s) => ({
      ...s,
      question: questions.get(s.questionId) ?? null,
    }));
    items.sort((a, b) => (a.question?.position ?? 999) - (b.question?.position ?? 999));

    return {
      paperTitle: version.paper.title,
      versionNumber: version.versionNumber,
      passMark: version.paper.passMark,
      theoryOnPaper: version.paper.theoryOnPaper,
      objectiveCount,
      theoryCount: theoryItems.length,
      theoryMax,
      sections: layoutOf(version.layout)?.sections ?? null,
      imported: venue.length,
      unmatched: venue.filter((v) => !v.candidateId).map((v) => v.serviceNumber),
      rows,
      itemAnalysis: items,
    };
  }
}
