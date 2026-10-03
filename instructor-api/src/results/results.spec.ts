import { createHmac } from 'node:crypto';
import { verifyResults, RESULTS_FORMAT } from './results-file.js';
import { itemAnalysis } from './item-analysis.js';

const key = 'ab'.repeat(32);

function file(payload: object, signWith = key) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return JSON.stringify({
    format: RESULTS_FORMAT,
    exam_id: (payload as { exam_id: string }).exam_id,
    payload: bytes.toString('base64'),
    signature: createHmac('sha256', Buffer.from(signWith, 'hex')).update(bytes).digest('hex'),
  });
}

const payload = { format: RESULTS_FORMAT, exam_id: 'pv1', title: 'T', centre: 'Hall A', exported_at: '2026-10-03T10:00:00Z', candidates: [], not_submitted: [] };

describe('results file', () => {
  it('accepts a correctly signed file', () => {
    expect(verifyResults(file(payload), key).exam_id).toBe('pv1');
  });

  it('rejects a file signed with another key or edited after signing', () => {
    expect(() => verifyResults(file(payload, 'cd'.repeat(32)), key)).toThrow(/signature/);
    const tampered = JSON.parse(file(payload));
    tampered.payload = Buffer.from(JSON.stringify({ ...payload, centre: 'Elsewhere' })).toString('base64');
    expect(() => verifyResults(JSON.stringify(tampered), key)).toThrow(/signature/);
  });

  it('rejects things that are not results files', () => {
    expect(() => verifyResults('hello', key)).toThrow(/not a results file/);
    expect(() => verifyResults('{"format":"x"}', key)).toThrow(/not a results file/);
  });
});

describe('item analysis', () => {
  const cands = Array.from({ length: 10 }, (_, i) => ({
    objectiveCorrect: i,
    items: [
      { questionId: 'easy', type: 'mcq', correct: true },
      { questionId: 'good', type: 'mcq', correct: i >= 5 },
      { questionId: 'bad', type: 'mcq', correct: i < 3 },
      { questionId: 'th', type: 'theory', correct: false },
    ],
  }));

  it('reports difficulty and discrimination and flags weak questions', () => {
    const stats = Object.fromEntries(itemAnalysis(cands).map((s) => [s.questionId, s]));
    expect(Object.keys(stats).sort()).toEqual(['bad', 'easy', 'good']);
    expect(stats.easy).toMatchObject({ difficulty: 1, discrimination: 0, flags: ['very easy', 'poor discrimination'] });
    expect(stats.good).toMatchObject({ difficulty: 0.5, discrimination: 1, flags: [] });
    expect(stats.bad.discrimination).toBeLessThan(0);
    expect(stats.bad.flags).toContain('weaker candidates did better: check the key');
  });

  it('leaves discrimination out with too few candidates', () => {
    expect(itemAnalysis(cands.slice(0, 4))[0].discrimination).toBeNull();
  });
});
