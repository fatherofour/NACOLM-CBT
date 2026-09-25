import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * The actual AI/RAG drafting (embeddings, retrieval, LLM prompting) stays in
 * the Python central-api service — that's where the document-processing and
 * ML ecosystem is strongest, and it's already built and tested there. This
 * service is the integration seam: it registers a study-material file with
 * central-api's own document store, triggers ingestion (chunk + embed), and
 * then asks it to draft questions, translating between this service's
 * Course/Session-as-DB-rows model and central-api's plain
 * course_code/session_label strings.
 */

const CENTRAL_API_URL = process.env.CENTRAL_API_URL ?? 'http://localhost:8010';

export interface CentralApiDraftItem {
  id: string;
  course_code: string;
  session_label: string;
  topic: string;
  difficulty: string;
  question_type: 'mcq' | 'theory';
  source: 'past_question' | 'ai_generated';
  status: string;
  stem: string;
  options: string[] | null;
  correct_index: number | null;
  model_answer: string | null;
  rubric: { criterion: string; points: number }[] | null;
  times_used: number;
  created_at: string;
}

@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);

  async registerAndIngestDocument(params: {
    storagePath: string;
    title: string;
    courseCode: string;
    sessionLabel: string;
    docType: 'past_question' | 'study_material';
  }): Promise<string> {
    const buffer = await readFile(params.storagePath);
    const form = new FormData();
    form.set('course_code', params.courseCode);
    form.set('session_label', params.sessionLabel);
    form.set('doc_type', params.docType);
    form.set('title', params.title);
    form.set('file', new Blob([buffer]), basename(params.storagePath));

    const uploadRes = await fetch(`${CENTRAL_API_URL}/documents`, { method: 'POST', body: form });
    if (!uploadRes.ok) {
      throw new Error(`central-api document upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }
    const uploaded = (await uploadRes.json()) as { id: string };
    this.logger.log(`registered ${params.title} with central-api as ${uploaded.id}`);

    if (params.docType === 'study_material') {
      const ingestRes = await fetch(`${CENTRAL_API_URL}/documents/${uploaded.id}/ingest`, { method: 'POST' });
      if (!ingestRes.ok) {
        throw new Error(`central-api ingest failed: ${ingestRes.status} ${await ingestRes.text()}`);
      }
    }
    return uploaded.id;
  }

  async draftQuestions(params: {
    courseCode: string;
    sessionLabel: string;
    topic: string;
    questionType: 'OBJECTIVE' | 'THEORY';
    count: number;
    source: 'study_material' | 'both';
  }): Promise<CentralApiDraftItem[]> {
    if (params.count <= 0) return [];

    const stageRes = await fetch(`${CENTRAL_API_URL}/question-drafts/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_code: params.courseCode,
        session_label: params.sessionLabel,
        topic: params.topic,
        question_type: params.questionType === 'OBJECTIVE' ? 'mcq' : 'theory',
        count: params.count,
        source: params.source,
      }),
    });
    if (!stageRes.ok) {
      throw new Error(`central-api stage-drafts failed: ${stageRes.status} ${await stageRes.text()}`);
    }
    const staged = (await stageRes.json()) as { items: { id: string }[] };
    const stagedIds = new Set(staged.items.map((i) => i.id));
    if (stagedIds.size === 0) return [];

    // The stage response is intentionally minimal; fetch full items (options,
    // correct_index, model_answer, rubric) so we can persist them here.
    const params2 = new URLSearchParams({ course_code: params.courseCode, session_label: params.sessionLabel });
    const listRes = await fetch(`${CENTRAL_API_URL}/questions/drafts?${params2}`);
    if (!listRes.ok) {
      throw new Error(`central-api list-drafts failed: ${listRes.status} ${await listRes.text()}`);
    }
    const allDrafts = (await listRes.json()) as CentralApiDraftItem[];
    return allDrafts.filter((d) => stagedIds.has(d.id));
  }
}
