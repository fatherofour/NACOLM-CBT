// Reads a NACOLM-style marking scheme: each question with its marks in
// brackets, a "SOLUTION" heading, the model answer, and marking notes such as
// "(each attracts one mark)" or "(2 marks for explaining each skill)". It
// turns every question part into a bank question with a model answer and a
// draft marking scheme. Everything lands as DRAFT for an instructor to check
// and approve; this only saves the typing.

export interface SchemePoint {
  canonicalTerm: string;
  synonyms: string[];
  marks: number;
  required: boolean;
  notes: string | null;
}

export interface SchemeQuestion {
  label: string; // "15b"
  type: 'OBJECTIVE' | 'THEORY';
  body: string;
  totalMarks: number;
  options?: string[];
  topic: string | null;
  modelAnswer: string | null;
  markingNotes: string | null;
  points: SchemePoint[];
}

const NOISE = /^(RESTRICTED|CONFIDENTIAL|SECRET)$|^\d{1,3}$|^--\s*\d+\s*of\s*\d+\s*--$|^SECTION\s+[A-Z]\b|^=+(\s*=)*$/i;
const SOLUTION = /^(SOLUTIONS?|ANSWERS?|MARKING\s+GUIDE|MODEL\s+ANSWER)\s*:?\s*$/i;
const MAIN_START = /^(\d{1,3})\s*[.)]\s+(?:([a-h])\s*[.)]\s+)?(.*)$/;
const SUB_START = /^\(?([a-h])\s*[.)]\s+(.*)$/;
// Marks for the question itself: "(4 marks)", "(1.5 marks –(0.25 marks each))", "(1 mark)".
const QUESTION_MARKS = /\(\s*(\d+(?:\.\d+)?)\s*marks?\b/i;
const TRUE_FALSE = /\(\s*True\s+or\s+False\s*\)\.?/i;
// A list item in an answer: "a. Cost.", "iv. Design skill", "(ii) Heart racing", and
// "i Technological Development." (roman numeral without its full stop).
const ROMAN = '(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xx)';
const LIST_ITEM = new RegExp(`^\\(?(${ROMAN})(?:\\s*[.)]\\s*|\\s+(?=[A-Z]))(.*)$|^\\(?([a-z])\\s*[.)]\\s+(.*)$`);
const FIRST_LABELS = new Set(['a', 'i']);
const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Marking notes written into the answer, in the order the department writes them.
const PER_ITEM_PATTERNS: [RegExp, 'list' | 'explain' | 'each'][] = [
  [/\(\s*(\d+(?:\.\d+)?)\s*marks?\s+for\s+explaining\b[^)]*\)/i, 'explain'],
  [/\(\s*(\d+(?:\.\d+)?)\s*marks?\s+(?:for\s+)?each\b[^)]*\)/i, 'each'],
  [/\(\s*each\s+(?:is|carries|attracts)\s+(\d+(?:\.\d+)?)\s*marks?\s*\)/i, 'each'],
  [/\(\s*(?:each\s+attracts\s+one\s+mark|one\s+mark\s+each)\s*\)/i, 'list'],
];

function words(n: string): number | null {
  const v = Number(n);
  if (Number.isFinite(v)) return v;
  return NUMBER_WORDS[n.toLowerCase()] ?? null;
}

/** How many items the question asks for: "List the 4…", "Name 6 terms", "at least 5", "about 8". */
export function requiredCount(question: string): number | null {
  const q = question.replace(/\([^)]*\)/g, ' ');
  const m = /\b(?:the|at\s+least|about|any|list|name|state|give|mention|identify|explain)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(q);
  return m ? words(m[1]) : null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(And|Of|The|To|In|For)\b/g, (w) => w.toLowerCase());
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const stripNotes = (s: string) => tidy(s.replace(/\((?:[^()]*\bmarks?\b[^()]*|each attracts one mark|one mark each)\)\.?/gi, ''));
const trimEnd = (s: string) => s.replace(/[\s.,;:]+$/, '');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const round = (n: number) => Math.round(n * 100) / 100;

/** Splits "Technical Skills. A technical skill is…" into the point's name and its explanation. */
function headingOf(text: string): { name: string; explanation: string } {
  const m = /^([A-Z][^.:]{2,60})[.:]\s+(.+)$/.exec(text);
  if (m && m[1].split(/\s+/).length <= 8) return { name: tidy(m[1]), explanation: tidy(m[2]) };
  return { name: tidy(text), explanation: '' };
}

interface Part {
  label: string;
  header: string[];
  answer: string[];
}

export function looksLikeMarkingScheme(text: string): boolean {
  return text.split(/\r?\n/).filter((l) => SOLUTION.test(l.trim())).length >= 2;
}

export function parseMarkingScheme(raw: string): SchemeQuestion[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOISE.test(l));

  // The first all-capitals heading before the questions names the subject.
  const firstQ = lines.findIndex((l) => MAIN_START.test(l));
  const heading = lines.slice(0, Math.max(0, firstQ)).reverse().find((l) => /^[A-Z][A-Z\s&,-]{6,}$/.test(l) && !/COLLEGE|DEPARTMENT|ARMY|SECTION/.test(l));
  const topic = heading ? titleCase(heading) : null;

  // A line starts a question part only if its marks appear within the next
  // few lines; otherwise "a. Cost." in an answer would look like a sub-question.
  const isHeader = (i: number) => {
    const main = MAIN_START.exec(lines[i]);
    const sub = !main && SUB_START.exec(lines[i]);
    if (!main && !sub) return null;
    for (let j = i; j < Math.min(lines.length, i + 4); j++) {
      if (j > i && (SOLUTION.test(lines[j]) || MAIN_START.test(lines[j]) || SUB_START.test(lines[j]))) break;
      // "(1" at the end of one line and "mark)" on the next still count.
      if (QUESTION_MARKS.test(lines.slice(i, j + 1).join(' '))) return { main, sub, end: j };
    }
    return null;
  };

  const parts: Part[] = [];
  let currentMain = 0;
  for (let i = firstQ < 0 ? lines.length : firstQ; i < lines.length; i++) {
    const h = isHeader(i);
    if (h) {
      let label: string;
      let first: string;
      if (h.main) {
        currentMain = Number(h.main[1]);
        label = `${currentMain}${h.main[2] ?? ''}`;
        first = h.main[3];
      } else {
        label = `${currentMain}${(h.sub as RegExpExecArray)[1]}`;
        first = (h.sub as RegExpExecArray)[2];
      }
      parts.push({ label, header: [first, ...lines.slice(i + 1, h.end + 1)], answer: [] });
      i = h.end;
      continue;
    }
    if (!parts.length || SOLUTION.test(lines[i])) continue;
    parts[parts.length - 1].answer.push(lines[i]);
  }

  return parts.map((p) => toQuestion(p, topic));
}

function toQuestion(p: Part, topic: string | null): SchemeQuestion {
  const headerText = tidy(p.header.join(' '));
  const totalMarks = Number(QUESTION_MARKS.exec(headerText)?.[1] ?? 0);
  const body = tidy(headerText.replace(/\(\s*\d+(?:\.\d+)?\s*marks?\b[^)]*\)*\)?\.?/i, ''));
  const answerText = p.answer.join('\n');

  if (TRUE_FALSE.test(body)) {
    return {
      label: p.label,
      type: 'OBJECTIVE',
      body: tidy(body.replace(TRUE_FALSE, '')),
      totalMarks,
      options: ['True', 'False'],
      topic,
      modelAnswer: null,
      markingNotes: null,
      points: [],
    };
  }

  // Marking notes, wherever they are written.
  const allText = `${headerText}\n${answerText}`;
  let listMark: number | null = null;
  let explainMark: number | null = null;
  let eachMark: number | null = null;
  const notes: string[] = [];
  for (const [re, kind] of PER_ITEM_PATTERNS) {
    const m = re.exec(allText);
    if (!m) continue;
    notes.push(tidy(m[0].replace(/^\(|\)$/g, '')));
    if (kind === 'list') listMark = 1;
    if (kind === 'explain') explainMark = Number(m[1]);
    if (kind === 'each') eachMark = Number(m[1]);
  }

  // Answer items: a short naming list, explanation paragraphs, or both.
  // Answer items, grouped into runs: a naming list (i–iv) is often followed by
  // the same points explained (i–iv again).
  const runs: { label: string; text: string }[][] = [];
  for (const line of p.answer) {
    const m = LIST_ITEM.exec(line);
    if (m) {
      const label = (m[1] ?? m[3]).toLowerCase();
      const prev = runs.at(-1)?.at(-1)?.label;
      // "i" after "h" is the ninth letter of a lettered list, not a new roman-numbered one.
      const restarts = FIRST_LABELS.has(label) && !(label === 'i' && prev === 'h');
      if (!runs.length || restarts) runs.push([]);
      runs[runs.length - 1].push({ label, text: m[2] ?? m[4] });
    } else if (runs.length) {
      const run = runs[runs.length - 1];
      run[run.length - 1].text += ' ' + line;
    }
  }
  const clean = (run: { label: string; text: string }[]) => run.map((it) => stripNotes(it.text)).filter(Boolean);
  const naming = runs.length >= 2 ? clean(runs[0]) : null;
  const explained = (runs.length >= 2 ? runs.slice(1).flat() : (runs[0] ?? [])).map((it) => headingOf(stripNotes(it.text))).filter((x) => x.name);

  // The names of the points: the naming list if there is one, otherwise each
  // item's heading, otherwise a list inside a sentence ("…are mean, median and mode.").
  let names: string[] = (naming ?? explained.map((x) => x.name)).map((n) => capital(trimEnd(n)));
  const paragraphs = explained;
  const k = requiredCount(body);
  if (names.length < 2 && k && k >= 2) {
    const sentence = stripNotes(answerText.replace(/\n/g, ' '));
    const tail = /(?:\bare|\binclude|:)\s+(.+?)\.?$/i.exec(sentence)?.[1] ?? '';
    const found = tail.split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    if (found.length === k && found.every((f) => f.length <= 40)) names = found.map((f) => capital(trimEnd(f)));
    // "Management functions include: Planning, Organizing, …"
    if (names.length < 2) {
      const inline = /include[s]?:?\s+([^.(]+)/i.exec(sentence)?.[1] ?? '';
      const parts = inline.split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) names = parts.map((x) => capital(trimEnd(x)));
    }
  }
  // Explanations follow the naming list in the same order; fall back to matching by name.
  const explanationFor = (name: string, index: number) =>
    (naming && paragraphs.length === names.length ? paragraphs[index]?.explanation : undefined) ??
    paragraphs.find((x) => x.explanation && x.name.toLowerCase().startsWith(name.toLowerCase().slice(0, 10)))?.explanation ??
    '';

  const modelAnswer = trimEnd(stripNotes(answerText)) || null;
  const markingNotes = notes.length ? notes.join('; ') : null;
  let points: SchemePoint[] = [];

  if (names.length >= 2) {
    const perItem = eachMark ?? (listMark != null || explainMark != null ? (listMark ?? 0) + (explainMark ?? 0) : null);
    const need = k ?? names.length;
    if (need < names.length) {
      // "Name 6 terms" with 12 listed: any 6 of them earn marks.
      const per = perItem ?? round(totalMarks / need);
      points = [
        {
          canonicalTerm: `Any ${need} valid points from the list`,
          synonyms: names.slice(0, 30),
          marks: totalMarks,
          required: false,
          notes: `${per} mark${per === 1 ? '' : 's'} for each valid point, up to ${need}${explainMark ? ` (${listMark ?? 0} for naming, ${explainMark} for explaining)` : ''}`,
        },
      ];
    } else {
      const per = perItem ?? round(totalMarks / names.length);
      points = names.map((name, index) => {
        const expl = explanationFor(name, index);
        return {
          canonicalTerm: name,
          synonyms: [],
          marks: per,
          required: false,
          notes: explainMark ? `${listMark ?? 0} for naming it, ${explainMark} for explaining it${expl ? `: ${expl.slice(0, 200)}` : ''}` : null,
        };
      });
      const sum = points.reduce((a, b) => a + b.marks, 0);
      // If the notes don't add up to the question's marks, share the marks evenly instead.
      if (Math.abs(sum - totalMarks) > 0.001) points = points.map((pt) => ({ ...pt, marks: round(totalMarks / points.length) }));
    }
  } else if (modelAnswer) {
    // A definition or short answer: one point, the whole answer.
    points = [
      {
        canonicalTerm: modelAnswer.length > 140 ? `${modelAnswer.slice(0, 137)}…` : modelAnswer,
        synonyms: [],
        marks: totalMarks,
        required: false,
        notes: 'Full marks for an equivalent answer in the candidate’s own words; part marks for a partly correct one',
      },
    ];
  }

  return { label: p.label, type: 'THEORY', body, totalMarks, topic, modelAnswer, markingNotes, points };
}
