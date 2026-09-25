// Thin client for instructor-api, reached through the /api rewrite.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ApiError(401, 'Your session has ended. Sign in again.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(res.status, msg || `Request failed (${res.status}).`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => request<T>('POST', p, form),
};

export const qs = (params: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};

// ---- Shapes returned by instructor-api ----
export type Role = 'INSTRUCTOR' | 'EXAM_OFFICER' | 'ADMIN';
export interface User { id: string; serviceNumber: string; rank: string; fullName: string; role: Role }
export interface ManagedUser extends User { active: boolean; createdAt: string }
export interface Session { id: string; courseId: string; label: string; createdAt: string }
export interface Course { id: string; code: string; name: string; sessions: Session[] }
export type QStatus = 'DRAFT' | 'APPROVED' | 'REJECTED';
export interface ConceptGroup { canonicalTerm: string; synonyms: string[]; marks: number; required: boolean }
export interface MarkingScheme {
  id?: string; totalMarks: number; ceilingPercent: number; minWordCount: number; reusedFromBank?: boolean; conceptGroups: ConceptGroup[];
}
export interface Question {
  id: string; sessionId: string; topic: string; difficulty: string; type: 'OBJECTIVE' | 'THEORY';
  source: 'PAST_PAPER' | 'AI_DRAFTED'; status: QStatus; body: string; options: string[] | null; correctIndex: number | null;
  citation: string | null; citationExcerpt: string | null; rejectReason: string | null; version: number;
  createdAt: string; updatedAt: string; markingScheme: MarkingScheme | null;
}
export interface SourceDocument {
  id: string; sessionId: string; title: string; docType: 'PAST_PAPER' | 'STUDY_MATERIAL'; storagePath: string;
  centralApiDocumentId: string | null; uploadedAt: string; session?: Session & { course: Course };
}
export interface Blueprint {
  id: string; sessionId: string; targetCount: number; objectiveCount: number; theoryCount: number; sourceMode: string;
  pastQuestionRatio: number; distribution: Record<string, number> | null; pastSessionIds: string[];
  difficultyTargets: { easy: number; medium: number; hard: number } | null; resultsRelease: 'instant' | 'hold'; createdAt: string;
}
export interface CoverageRow {
  topic: string; target: number; approved: number; pending: number; rejected: number;
  byDifficulty: { easy: number; medium: number; hard: number }; gap: number;
}
export interface PaperVersion { id: string; versionNumber: number; frozenAt: string; frozenBy: string; signatureHash: string; items: unknown[] }
export interface Paper { id: string; sessionId: string; title: string; versions: PaperVersion[] }
export interface MarkResult {
  score: number; maxScore: number; matchedGroups: string[]; missingGroups: string[];
  requiredGroupMissing: boolean; flaggedTooShort: boolean; wordCount: number;
}

export const difficultyLabel = (d: string) => ({ easy: 'Easy', medium: 'Moderate', moderate: 'Moderate', hard: 'Hard' })[d.toLowerCase()] ?? d;
export const displayName = (u: User) => `${u.rank} ${u.fullName}`;

// ---- Candidates ----------------------------------------------------------

export interface Candidate {
  id: string;
  sessionId: string;
  armyNumber: string;
  rank: string;
  fullName: string;
  active: boolean;
  createdAt: string;
}
export interface NewCandidatePin {
  armyNumber: string;
  rank: string;
  fullName: string;
  pin: string;
}
export interface ExamPackage {
  id: string;
  paperVersionId: string;
  storagePath: string;
  checksumSha256: string;
  poolSize: number;
  builtAt: string;
  builtBy: string;
}

// The roster CSV local-exam-server loads at the venue
// (internal/roster) — one row per candidate whose PIN is known right now.
// A PIN is only ever visible once (at creation, import or reset), so this
// can only include rows from that action's own response, not the whole
// roster after the fact.
export function rosterCsv(rows: { armyNumber: string; rank: string; fullName: string; pin: string }[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    'service_number,rank,full_name,pin',
    ...rows.map((r) => [r.armyNumber, r.rank, r.fullName, r.pin].map(esc).join(',')),
  ];
  return lines.join('\n') + '\n';
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
