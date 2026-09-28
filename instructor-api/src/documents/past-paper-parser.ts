// Deterministic (no AI) extraction of individual questions from an
// uploaded past-paper's raw text. Built and tuned against a real uploaded
// paper (see past-paper-parser.spec.ts), not just synthetic examples —
// real past papers mix several question styles in one document and often
// put the answer key in a separate block at the end rather than inline.
//
// Known limitations, honestly: this is line-based pattern matching, not a
// layout parser. Multi-column PDFs can interleave two questions onto one
// extracted line (pdf-parse has no column awareness) — those blocks come
// out garbled and are best caught by a human during review, which is why
// everything this produces lands as DRAFT, never auto-approved. Scanned/
// image-only PDFs produce no extractable text at all.

export type ParsedQuestionType = 'OBJECTIVE' | 'THEORY';

export interface ParsedQuestion {
  /** The question's number in the source paper — kept as provenance, the
   * same idea as the citation on an AI-drafted question. */
  sourceNumber: number;
  type: ParsedQuestionType;
  body: string;
  options?: string[];
  correctIndex?: number;
  /** One-concept marking scheme, when the answer key gives us a concrete
   * expected phrase for a fill-in-the-blank question — reuses the same
   * keyword-marking shape as everything else in the bank. */
  markingScheme?: { canonicalTerm: string; marks: number }[];
}

const QUESTION_START = /^(?:Q(?:uestion)?\.?\s*)?(\d{1,3})[.):]\s+(.*)$/i;
const OPTION_START = /^\(?([A-Ha-h])[.)]\s+(.*)$/;
const INLINE_ANSWER = /^(?:Answer|Ans|Key)s?\s*[:.]?\s*\(?([A-Ha-h])\)?\.?\s*$/i;
const TRUE_FALSE_MARKER = /\[\s*T\s*\/\s*F\s*\]/i;
const BLANK_MARKER = /_{3,}/;
const SECTION_STOP = /^(OFFICIAL\s+)?ANSWER\s+KEY|MARKING\s+SCHEME|WORKED\s+SOLUTIONS?/i;
// "51: Gross Vehicle Weight (GVW)" — a numbered short-answer key entry. The
// colon/period requirement is what actually separates this from a plain
// number-only grid row ("51 52 53 54 ..."), which never has one — no need
// to also require the value start with a letter, and requiring that
// wrongly rejected real answers like "53: 2 (Two)".
const NUMBERED_KEY_ENTRY = /^(\d{1,3})\s*[:.]\s*\S/;
// Recurring page furniture that a naive text extraction interleaves into
// the content stream at page boundaries — pdf-parse's own page separator,
// and the common "Course Code: ... Page N of M" style footer.
const NOISE_LINE = /^--\s*\d+\s*of\s*\d+\s*--$|Page\s+\d+\s+of\s+\d+|^SECTION\s+[A-Z]\s*[:.]/i;
// A real MCQ option is a short phrase; a numbered sub-part of an essay
// question ("(a) Calculate ...", "(b) Determine ...") reads like a lettered
// option but runs much longer — this tells the two apart.
const MAX_OPTION_CHARS = 90;

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NOISE_LINE.test(l));
}

/** A line of nothing but small integers, e.g. "1 2 3 4 5 6 7 8 9 10". */
function isNumberRow(line: string): number[] | null {
  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return null;
  const nums = tokens.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n <= 0 || n > 999)) return null;
  return nums;
}

/** A line of nothing but single-letter answer tokens (A-H, or T/F). */
function isAnswerRow(line: string): string[] | null {
  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return null;
  if (!tokens.every((t) => /^[A-Ha-hTFtf]$/.test(t))) return null;
  return tokens.map((t) => t.toUpperCase());
}

interface AnswerKeys {
  /** Question number -> answer letter (A-H, or T/F), from grid rows or inline "Answer: X" lines. */
  letters: Map<number, string>;
  /** Question number -> free-text expected answer, for fill-in-the-blank. */
  text: Map<number, string>;
}

function extractAnswerKeys(lines: string[]): AnswerKeys {
  const letters = new Map<number, string>();
  const text = new Map<number, string>();

  for (let i = 0; i < lines.length; i++) {
    const nums = isNumberRow(lines[i]);
    if (nums && i + 1 < lines.length) {
      const answers = isAnswerRow(lines[i + 1]);
      if (answers && answers.length === nums.length) {
        nums.forEach((n, idx) => letters.set(n, answers[idx]));
        i++; // consume the answer row too
        continue;
      }
    }
    const inline = INLINE_ANSWER.exec(lines[i]);
    if (inline) continue; // handled per-block in parsePastPaperText, not here
    if (NUMBERED_KEY_ENTRY.test(lines[i])) {
      // A two-column layout sometimes puts two "NN: value" key entries on
      // one extracted line ("51: Gross Vehicle Weight (GVW)   52: In-Transit
      // Visibility") — find every entry start on the line, not just the
      // first, so the second one isn't silently dropped.
      const starts = [...lines[i].matchAll(/(\d{1,3})\s*[:.]\s*(?=\S)/g)];
      for (let j = 0; j < starts.length; j++) {
        const n = parseInt(starts[j][1], 10);
        const from = starts[j].index! + starts[j][0].length;
        const to = j + 1 < starts.length ? starts[j + 1].index! : lines[i].length;
        const value = lines[i].slice(from, to).trim();
        // Only trust this as a short-answer key entry if it wasn't already
        // claimed by the letter grid above (avoids misreading a stray
        // "12 B" style line twice).
        if (value && !letters.has(n)) text.set(n, value);
      }
    }
  }
  return letters.size || text.size ? { letters, text } : { letters, text };
}

export function parsePastPaperText(rawText: string): ParsedQuestion[] {
  const allLines = splitLines(rawText);

  const stopAt = allLines.findIndex((l) => SECTION_STOP.test(l));
  const questionLines = stopAt === -1 ? allLines : allLines.slice(0, stopAt);
  // Grid rows and "NN: value" key entries are only trusted in a labeled
  // answer-key section, never scanned across the questions themselves — an
  // ordinary question line like "51. Total weight is ___" is structurally
  // identical to a numbered key entry ("51: value"), so without this a
  // question with no real answer-key match would self-pollute with its own
  // stem as the "answer". Inline "Answer: X" lines aren't affected by this:
  // they're matched per-block below, scoped to that question only.
  const keys = extractAnswerKeys(stopAt === -1 ? [] : allLines.slice(stopAt));

  // ---- group into per-question blocks ----
  interface Block { num: number; lines: string[] }
  const blocks: Block[] = [];
  for (const line of questionLines) {
    const m = QUESTION_START.exec(line);
    if (m) {
      blocks.push({ num: parseInt(m[1], 10), lines: [m[2]] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }

  const out: ParsedQuestion[] = [];
  for (const block of blocks) {
    const stemLines: string[] = [];
    const options: { letter: string; text: string }[] = [];
    let inlineAnswer: string | null = null;

    for (const line of block.lines) {
      const ans = INLINE_ANSWER.exec(line);
      if (ans) {
        inlineAnswer = ans[1].toUpperCase();
        continue;
      }
      const opt = OPTION_START.exec(line);
      if (opt) {
        options.push({ letter: opt[1].toUpperCase(), text: opt[2].trim() });
        continue;
      }
      if (options.length === 0) stemLines.push(line);
      else options[options.length - 1].text += ' ' + line; // wrapped option text
    }

    const looksLikeOptions = options.length >= 2 && options.every((o) => o.text.trim().length <= MAX_OPTION_CHARS);

    const stem = looksLikeOptions
      ? stemLines.join(' ').replace(/\s+/g, ' ').trim()
      : [...stemLines, ...options.map((o) => `(${o.letter}) ${o.text}`)].join(' ').replace(/\s+/g, ' ').trim();
    if (!stem) continue;

    const answerLetter = inlineAnswer ?? keys.letters.get(block.num) ?? null;

    if (looksLikeOptions) {
      const sorted = [...options].sort((a, b) => a.letter.localeCompare(b.letter));
      const optTexts = sorted.map((o) => o.text.trim());
      let correctIndex: number | undefined;
      if (answerLetter) {
        const idx = sorted.findIndex((o) => o.letter === answerLetter);
        if (idx >= 0) correctIndex = idx;
      }
      out.push({ sourceNumber: block.num, type: 'OBJECTIVE', body: stem, options: optTexts, correctIndex });
      continue;
    }

    if (TRUE_FALSE_MARKER.test(stem)) {
      const cleanStem = stem.replace(TRUE_FALSE_MARKER, '').trim();
      let correctIndex: number | undefined;
      if (answerLetter === 'T') correctIndex = 0;
      else if (answerLetter === 'F') correctIndex = 1;
      out.push({ sourceNumber: block.num, type: 'OBJECTIVE', body: cleanStem, options: ['True', 'False'], correctIndex });
      continue;
    }

    // Theory (essay, or fill-in-the-blank — both are free-response).
    const expected = keys.text.get(block.num);
    out.push({
      sourceNumber: block.num,
      type: 'THEORY',
      body: stem,
      markingScheme: expected ? [{ canonicalTerm: expected, marks: 5 }] : undefined,
    });
  }

  return out;
}
