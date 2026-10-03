import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { centralApiHeaders } from '../central-api/central-api-auth.js';

const CENTRAL_API_URL = process.env.CENTRAL_API_URL ?? 'http://localhost:8010';

interface BridgeResponse {
  storage_path: string;
  checksum_sha256: string;
  release_key_hex: string;
  pool_size: number;
}

// Builds the encrypted question package for a published paper. The candidate
// roster travels to the venue separately, as a plain CSV
// (service_number,rank,full_name,pin) local-exam-server loads from disk —
// downloaded from the Candidates screen at creation/import/reset time (a
// PIN is only ever shown once, so that's the only moment a CSV row for it
// can exist) and merged by hand into the venue's roster.csv. This service
// only has to worry about the question content.
@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

  // The results key stays server-side: it travels to the venue only inside the encrypted package.
  get(paperVersionId: string) {
    return this.prisma.examPackage.findUnique({ where: { paperVersionId }, omit: { resultsKeyHex: true } });
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

    // Theory on paper: the kiosk shows only objective questions and tells
    // candidates how many theory answers go on their answer sheets.
    const onPaper = version.paper.theoryOnPaper;
    const kioskItems = onPaper ? version.items.filter((i) => i.question.type !== 'THEORY') : version.items;
    if (!kioskItems.length) throw new BadRequestException('This paper has no objective questions for the kiosk; its theory is all on paper.');
    const theoryOnPaper = onPaper ? version.items.length - kioskItems.length : 0;
    // Carried inside the encrypted package; the venue signs its results file
    // with it, so an imported results file can be checked for tampering.
    const resultsKeyHex = randomBytes(32).toString('hex');

    const pool = kioskItems.map(({ question: q }) => ({
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
      theory_on_paper: theoryOnPaper,
      results_key_hex: resultsKeyHex,
    };

    const res = await fetch(`${CENTRAL_API_URL}/package-bridge/build`, {
      method: 'POST',
      headers: centralApiHeaders({ 'Content-Type': 'application/json' }),
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
        resultsKeyHex,
        builtBy,
      },
      update: {
        resultsKeyHex,
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

  /** The encrypted package file, streamed from central-api for the exam officer to take to the venue. */
  async download(paperVersionId: string) {
    const pkg = await this.prisma.examPackage.findUnique({ where: { paperVersionId } });
    if (!pkg) throw new NotFoundException('No package has been built for this paper version yet.');
    const res = await fetch(`${CENTRAL_API_URL}/package-bridge/packages/${encodeURIComponent(paperVersionId)}`, { headers: centralApiHeaders() });
    if (!res.ok) throw new NotFoundException('The package file could not be found. Rebuild the package.');
    return Buffer.from(await res.arrayBuffer());
  }
}
