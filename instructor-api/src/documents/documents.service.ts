import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const slug = (s: string) => s.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiGenerationService } from '../ai-generation/ai-generation.service.js';
import type { DocumentType } from '../generated/prisma/enums.js';
import { extractText } from './extract-text.js';
import { parsePastPaperText } from './past-paper-parser.js';

const STORAGE_ROOT = process.env.DOCUMENT_STORAGE_ROOT ?? './data/documents';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiGeneration: AiGenerationService,
  ) {}

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
        return { ...document, extractedQuestions: extracted.created };
      } catch (err) {
        this.logger.error(`failed to extract questions from ${document.id}: ${String(err)}`);
      }
    }

    return document;
  }

  /**
   * Deterministic (no AI) extraction of individual questions from an
   * uploaded past paper — see past-paper-parser.ts for how. Every question
   * lands as a DRAFT, same as an AI-drafted one, so nothing reaches a paper
   * without going through the normal review/approve flow; a two-column
   * layout or unusual format just means a lower-quality draft to review or
   * reject, never a silent wrong answer sneaking onto a real exam.
   */
  async extractPastPaperQuestions(documentId: string) {
    const doc = await this.prisma.sourceDocument.findUniqueOrThrow({ where: { id: documentId } });
    const buffer = await readFile(doc.storagePath);
    const text = await extractText(buffer, doc.storagePath);
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
          citation: `${doc.title}, question ${q.sourceNumber}`,
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
    return { created: parsed.length };
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
