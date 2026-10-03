import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';
import { OllamaService } from '../ollama/ollama.service.js';
import type { MarkEventKind, ScriptAnswerStatus } from '../generated/prisma/enums.js';
import type { AiJob } from '../ai-queue/ai-queue.js';
import { AiQueueService } from '../ai-queue/ai-queue.service.js';
import { DEEP_MARKING_MODEL, isReasoningModel, KEEP_ALIVE, MARKING_MODEL, OCR_MODEL, thinkFlag } from '../ai-queue/models.js';
import { encodeSheetCode, MAX_SHEET_PAGES, readSheetCode, type SheetCode } from './answer-sheet-code.js';
import { MARKER_INSTRUCTION, markingPrompt, OCR_PROMPT, parseMarking, toSnapshot, type SchemeSnapshot } from './marking.js';

const STORAGE_ROOT = process.env.SCRIPT_STORAGE_ROOT ?? './data/theory-scripts';

// The vision model resamples anything larger to about the same token count,
// so 1000px reads as well as 1400px in half the time.
const OCR_MAX_PX = Number(process.env.OCR_MAX_PX ?? 1000);

const PIPELINE_RESET = {
  status: 'UPLOADED' as ScriptAnswerStatus,
  transcribedText: null,
  ocrModel: null,
  ocrError: null,
  aiScore: null,
  aiMaxScore: null,
  aiJustification: null,
  aiModel: null,
  aiError: null,
  aiBreakdown: null as never,
  instructorScore: null,
  instructorNotes: null,
  reviewedBy: null,
  reviewedAt: null,
};

const SCAN_FILE = /\.(jpe?g|png)$/i;

// Bulk-filed pages are stored as ..._p<n>.jpg so merged chunks can be put back in order.
const pageNumberOf = (path: string) => Number(/_p(\d+)\.jpg$/.exec(path)?.[1] ?? 1);

export interface BulkResult {
  queued: { candidate: string; question: string; pages: number }[];
  unassigned: { file: string; reason: string }[];
}

@Injectable()
export class TheoryScriptsService implements OnModuleInit {
  private readonly logger = new Logger(TheoryScriptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollama: OllamaService,
    private readonly queue: AiQueueService,
  ) {
    this.queue.register('ocr', (id) => this.runOcr(id));
    this.queue.register('mark', (id, model) => this.runMarking(id, model));
  }

  /** The queue lives in memory, so a restart would strand scripts mid-pipeline; pick them back up. */
  async onModuleInit() {
    const stranded = await this.prisma.theoryScriptAnswer.findMany({
      where: { status: 'UPLOADED' },
      select: { id: true, transcribedText: true },
      orderBy: { uploadedAt: 'asc' },
    });
    for (const s of stranded) {
      this.queue.add(s.transcribedText ? this.markJob(s.id) : this.ocrJob(s.id));
    }
    if (stranded.length) this.logger.log(`resumed ${stranded.length} theory script(s) left in the AI pipeline`);
  }

  private ocrJob = (id: string): AiJob => ({ id, stage: 'ocr', model: OCR_MODEL });
  private markJob = (id: string, deep = false): AiJob => ({ id, stage: 'mark', model: deep ? DEEP_MARKING_MODEL : MARKING_MODEL });

  private assertQueueHasRoom(jobs = 1) {
    this.queue.assertRoom(jobs);
  }

  queueStatus() {
    return { ...this.queue.status(), ocrModel: OCR_MODEL, markingModel: MARKING_MODEL, deepMarkingModel: DEEP_MARKING_MODEL };
  }

  private event(answerId: string, kind: MarkEventKind, data: { score?: number | null; previousScore?: number | null; model?: string; actor: string; reason?: string | null }) {
    return this.prisma.theoryMarkEvent.create({ data: { answerId, kind, ...data } });
  }

  events(answerId: string) {
    return this.prisma.theoryMarkEvent.findMany({ where: { answerId }, orderBy: { createdAt: 'asc' } });
  }

  /** The scheme this answer is marked against: the snapshot frozen at publish, or the bank's current one for older papers. */
  async schemeFor(paperVersionId: string, questionId: string): Promise<SchemeSnapshot | null> {
    const item = await this.prisma.paperItem.findFirst({ where: { paperVersionId, questionId } });
    if (item?.markingSnapshot) return item.markingSnapshot as unknown as SchemeSnapshot;
    const live = await this.prisma.markingScheme.findUnique({ where: { questionId }, include: { conceptGroups: { orderBy: { order: 'asc' } } } });
    return live ? toSnapshot(live) : null;
  }

  private async paperContext(paperVersionId: string) {
    const version = await this.prisma.paperVersion.findUnique({
      where: { id: paperVersionId },
      include: { paper: true, items: { include: { question: true }, orderBy: { position: 'asc' } } },
    });
    if (!version) throw new NotFoundException('paper version not found');
    const theory = version.items.filter((i) => i.question.type === 'THEORY');
    return { version, theory };
  }

  private async checkTarget(paperVersionId: string, candidateId: string, questionId: string) {
    const { version } = await this.paperContext(paperVersionId);
    const item = version.items.find((i) => i.questionId === questionId);
    if (!item) throw new BadRequestException('that question is not on this paper version');
    if (item.question.type !== 'THEORY') throw new BadRequestException('only theory questions take a script answer');
    const candidate = await this.prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate || candidate.sessionId !== version.paper.sessionId) throw new NotFoundException('candidate not found for this session');
  }

  private async storeScan(paperVersionId: string, folder: string, tag: string, ext: string, data: Buffer) {
    const dir = resolve(STORAGE_ROOT, paperVersionId, folder);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}_${tag}${ext}`);
    await writeFile(path, data);
    return path;
  }

  /**
   * Creates or replaces the answer for one candidate and question, then queues
   * it for reading. Within one bulk upload (same batchId) later pages are
   * merged in page order instead of replacing the earlier ones.
   */
  private async putAnswer(p: {
    paperVersionId: string;
    candidateId: string;
    questionId: string;
    pages: string[];
    uploadedBy: string;
    batchId?: string;
  }) {
    const key = { paperVersionId: p.paperVersionId, candidateId: p.candidateId, questionId: p.questionId };
    const existing = await this.prisma.theoryScriptAnswer.findUnique({ where: { paperVersionId_candidateId_questionId: key } });
    if (existing?.status === 'PUBLISHED') throw new BadRequestException('this result has already been published and can no longer be replaced');
    let pages = p.pages;
    if (p.batchId && existing?.uploadBatchId === p.batchId) {
      const byNumber = new Map<number, string>();
      for (const path of [...this.pagePaths(existing), ...p.pages]) byNumber.set(pageNumberOf(path), path);
      pages = [...byNumber.entries()].sort(([a], [b]) => a - b).map(([, path]) => path);
    }
    const [imagePath, ...extraImagePaths] = pages;
    // Re-uploading (e.g. a bad scan) resets the whole pipeline rather than
    // leaving a stale AI score sitting next to a new image.
    const fields = { imagePath, extraImagePaths, uploadedBy: p.uploadedBy, uploadBatchId: p.batchId ?? null };
    const answer = await this.prisma.theoryScriptAnswer.upsert({
      where: { paperVersionId_candidateId_questionId: key },
      update: { ...PIPELINE_RESET, ...fields, uploadedAt: new Date() },
      create: { ...key, ...fields },
    });
    // OCR + marking take minutes on CPU, longer than the web proxy waits, so
    // the request returns now (status UPLOADED = "in the pipeline") and the
    // review screen polls. A failure at either step lands in *_FAILED with the
    // error attached, never a silent score.
    this.queue.add(this.ocrJob(answer.id));
    return answer;
  }

  async upload(params: { paperVersionId: string; candidateId: string; questionId: string; uploadedBy: string; file: Express.Multer.File }) {
    this.assertQueueHasRoom();
    await this.checkTarget(params.paperVersionId, params.candidateId, params.questionId);
    const ext = extname(params.file.originalname).toLowerCase() || '.jpg';
    const path = await this.storeScan(params.paperVersionId, params.candidateId, params.questionId, ext, params.file.buffer);
    const answer = await this.putAnswer({ ...params, pages: [path] });
    return this.get(answer.id);
  }

  /**
   * Files a stack of scanned answer-sheet pages by the QR code printed on each
   * one. Pages of the same answer are kept together in page order. Anything
   * that can't be filed safely goes to the unassigned list for a person.
   */
  async bulkUpload(params: { paperVersionId: string; uploadedBy: string; files: Express.Multer.File[]; batchId?: string }): Promise<BulkResult> {
    const { version, theory } = await this.paperContext(params.paperVersionId);
    const theoryIds = new Set(theory.map((t) => t.questionId));
    const candidates = new Map(
      (await this.prisma.candidate.findMany({ where: { sessionId: version.paper.sessionId, active: true } })).map((c) => [c.id, c]),
    );

    const unassigned: { name: string; data: Buffer; reason: string }[] = [];
    const groups = new Map<string, { code: SheetCode; pages: Map<number, Buffer> }>();
    for (const file of params.files) {
      if (!SCAN_FILE.test(file.originalname)) {
        unassigned.push({ name: file.originalname, data: file.buffer, reason: 'Not a JPEG or PNG image' });
        continue;
      }
      const read = await readSheetCode(file.buffer).catch(() => null);
      const reason = !read
        ? 'No answer-sheet code could be read on this page'
        : read.code.paperVersionId !== params.paperVersionId
          ? 'This page belongs to a different paper or version'
          : !theoryIds.has(read.code.questionId)
            ? 'The question on this page is not a theory question on this paper'
            : !candidates.has(read.code.candidateId)
              ? 'The candidate on this page is not an active candidate in this session'
              : null;
      if (!read || reason) {
        unassigned.push({ name: file.originalname, data: read?.upright ?? file.buffer, reason: reason ?? 'Unreadable' });
        continue;
      }
      const key = `${read.code.candidateId}|${read.code.questionId}`;
      const group = groups.get(key) ?? { code: read.code, pages: new Map<number, Buffer>() };
      if (group.pages.has(read.code.page)) {
        unassigned.push({ name: file.originalname, data: read.upright, reason: `A second copy of page ${read.code.page} for the same candidate and question` });
        continue;
      }
      group.pages.set(read.code.page, read.upright);
      groups.set(key, group);
    }

    this.assertQueueHasRoom(groups.size);
    const published = new Set(
      (
        await this.prisma.theoryScriptAnswer.findMany({
          where: { paperVersionId: params.paperVersionId, status: 'PUBLISHED' },
          select: { candidateId: true, questionId: true },
        })
      ).map((a) => `${a.candidateId}|${a.questionId}`),
    );

    const result: BulkResult = { queued: [], unassigned: [] };
    for (const [key, group] of groups) {
      const { candidateId, questionId } = group.code;
      const pages = [...group.pages.entries()].sort(([a], [b]) => a - b);
      if (published.has(key)) {
        for (const [n, data] of pages) {
          unassigned.push({ name: `page ${n}`, data, reason: 'This result is already published, so the scan was not filed' });
        }
        continue;
      }
      const paths: string[] = [];
      for (const [n, data] of pages) paths.push(await this.storeScan(params.paperVersionId, candidateId, `${questionId}_p${n}`, '.jpg', data));
      await this.putAnswer({ paperVersionId: params.paperVersionId, candidateId, questionId, pages: paths, uploadedBy: params.uploadedBy, batchId: params.batchId });
      const c = candidates.get(candidateId)!;
      const q = theory.find((t) => t.questionId === questionId)!;
      result.queued.push({ candidate: `${c.rank} ${c.fullName} (${c.armyNumber})`, question: `Q${q.position + 1}: ${q.question.topic}`, pages: pages.length });
    }

    for (const u of unassigned) {
      const ext = extname(u.name).toLowerCase();
      const path = await this.storeScan(params.paperVersionId, 'unassigned', 'scan', SCAN_FILE.test(ext) ? ext : '.jpg', u.data);
      await this.prisma.unassignedScan.create({
        data: { paperVersionId: params.paperVersionId, imagePath: path, originalName: u.name, reason: u.reason, uploadedBy: params.uploadedBy },
      });
      result.unassigned.push({ file: u.name, reason: u.reason });
    }
    return result;
  }

  listUnassigned(paperVersionId: string) {
    return this.prisma.unassignedScan.findMany({ where: { paperVersionId }, orderBy: { uploadedAt: 'asc' } });
  }

  async getUnassigned(id: string) {
    const scan = await this.prisma.unassignedScan.findUnique({ where: { id } });
    if (!scan) throw new NotFoundException('scan not found');
    return scan;
  }

  /** Files an unassigned page: as a new answer (replacing any earlier one), or as the next page of an existing answer. */
  async assignScan(id: string, dto: { candidateId: string; questionId: string; append?: boolean }, actor: string) {
    this.assertQueueHasRoom();
    const scan = await this.getUnassigned(id);
    await this.checkTarget(scan.paperVersionId, dto.candidateId, dto.questionId);
    const key = { paperVersionId: scan.paperVersionId, candidateId: dto.candidateId, questionId: dto.questionId };
    const existing = await this.prisma.theoryScriptAnswer.findUnique({ where: { paperVersionId_candidateId_questionId: key } });
    let answerId: string;
    if (dto.append && existing) {
      if (existing.status === 'PUBLISHED') throw new BadRequestException('this result has already been published and can no longer be changed');
      if (existing.extraImagePaths.length + 1 >= MAX_SHEET_PAGES) throw new BadRequestException(`an answer can have at most ${MAX_SHEET_PAGES} pages`);
      await this.prisma.theoryScriptAnswer.update({
        where: { id: existing.id },
        data: { ...PIPELINE_RESET, extraImagePaths: [...existing.extraImagePaths, scan.imagePath], uploadedBy: actor, uploadedAt: new Date() },
      });
      this.queue.add(this.ocrJob(existing.id));
      answerId = existing.id;
    } else {
      answerId = (await this.putAnswer({ ...key, pages: [scan.imagePath], uploadedBy: actor })).id;
    }
    await this.prisma.unassignedScan.delete({ where: { id } });
    return this.get(answerId);
  }

  async discardUnassigned(id: string) {
    const scan = await this.getUnassigned(id);
    await this.prisma.unassignedScan.delete({ where: { id } });
    await unlink(scan.imagePath).catch(() => undefined);
    return { discarded: true };
  }

  /** Everything needed to print QR-coded answer sheets for every candidate and theory question. */
  async answerSheets(paperVersionId: string, pagesPerQuestion: number) {
    const pages = Math.min(MAX_SHEET_PAGES, Math.max(1, Math.floor(pagesPerQuestion) || 2));
    const { version, theory } = await this.paperContext(paperVersionId);
    const candidates = await this.prisma.candidate.findMany({
      where: { sessionId: version.paper.sessionId, active: true },
      orderBy: { armyNumber: 'asc' },
    });
    const schemes = await this.prisma.markingScheme.findMany({ where: { questionId: { in: theory.map((t) => t.questionId) } } });
    const marks = new Map(schemes.map((s) => [s.questionId, s.totalMarks]));
    return {
      paperTitle: version.paper.title,
      versionNumber: version.versionNumber,
      examDate: version.examDate,
      pagesPerQuestion: pages,
      questions: theory.map((t) => ({ id: t.questionId, number: t.position + 1, topic: t.question.topic, body: t.question.body, marks: marks.get(t.questionId) ?? null })),
      candidates: candidates.map((c) => ({
        id: c.id,
        armyNumber: c.armyNumber,
        rank: c.rank,
        fullName: c.fullName,
        codes: Object.fromEntries(
          theory.map((t) => [
            t.questionId,
            Array.from({ length: pages }, (_, i) => encodeSheetCode({ paperVersionId, candidateId: c.id, questionId: t.questionId, page: i + 1 })),
          ]),
        ),
      })),
    };
  }

  /** How close the AI's proposals have been to the marks instructors confirmed, per marking model. */
  async agreement(paperVersionId?: string) {
    const rows = await this.prisma.theoryScriptAnswer.findMany({
      where: {
        status: { in: ['REVIEWED', 'PUBLISHED'] },
        aiScore: { not: null },
        instructorScore: { not: null },
        ...(paperVersionId ? { paperVersionId } : {}),
      },
      select: { aiModel: true, aiScore: true, instructorScore: true },
    });
    const byModel = new Map<string, number[]>();
    for (const r of rows) {
      const model = r.aiModel ?? 'unknown';
      const diffs = byModel.get(model) ?? [];
      diffs.push(Math.abs((r.aiScore ?? 0) - (r.instructorScore ?? 0)));
      byModel.set(model, diffs);
    }
    return [...byModel.entries()].map(([model, diffs]) => ({
      model,
      scripts: diffs.length,
      averageDifference: Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10,
      withinOneMarkPercent: Math.round((diffs.filter((d) => d <= 1).length / diffs.length) * 100),
    }));
  }

  /** Re-run from OCR or from marking in the background. `deep` marks with the slower reasoning model. */
  async restart(id: string, from: 'ocr' | 'mark', deep = false) {
    this.assertQueueHasRoom();
    const answer = await this.get(id);
    if (answer.status === 'PUBLISHED') throw new BadRequestException('this result has already been published and can no longer be re-run');
    if (from === 'mark' && !answer.transcribedText) throw new BadRequestException('no transcription yet — run OCR first');
    await this.prisma.theoryScriptAnswer.update({
      where: { id },
      data: {
        status: 'UPLOADED',
        ocrError: null,
        aiError: null,
        instructorScore: null,
        instructorNotes: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });
    this.queue.add(from === 'ocr' ? this.ocrJob(id) : this.markJob(id, deep));
    return this.get(id);
  }

  pagePaths(answer: { imagePath: string; extraImagePaths: string[] }) {
    return [answer.imagePath, ...answer.extraImagePaths];
  }

  async runOcr(id: string) {
    const answer = await this.prisma.theoryScriptAnswer.findUniqueOrThrow({ where: { id } });
    if (answer.status === 'PUBLISHED') return;
    const pages = this.pagePaths(answer);
    try {
      const texts: string[] = [];
      for (const path of pages) {
        // A raw phone photo (~2000x2600) takes over 5 minutes just to ingest on
        // CPU; downscaled it reads just as well. rotate() applies EXIF orientation.
        const buffer = await sharp(await readFile(path))
          .rotate()
          .resize({ width: OCR_MAX_PX, height: OCR_MAX_PX, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();
        const text = (
          await this.ollama.generate({ model: OCR_MODEL, prompt: OCR_PROMPT, images: [buffer.toString('base64')], keepAlive: KEEP_ALIVE })
        ).trim();
        // Candidates hand in unused continuation pages too; a blank page adds nothing.
        if (text) texts.push(text);
      }
      const saved = await this.prisma.theoryScriptAnswer.updateMany({
        where: { id, uploadedAt: answer.uploadedAt },
        data: { transcribedText: texts.join('\n\n'), ocrModel: OCR_MODEL, ocrError: null },
      });
      // A new scan replaced this one while it was being read; its own job will run.
      if (!saved.count) return;
    } catch (err) {
      this.logger.error(`OCR failed for ${id}: ${String(err)}`);
      await this.prisma.theoryScriptAnswer.updateMany({
        where: { id, uploadedAt: answer.uploadedAt },
        data: { status: 'OCR_FAILED' as ScriptAnswerStatus, ocrError: String(err) },
      });
      return;
    }
    // Marking runs later as part of the marking batch, not straight away.
    this.queue.add(this.markJob(id));
  }

  async runMarking(id: string, model = MARKING_MODEL) {
    const answer = await this.prisma.theoryScriptAnswer.findUniqueOrThrow({ where: { id }, include: { question: true } });
    if (answer.status === 'PUBLISHED' || !answer.transcribedText) return;

    const scheme = (await this.schemeFor(answer.paperVersionId, answer.questionId)) ?? {
      totalMarks: 10,
      ceilingPercent: 50,
      minWordCount: 15,
      conceptGroups: [],
    };
    try {
      // Ollama's format:'json' constrains decoding, which fights reasoning
      // models that need to think first; for those, extract the JSON instead.
      const raw = await this.ollama.generate({
        model,
        prompt: markingPrompt(answer.question.body, scheme, answer.transcribedText),
        json: !isReasoningModel(model),
        think: thinkFlag(model),
        keepAlive: KEEP_ALIVE,
      });
      const marking = parseMarking(raw, scheme);
      let justification = marking.justification;
      if (MARKER_INSTRUCTION.test(answer.transcribedText)) {
        justification = `WARNING: this answer contains text that appears to instruct the marker (for example to ignore the rules or award a score). It was not followed. Check the scan carefully. ${justification}`;
      }

      // Only if the scan and transcript are still the ones that were marked.
      const saved = await this.prisma.theoryScriptAnswer.updateMany({
        where: { id, uploadedAt: answer.uploadedAt, transcribedText: answer.transcribedText },
        data: {
          aiScore: marking.score,
          aiMaxScore: scheme.totalMarks,
          aiJustification: justification,
          aiBreakdown: marking.points.length ? (marking.points as never) : undefined,
          aiModel: model,
          aiError: null,
          // A fresh AI mark invalidates any earlier human review of the old one.
          instructorScore: null,
          instructorNotes: null,
          reviewedBy: null,
          reviewedAt: null,
          status: 'PENDING_REVIEW',
        },
      });
      if (saved.count) await this.event(id, 'AI_PROPOSED', { score: marking.score, model, actor: `AI (${model})` });
    } catch (err) {
      this.logger.error(`AI marking failed for ${id}: ${String(err)}`);
      await this.prisma.theoryScriptAnswer.updateMany({
        where: { id, uploadedAt: answer.uploadedAt },
        data: { status: 'AI_MARKING_FAILED' as ScriptAnswerStatus, aiError: String(err) },
      });
    }
  }

  async review(id: string, dto: { score: number; notes?: string }, reviewedBy: string) {
    const answer = await this.prisma.theoryScriptAnswer.findUniqueOrThrow({
      where: { id },
      include: { question: { include: { markingScheme: true } } },
    });
    if (answer.status === 'PUBLISHED') throw new BadRequestException('this result has already been published and can no longer be changed here');
    if (answer.status === 'UPLOADED') throw new BadRequestException('this script is still being read and marked — wait for it to finish');

    const totalMarks = answer.aiMaxScore ?? answer.question.markingScheme?.totalMarks;
    if (totalMarks != null && dto.score > totalMarks) {
      throw new BadRequestException(`score cannot exceed ${totalMarks} marks`);
    }

    const notes = dto.notes?.trim() || null;
    const differs = answer.aiScore != null && dto.score !== answer.aiScore;
    if (differs && !notes) {
      throw new BadRequestException('Say why your mark differs from the AI’s proposal. The reason is kept with the result.');
    }
    const updated = await this.prisma.theoryScriptAnswer.update({
      where: { id },
      data: {
        instructorScore: dto.score,
        instructorNotes: notes,
        reviewedBy,
        reviewedAt: new Date(),
        status: 'REVIEWED',
      },
    });
    await this.event(id, differs ? 'CHANGED' : 'CONFIRMED', {
      score: dto.score,
      previousScore: answer.instructorScore ?? answer.aiScore,
      actor: reviewedBy,
      reason: notes,
    });
    return updated;
  }

  /** A published mark can only be corrected as a new, reasoned event; the original stays in the record. */
  async correct(id: string, dto: { score: number; reason: string }, actor: string) {
    const answer = await this.prisma.theoryScriptAnswer.findUniqueOrThrow({ where: { id } });
    if (answer.status !== 'PUBLISHED') throw new BadRequestException('only published marks are corrected this way; change an unpublished mark in review');
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 5) throw new BadRequestException('give the reason for the correction');
    if (answer.aiMaxScore != null && dto.score > answer.aiMaxScore) throw new BadRequestException(`score cannot exceed ${answer.aiMaxScore} marks`);
    const updated = await this.prisma.theoryScriptAnswer.update({ where: { id }, data: { instructorScore: dto.score } });
    await this.event(id, 'CORRECTED', { score: dto.score, previousScore: answer.instructorScore, actor, reason });
    return updated;
  }

  list(filter: { paperVersionId?: string; candidateId?: string; status?: ScriptAnswerStatus }) {
    return this.prisma.theoryScriptAnswer.findMany({
      where: {
        ...(filter.paperVersionId ? { paperVersionId: filter.paperVersionId } : {}),
        ...(filter.candidateId ? { candidateId: filter.candidateId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: { candidate: true, question: true },
      orderBy: [{ candidateId: 'asc' }, { questionId: 'asc' }],
    });
  }

  async get(id: string) {
    const answer = await this.prisma.theoryScriptAnswer.findUnique({
      where: { id },
      include: { candidate: true, question: true },
    });
    if (!answer) throw new NotFoundException('script answer not found');
    return answer;
  }

  /** Every answer for the paper version must be reviewed first — same
   * "nothing ships without a human decision" guard as PapersService.publish
   * has for question drafts. */
  async publish(paperVersionId: string, publishedBy: string) {
    const notReady = await this.prisma.theoryScriptAnswer.count({
      where: { paperVersionId, status: { notIn: ['REVIEWED', 'PUBLISHED'] } },
    });
    if (notReady > 0) {
      throw new BadRequestException(`${notReady} script answer(s) still need instructor review before results can be published.`);
    }
    const toPublish = await this.prisma.theoryScriptAnswer.findMany({ where: { paperVersionId, status: 'REVIEWED' } });
    const result = await this.prisma.theoryScriptAnswer.updateMany({
      where: { paperVersionId, status: 'REVIEWED' },
      data: { status: 'PUBLISHED' },
    });
    await this.prisma.theoryMarkEvent.createMany({
      data: toPublish.map((a) => ({ answerId: a.id, kind: 'PUBLISHED' as MarkEventKind, score: a.instructorScore, actor: publishedBy })),
    });
    return { published: result.count };
  }
}
