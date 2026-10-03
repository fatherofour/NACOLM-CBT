import { createHmac, timingSafeEqual } from 'node:crypto';

// The signed results file the venue exam server exports (see
// local-exam-server/internal/api/results.go). The payload is signed as raw
// bytes, so nothing here re-serializes JSON before checking it.

export interface ResultItem {
  question_id: string;
  type: string;
  correct: boolean;
  answered: boolean;
}

export interface ResultCandidate {
  service_number: string;
  submitted_at: string;
  reference: string;
  response_hash: string;
  objective_correct: number;
  objective_total: number;
  items: ResultItem[];
}

export interface ResultsPayload {
  format: string;
  exam_id: string;
  title: string;
  centre: string;
  exported_at: string;
  candidates: ResultCandidate[];
  not_submitted: string[];
}

export const RESULTS_FORMAT = 'nacolm-results-v1';

export function readEnvelope(text: string): { examId: string; payload: Buffer; signature: string } {
  let env: { format?: unknown; exam_id?: unknown; payload?: unknown; signature?: unknown };
  try {
    env = JSON.parse(text);
  } catch {
    throw new Error('This is not a results file from the exam server.');
  }
  if (env.format !== RESULTS_FORMAT || typeof env.exam_id !== 'string' || typeof env.payload !== 'string' || typeof env.signature !== 'string') {
    throw new Error('This is not a results file from the exam server.');
  }
  return { examId: env.exam_id, payload: Buffer.from(env.payload, 'base64'), signature: env.signature };
}

/** Checks the signature with the package's results key and returns the parsed results. */
export function verifyResults(text: string, keyHex: string): ResultsPayload {
  const { examId, payload, signature } = readEnvelope(text);
  const expected = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(payload).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('The results file’s signature doesn’t match. It was changed after it left the exam server, or it belongs to a different package. Don’t import it.');
  }
  const parsed = JSON.parse(payload.toString('utf8')) as ResultsPayload;
  if (parsed.exam_id !== examId || parsed.format !== RESULTS_FORMAT || !Array.isArray(parsed.candidates)) {
    throw new Error('The results file is inconsistent.');
  }
  return parsed;
}
