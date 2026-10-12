// Reading a marking scheme the way the department writes it: a question set
// in parts ("(a) … (2 marks)"), a model answer of lettered or roman lists and
// explained points, and key points tagged with their part ("(b) Technical
// skills"). Shared by the review screen and the printed marking scheme.

const ROMAN = '(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xx)';
/**
 * A list item's label as the paper writes it: "a. Cost.", "(ii) Heart racing", "(1) To reduce…",
 * "3. Distance", and "iv Design Skill." (a numeral written without its full stop).
 */
export const LIST_LINE = new RegExp(`^(\\((?:${ROMAN}|[a-z]|\\d{1,2})\\)|(?:${ROMAN}|[a-z]|\\d{1,2})[.)]|${ROMAN}(?=\\s+[A-Z]))\\s*(.*)$`);
/** "Technical Skills. A technical skill is…": an explained point's name, shown in bold. */
const HEADED = /^([A-Z][^.:]{2,60}[.:])\s+(.{60,})$/;

export interface AnswerBlock {
  label: string | null; // "a.", "(1)", "iv."; null for a paragraph
  heading: string | null; // "Technical Skills."
  text: string;
}

/** A model answer split into list items and paragraphs, one per line. */
export function answerBlocks(text: string): AnswerBlock[] {
  // Answers saved before lists kept their line breaks read "a. Cost. b. Quality. c. Speed."
  const lines = text.includes('\n') || !LIST_LINE.test(text) ? text.split('\n') : text.split(/\s+(?=(?:(?:[a-h]|i{1,3}|iv|vi{0,3}|ix|xi{0,3})\.|\(\d{1,2}\))\s+[A-Z])/);
  const blocks: { label: string | null; text: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = LIST_LINE.exec(line);
    // "iv Design Skill." prints as "iv."
    if (m && m[2]) blocks.push({ label: /[.)]$/.test(m[1]) ? m[1] : `${m[1]}.`, text: m[2] });
    // Saved answers keep one item or paragraph per line, so an unlabelled line starts a paragraph of its own.
    else blocks.push({ label: null, text: line });
  }
  return blocks.map((b) => {
    const h = HEADED.exec(b.text);
    return h ? { label: b.label, heading: h[1], text: h[2] } : { label: b.label, heading: null, text: b.text };
  });
}

export interface SchemePointView {
  term: string;
  marks: number;
  notes: string | null;
  synonyms: string[];
}

export interface SchemePartView {
  label: string | null; // null when the question has no parts
  question: string;
  marks: number | null;
  answer: string;
  note: string;
  points: SchemePointView[];
}

const MARKS_SUFFIX = /\s*\((\d+(?:\.\d+)?)\s*marks?\)\s*$/i;

/**
 * Splits a question and its scheme into parts, each with its own question
 * text, marks, model answer, marking note and key points. A question without
 * parts comes back as a single part with no label.
 */
export function splitScheme(q: { body: string; modelAnswer: string | null; markingNotes: string | null; points: SchemePointView[]; totalMarks: number }): {
  stem: string;
  parts: SchemePartView[];
} {
  const lines = q.body.split('\n');
  const tagged = lines.map((l) => /^\(([a-z])\)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
  if (!tagged.length) {
    return { stem: '', parts: [{ label: null, question: q.body, marks: q.totalMarks, answer: q.modelAnswer ?? '', note: q.markingNotes ?? '', points: q.points }] };
  }
  const byLabel = (text: string, splitter: RegExp) =>
    new Map(
      text.split(splitter).map((chunk) => {
        const m = /^\(([a-z])\)\s*([\s\S]*)$/.exec(chunk.trim());
        return m ? [m[1], m[2]] : ['', chunk];
      }),
    );
  const answers = byLabel(q.modelAnswer ?? '', /\n\n(?=\([a-z]\) )/);
  const notes = byLabel(q.markingNotes ?? '', /;\s*(?=\([a-z]\) )/);
  return {
    stem: lines.filter((l) => !/^\([a-z]\)\s+/.test(l)).join(' ').trim(),
    parts: tagged.map((m) => {
      const label = m[1];
      const marks = MARKS_SUFFIX.exec(m[2]);
      return {
        label,
        question: m[2].replace(MARKS_SUFFIX, ''),
        marks: marks ? Number(marks[1]) : null,
        answer: answers.get(label) ?? '',
        note: notes.get(label) ?? '',
        points: q.points.filter((p) => p.term.startsWith(`(${label}) `)).map((p) => ({ ...p, term: p.term.slice(label.length + 3) })),
      };
    }),
  };
}

/** "1 for naming it, 2 for explaining it: A technical skill is…" → the rule only; the explanation is in the model answer. */
export const awardRule = (notes: string | null) => (notes ?? '').split(': ')[0];
