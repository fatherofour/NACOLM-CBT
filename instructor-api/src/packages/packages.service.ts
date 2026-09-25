import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const CENTRAL_API_URL = process.env.CENTRAL_API_URL ?? 'http://localhost:8010';

interface BridgeResponse {
  storage_path: string;
  checksum_sha256: string;
  release_key_hex: string;
  pool_size: number;
}

// Builds the encrypted question package for a frozen paper. The candidate
// roster travels to the venue separately, as a plain CSV
// (service_number,rank,full_name,pin) local-exam-server loads from disk —
// downloaded from the Candidates screen at creation/import/reset time (a
// PIN is only ever shown once, so that's the only moment a CSV row for it
// can exist) and merged by hand into the venue's roster.csv. This service
// only has to worry about the question content.
@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

  get(paperVersionId: string) {
    return this.prisma.examPackage.findUnique({ where: { paperVersionId } });
  }

  async build(paperVersionId: string, builtBy: string) {
    const version = await this.prisma.paperVersion.findUnique({
      where: { id: paperVersionId },
      include: {
        paper: true,
        items: {
          orderBy: { position: 'asc' },
          include: { question: { include: { markingScheme: { include: { conceptGroups: true } } } } },
        },
      },
    });
    if (!version) throw new NotFoundException('Paper version not found.');
    if (version.items.length === 0) throw new BadRequestException('This paper version has no questions.');

    const blueprint = await this.prisma.blueprint.findFirst({
      where: { sessionId: version.paper.sessionId },
      orderBy: { createdAt: 'desc' },
    });

    const pool = version.items.map(({ question: q }) => ({
      id: q.id,
      type: q.type === 'OBJECTIVE' ? 'mcq' : 'theory',
      topic: q.topic,
      source: q.source === 'PAST_PAPER' ? 'past_question' : 'ai_generated',
      stem: q.body,
      options: q.options as string[] | null,
      correct_index: q.correctIndex,
      // The real marking data lives in ConceptGroup (canonicalTerm/synonyms/
      // marks/required) — this is a best-effort projection into the
      // package's older simple-rubric shape, not a full fix for automatic
      // theory marking at submit time (still a known gap — see
      // local-exam-server/README.md).
      model_answer: null,
      rubric: q.markingScheme?.conceptGroups.map((g) => ({ criterion: g.canonicalTerm, points: g.marks })) ?? null,
    }));

    const body = {
      exam_id: version.id,
      title: version.paper.title,
      duration_minutes: version.paper.durationMinutes,
      pass_mark: version.paper.passMark,
      questions_per_candidate: pool.length, // the paper is already finalized — every candidate sees all of it, just shuffled
      publish_mode: blueprint?.resultsRelease === 'instant' ? 'immediate' : 'instructor_controlled',
      pool,
    };

    const res = await fetch(`${CENTRAL_API_URL}/package-bridge/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new BadRequestException(`central-api packaging failed: ${res.status} ${await res.text()}`);
    }
    const result = (await res.json()) as BridgeResponse;

    await this.prisma.examPackage.upsert({
      where: { paperVersionId },
      create: {
        paperVersionId,
        storagePath: result.storage_path,
        checksumSha256: result.checksum_sha256,
        poolSize: result.pool_size,
        builtBy,
      },
      update: {
        storagePath: result.storage_path,
        checksumSha256: result.checksum_sha256,
        poolSize: result.pool_size,
        builtBy,
        builtAt: new Date(),
      },
    });

    // The release key is never persisted (see central-api's crypto.py) — this
    // response is the one moment it exists outside the release mechanism.
    return {
      storagePath: result.storage_path,
      checksumSha256: result.checksum_sha256,
      releaseKeyHex: result.release_key_hex,
      poolSize: result.pool_size,
    };
  }
}
