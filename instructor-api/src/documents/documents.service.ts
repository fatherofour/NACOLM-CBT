import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const slug = (s: string) => s.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiGenerationService } from '../ai-generation/ai-generation.service.js';
import type { DocumentType } from '../generated/prisma/enums.js';
import { extractText, hasUsableText, pageImages } from './extract-text.js';
import { parsePastPaperText } from './past-paper-parser.js';
import { looksLikeMarkingScheme, parseMarkingScheme } from './marking-scheme-parser.js';
import { OllamaService } from '../ollama/ollama.service.js';
import { AiQueueService } from '../ai-queue/ai-queue.service.js';
import { KEEP_ALIVE, OCR_MODEL } from '../ai-queue/models.js';

// Question papers have small print and dense handwriting; read them a little
// larger than single answers.
const PAPER_OCR_MAX_PX = Number(process.env.PAPER_OCR_MAX_PX ?? 1400);

const PAPER_OCR_PROMPT = `This is one page of an exam question paper or marking scheme. It may be printed, handwritten, or both. Transcribe every line of text from top to bottom exactly as written. Keep question numbers (1., 2., 15.), sub-part letters (a., b.), roman numerals (i., ii.), headings such as SOLUTION, and marks in brackets such as (4 marks) exactly as they appear. Put each question, sub-part and list item on its own line. Do not summarise, correct or add anything. Output only the transcription.`;

const STORAGE_ROOT = process.env.DOCUMENT_STORAGE_ROOT ?? './data/documents';

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiGeneration: AiGenerationService,
    private readonly ollama: OllamaService,
    private readonly queue: AiQueueService,
  ) {
    this.queue.register('paper-ocr', (id, model) => this.readPaper(id, model));
  }

  /** Papers the AI was still reading when the server restarted go back in the queue. */
  async onModuleInit() {
    const reading = await this.prisma.sourceDocument.findMany({ where: { extraction: 'reading' }, select: { id: true } });
    for (const d of reading) this.queue.add({ id: `paper:${d.id}`, target: d.id, kind: 'paper-ocr', stage: 'ocr', model: OCR_MODEL });
  }

  /**
   * Where a file for this session and type is saved on the server:
   * <DOCUMENT_STORAGE_ROOT>/<COURSE>/<session-label>/<past-papers|study-material>/
   * The portal shows this path to the instructor before they upload.
   */
  async destination(sessionId: string, docType: DocumentType) {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId }, include: { course: true } });
    const folder = docType === 'PAST_PAPER' ? 'past-papers' : 'study-material';
    return resolve(STORAGE_ROOT, slug(session.course.code), slug(session.label), folder);
  }

  async upload(sessionId: string, docType: DocumentType, title: string, file: Express.Multer.File) {
    const dir = await this.destination(sessionId, docType);
    await mkdir(dir, { recursive: true });
    const safeName = `${randomUUID()}_${basename(file.originalname)}`;
    const storagePath = join(dir, safeName);
    await writeFile(storagePath, file.buffer);

    const document = await this.prisma.sourceDocument.create({
      data: { sessionId, docType, title, storagePath },
    });

    // Study material needs to exist in central-api too, since that's what
    // actually runs the RAG pipeline for AI-drafted questions. Best-effort:
    // if central-api is unreachable, the upload itself still succeeds — the
    // instructor just can't draft from it via AI until this is retried.
    if (docType === 'STUDY_MATERIAL') {
      const session = await this.prisma.session.findUniqueOrThrow({
        where: { id: sessionId },
        include: { course: true },
      });
      try {
        const centralApiDocumentId = await this.aiGeneration.registerAndIngestDocument({
          storagePath,
          title,
          courseCode: session.course.code,
          sessionLabel: session.label,
          docType: 'study_material',
        });
        return this.prisma.sourceDocument.update({
          where: { id: document.id },
          data: { centralApiDocumentId },
        });
      } catch (err) {
        this.logger.error(`failed to register/ingest ${document.id} with central-api: ${String(err)}`);
      }
    }

    // Best-effort, same as study material's central-api registration above:
    // a past paper that fails to parse (e.g. a scanned, image-only PDF with
    // no text layer) still gets stored — the instructor just adds questions
    // to the bank by hand for that one, same as before this existed.
    if (docType === 'PAST_PAPER') {
      try {
        const extracted = await this.extractPastPaperQuestions(document.id);
        return { ...document, extractedQuestions: extracted.created, reading: extracted.reading };
      } catch (err) {
        this.logger.error(`failed to extract questions from ${document.id}: ${String(err)}`);
      }
    }

    return document;
  }

  /**
   * Turns an uploaded past paper into DRAFT bank questions. Typed papers are
   * parsed straight away: a marking scheme (questions with SOLUTION blocks)
   * becomes theory questions with model answers and draft marking schemes;
   * an ordinary paper goes through the question/answer-key parser. A paper
   * with no usable text (handwritten, scanned or photographed) is read by the
   * AI in the background first. Nothing reaches a paper without review.
   */
  async extractPastPaperQuestions(documentId: string) {
    const doc = await this.prisma.sourceDocument.findUniqueOrThrow({ where: { id: documentId } });
    const buffer = await readFile(doc.storagePath);
    const text = await extractText(buffer, doc.storagePath);
    if (!hasUsableText(text)) {
      this.queue.assertRoom();
      await this.prisma.sourceDocument.update({ where: { id: documentId }, data: { extraction: 'reading', extractionNote: null } });
      this.queue.add({ id: `paper:${documentId}`, target: documentId, kind: 'paper-ocr', stage: 'ocr', model: OCR_MODEL });
      return { created: 0, reading: true };
    }
    const created = await this.createQuestions(doc, text);
    await this.prisma.sourceDocument.update({ where: { id: documentId }, data: { extraction: 'done', extractedCount: created, extractionNote: null } });
    return { created, reading: false };
  }

  /** Background job: the vision model reads each page, then the text is parsed as usual. */
  async readPaper(documentId: string, model: string) {
    const doc = await this.prisma.sourceDocument.findUnique({ where: { id: documentId } });
    if (!doc || doc.extraction !== 'reading') return;
    try {
      const pages = await pageImages(await readFile(doc.storagePath), doc.storagePath);
      if (!pages.length) throw new Error('no pages could be read from this file');
      const texts: string[] = [];
      for (const page of pages) {
        const img = await sharp(page).rotate().resize({ width: PAPER_OCR_MAX_PX, height: PAPER_OCR_MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
        texts.push((await this.ollama.generate({ model, prompt: PAPER_OCR_PROMPT, images: [img.toString('base64')], keepAlive: KEEP_ALIVE })).trim());
      }
      const transcript = texts.join('\n\n');
      const created = await this.createQuestions(doc, transcript, true);
      await this.prisma.sourceDocument.update({
        where: { id: documentId },
        data: {
          extraction: 'done',
          extractedCount: created,
          transcript,
          extractionNote: created ? `Read by the AI from ${pages.length} page${pages.length === 1 ? '' : 's'}. Check each question against the paper.` : 'The AI read the paper but no questions could be picked out. Check the transcript.',
        },
      });
    } catch (err) {
      this.logger.error(`reading past paper ${documentId} failed: ${String(err)}`);
      await this.prisma.sourceDocument.update({ where: { id: documentId }, data: { extraction: 'failed', extractionNote: `The AI couldn’t read this paper: ${String(err).slice(0, 300)}` } });
    }
  }

  private async createQuestions(doc: { id: string; sessionId: string; title: string }, text: string, readByAi = false) {
    const citation = (label: string | number) => `${doc.title}, question ${label}${readByAi ? ' (read by AI from handwriting/scan)' : ''}`;
    if (looksLikeMarkingScheme(text)) {
      const parsed = parseMarkingScheme(text);
      for (const q of parsed) {
        await this.prisma.questionBankItem.create({
          data: {
            sessionId: doc.sessionId,
            topic: q.topic ?? 'Uncategorized',
            type: q.type,
            source: 'PAST_PAPER',
            status: 'DRAFT',
            body: q.body,
            options: q.options,
            citation: citation(q.label),
            markingScheme:
              q.type === 'THEORY' && q.totalMarks > 0
                ? {
                    create: {
                      totalMarks: q.totalMarks,
                      minWordCount: 3,
                      modelAnswer: q.modelAnswer,
                      partialCreditNotes: q.markingNotes,
                      conceptGroups: { create: q.points.map((p, i) => ({ ...p, order: i })) },
                    },
                  }
                : undefined,
          },
        });
      }
      return parsed.length;
    }

    const parsed = parsePastPaperText(text);
    for (const q of parsed) {
      await this.prisma.questionBankItem.create({
        data: {
          sessionId: doc.sessionId,
          topic: 'Uncategorized',
          type: q.type,
          source: 'PAST_PAPER',
          status: 'DRAFT',
          body: q.body,
          options: q.options,
          correctIndex: q.correctIndex,
          citation: citation(q.sourceNumber),
          markingScheme: q.markingScheme
            ? {
                create: {
                  totalMarks: q.markingScheme.reduce((sum, g) => sum + g.marks, 0),
                  conceptGroups: {
                    create: q.markingScheme.map((g, i) => ({ canonicalTerm: g.canonicalTerm, marks: g.marks, required: true, order: i })),
                  },
                },
              }
            : undefined,
        },
      });
    }
    return parsed.length;
  }

  list(filter: { sessionId?: string; courseId?: string; docType?: DocumentType }) {
    return this.prisma.sourceDocument.findMany({
      where: {
        ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
        ...(filter.courseId ? { session: { courseId: filter.courseId } } : {}),
        ...(filter.docType ? { docType: filter.docType } : {}),
      },
      include: { session: { include: { course: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async delete(id: string) {
    const doc = await this.prisma.sourceDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('document not found');

    await unlink(doc.storagePath).catch(() => undefined); // already-missing file shouldn't block the DB delete
    await this.prisma.sourceDocument.delete({ where: { id } });
    return { deleted: true, id };
  }

  get(id: string) {
    return this.prisma.sourceDocument.findUniqueOrThrow({ where: { id } });
  }
}
