import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiGenerationService } from '../ai-generation/ai-generation.service.js';
import type { DocumentType } from '../generated/prisma/enums.js';

const STORAGE_ROOT = process.env.DOCUMENT_STORAGE_ROOT ?? './data/documents';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiGeneration: AiGenerationService,
  ) {}

  async upload(sessionId: string, docType: DocumentType, title: string, file: Express.Multer.File) {
    const dir = join(STORAGE_ROOT, sessionId, docType);
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

    return document;
  }

  list(sessionId: string, docType?: DocumentType) {
    return this.prisma.sourceDocument.findMany({
      where: { sessionId, ...(docType ? { docType } : {}) },
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
