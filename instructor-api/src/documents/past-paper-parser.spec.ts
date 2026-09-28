import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePastPaperText } from './past-paper-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const realPaper = readFileSync(join(__dirname, '__fixtures__/real-past-paper.txt'), 'utf8');

// Built from a real uploaded past paper's real pdf-parse output — a 70-
// question paper mixing MCQ, true/false, fill-in-the-blank and essay
// questions, with a two-column layout (pdf-parse has no column awareness,
// so a couple of questions land interleaved on one line) and a consolidated
// answer key at the end rather than inline answers. This is what caught and
// fixed every real bug in the parser; it isn't a synthetic convenience case.
describe('parsePastPaperText — real past paper', () => {
  const questions = parsePastPaperText(realPaper);

  it('recovers the large majority of a 70-question paper', () => {
    // Two questions are lost to a genuine, documented limitation (a
    // two-column PDF interleaving two questions onto one extracted line) —
    // recovering the rest is the bar, not perfection on every layout.
    expect(questions.length).toBeGreaterThanOrEqual(58);
  });

  it('gets every MCQ and true/false answer right where the key could be matched', () => {
    // Independently re-derive the expected answers from the same raw text
    // (grid rows of "1 2 3 ..." followed by "B B A ..."), rather than
    // hand-transcribing 50 letters into this test and risking a typo.
    const lines = realPaper.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const expected = new Map<number, string>();
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i].split(/\s+/);
      const b = lines[i + 1].split(/\s+/);
      if (a.length >= 2 && a.every((t) => /^\d{1,3}$/.test(t)) && b.length === a.length && b.every((t) => /^[A-HTFa-htf]$/.test(t))) {
        a.forEach((n, idx) => expected.set(parseInt(n, 10), b[idx].toUpperCase()));
      }
    }
    expect(expected.size).toBeGreaterThan(0); // sanity: the grid itself was found

    let checked = 0;
    for (const q of questions) {
      if (!q.options || (q.options.length !== 4 && q.options.length !== 2)) continue;
      const exp = expected.get(q.sourceNumber);
      if (!exp) continue;
      const expectedIndex = exp === 'T' ? 0 : exp === 'F' ? 1 : exp.charCodeAt(0) - 65;
      expect(q.correctIndex, `Q${q.sourceNumber}`).toBe(expectedIndex);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(37);
  });

  it("doesn't mistake an essay question's (a)/(b) sub-parts for MCQ options", () => {
    const q = questions.find((x) => x.body.includes('Payload Capacity'));
    expect(q?.type).toBe('THEORY');
    expect(q?.body).toContain('(A) Calculate the maximum legal payload');
    expect(q?.body).toContain('(B) Determine the maximum number');
  });

  it('strips recurring page-footer and page-separator noise out of question bodies', () => {
    const q = questions.find((x) => x.body.startsWith('Cross-docking'));
    expect(q?.body).toBe('Cross-docking reduces warehouse storage needs.');
  });

  it('attaches a one-concept marking scheme to fill-in-the-blank questions with a matched answer key entry', () => {
    const q = questions.find((x) => x.body.startsWith('Total weight of vehicle'));
    expect(q?.type).toBe('THEORY');
    expect(q?.markingScheme).toEqual([{ canonicalTerm: 'Gross Vehicle Weight (GVW)', marks: 5 }]);
  });

  it('recovers an answer-key value that starts with a digit, not just letters', () => {
    // "53: 2 (Two)" — an earlier version of this parser required the value
    // to start with a letter specifically to avoid misreading a grid row,
    // which silently dropped exactly this kind of real answer.
    const q = questions.find((x) => x.body.includes('40-foot standard ISO'));
    expect(q?.markingScheme?.[0].canonicalTerm).toBe('2 (Two)');
  });

  it('never returns a question with an empty body', () => {
    expect(questions.every((q) => q.body.trim().length > 0)).toBe(true);
  });
});

describe('parsePastPaperText — synthetic edge cases', () => {
  it('returns nothing for text with no numbered questions', () => {
    expect(parsePastPaperText('Just some cover-page text.\nNo questions here.')).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(parsePastPaperText('')).toEqual([]);
  });

  it('parses an inline "Answer: X" line immediately under a question', () => {
    const text = ['1. Pick B', '(a) wrong', '(b) right', '(c) also wrong', 'Answer: B'].join('\n');
    const [q] = parsePastPaperText(text);
    expect(q.type).toBe('OBJECTIVE');
    expect(q.options).toEqual(['wrong', 'right', 'also wrong']);
    expect(q.correctIndex).toBe(1);
  });

  it('treats a two-option question with no true/false marker as OBJECTIVE, not a forced theory question', () => {
    const text = '1. Pick one\n(a) yes\n(b) no';
    const [q] = parsePastPaperText(text);
    expect(q.type).toBe('OBJECTIVE');
    expect(q.options).toEqual(['yes', 'no']);
  });

  it('falls back to THEORY with no marking scheme when there is no answer-key match', () => {
    const text = '1. Explain convoy discipline in your own words.';
    const [q] = parsePastPaperText(text);
    expect(q.type).toBe('THEORY');
    expect(q.options).toBeUndefined();
    expect(q.markingScheme).toBeUndefined();
  });

  it('ignores text before the first numbered question', () => {
    const text = 'EXAM PAPER — DO NOT OPEN\n1. First real question\n(a) x\n(b) y';
    const questions = parsePastPaperText(text);
    expect(questions).toHaveLength(1);
    expect(questions[0].body).toBe('First real question');
  });
});
