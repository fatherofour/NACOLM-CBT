// Reads a NACOLM-style marking scheme: each question with its marks in
// brackets, a "SOLUTION" heading, the model answer, and marking notes such as
// "(each attracts one mark)" or "(2 marks for explaining each skill)". Every
// numbered question becomes one bank question with a model answer and a draft
// marking scheme; a question set in parts (15 a–e) stays one question, its
// parts kept together with their own marks, because candidates answer the
// whole of it. Everything lands as DRAFT for an instructor to check and
// approve; this only saves the typing.

export interface SchemePoint {
  canonicalTerm: string;
  synonyms: string[];
  marks: number;
  required: boolean;
  notes: string | null;
}

export interface SchemePart {
  label: string; // "b"
  body: string;
  totalMarks: number;
  modelAnswer: string | null;
  markingNotes: string | null;
  points: SchemePoint[];
}

export interface SchemeQuestion {
  label: string; // "15"
  section: string | null; // "B"
  type: 'OBJECTIVE' | 'THEORY';
  body: string;
  totalMarks: number;
  options?: string[];
  topic: string | null;
  modelAnswer: string | null;
  markingNotes: string | null;
  points: SchemePoint[];
  parts?: SchemePart[]; // a question set in parts, each with its own marks
}

/** How the paper is laid out, for checking the import against the paper itself. */
export interface SchemeLayout {
  sections: { letter: string; title: string | null; labels: string[]; marks: number[]; totalMarks: number }[];
  // "3 Questions from Section B": candidates choose this many from that section.
  choose: { count: number; section: string } | null;
  // Question numbers skipped in the document (e.g. 8 is followed by 11).
  missingNumbers: number[];
  // The paper's heading, so a printed paper can follow the same template.
  header: PaperHeader;
}

export interface PaperHeader {
  classification: string | null; // "RESTRICTED", printed at the top and bottom of every page
  institution: string | null;
  department: string | null;
  paperTitle: string | null; // "Test 1 (IE)", without "Marking Scheme"
  course: string | null;
  time: string | null;
  totalMarks: string | null; // "100%"
  // What the paper calls its total: "Total Marks" or "HPS" (highest possible score).
  totalLabel?: string | null;
  // "Attempt all questions", as printed under the heading.
  instruction?: string | null;
  subject: string | null; // "Introduction to Management"
}

const NOISE = /^(RESTRICTED|CONFIDENTIAL|SECRET)$|^\d{1,3}$|^--\s*\d+\s*of\s*\d+\s*--$|^=+(\s*=)*$/i;
// "SECTION B - THEORY", "Section A: Objective".
const SECTION = /^SECTION\s+([A-Z])\b\s*(?:[-–—:]\s*(.*))?$/i;
// "… and 3 Questions from Section B": how many the candidate answers from that section.
const CHOOSE = /\b(\d{1,2}|two|three|four|five|six)\s+questions?\s+from\s+section\s+([A-Z])\b/i;
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
  // "List 5 precautions", "the 10 criteria", and a bare "4 purpose of…" at the start.
  const m = /\b(?:the|at\s+least|about|any|list|name|state|give|mention|identify|explain)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(q) ?? /^\s*(\d{1,2})\s+[a-z]/i.exec(q);
  return m ? words(m[1]) : null;
}

/** "LOGISTICS PLANNING TEST 1 IE" → "Logistics Planning Test 1 IE": all-capitals text in title case, keeping abbreviations. */
export const displayCase = (s: string) =>
  s === s.toUpperCase() ? s.split(' ').map((w) => (w.length <= 3 && /^[A-Z]+$/.test(w) && !/^(OF|AND|THE|TO|IN|FOR)$/.test(w)) || /\d/.test(w) ? w : titleCase(w)).join(' ').replace(/^./, (c) => c.toUpperCase()) : s;
export const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(And|Of|The|To|In|For)\b/g, (w) => w.toLowerCase());
export const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const stripNotes = (s: string) => tidy(s.replace(/\((?:[^()]*\bmarks?\b[^()]*|each attracts one mark|one mark each)\)\.?/gi, ''));
const trimEnd = (s: string) => s.replace(/[\s.,;:]+$/, '');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const round = (n: number) => Math.round(n * 100) / 100;

/** Splits "Technical Skills. A technical skill is…" into the point's name and its explanation. */
function headingOf(text: string): { name: string; explanation: string } {
  const m = /^([A-Z][^.:]{2,60})[.:]\s+(.+)$/.exec(text);
  if (m && m[1].split(/\s+/).length <= 8) return { name: tidy(m[1]), explanation: tidy(m[2]) };
  return { name: tidy(text), explanation: '' };
}

interface Part {
  main: number;
  sub: string | null;
  section: string | null;
  header: string[];
  answer: string[];
}

export function looksLikeMarkingScheme(text: string): boolean {
  return text.split(/\r?\n/).filter((l) => SOLUTION.test(l.trim())).length >= 2;
}

export function parseMarkingScheme(raw: string): SchemeQuestion[] {
  return parse(raw).questions;
}

export function schemeLayout(raw: string): SchemeLayout {
  return parse(raw).layout;
}

function parse(raw: string): { questions: SchemeQuestion[]; layout: SchemeLayout } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOISE.test(l));

  // The first all-capitals heading before the questions names the subject.
  const firstQ = lines.findIndex((l) => MAIN_START.test(l));
  const heading = lines.slice(0, Math.max(0, firstQ)).reverse().find((l) => /^[A-Z][A-Z\s&,-]{6,}$/.test(l) && !/COLLEGE|DEPARTMENT|ARMY|SECTION/.test(l));
  const topic = heading ? titleCase(heading) : null;
  const choose = CHOOSE.exec(lines.slice(0, Math.max(0, firstQ)).join(' '));

  // A line starts a question part only if its marks appear within the next
  // few lines; otherwise "a. Cost." in an answer would look like a sub-question.
  const isHeader = (i: number) => {
    const main = MAIN_START.exec(lines[i]);
    const sub = !main && SUB_START.exec(lines[i]);
    if (!main && !sub) return null;
    for (let j = i; j < Math.min(lines.length, i + 4); j++) {
      if (j > i && (SOLUTION.test(lines[j]) || SECTION.test(lines[j]) || MAIN_START.test(lines[j]) || SUB_START.test(lines[j]))) break;
      // "(1" at the end of one line and "mark)" on the next still count.
      if (QUESTION_MARKS.test(lines.slice(i, j + 1).join(' '))) return { main, sub, end: j };
    }
    return null;
  };

  const parts: Part[] = [];
  const stems = new Map<number, string>(); // "16. Answer the following:" before its parts
  const sectionTitles = new Map<string, string | null>();
  let section: string | null = null;
  const enterSection = (m: RegExpExecArray) => {
    section = m[1].toUpperCase();
    sectionTitles.set(section, m[2] ? titleCase(m[2]) : null);
  };
  // The first section heading sits just before the first question.
  for (const l of lines.slice(0, Math.max(0, firstQ))) {
    const m = SECTION.exec(l);
    if (m) enterSection(m);
  }
  let currentMain = 0;
  for (let i = firstQ < 0 ? lines.length : firstQ; i < lines.length; i++) {
    const sec = SECTION.exec(lines[i]);
    if (sec) {
      enterSection(sec);
      continue;
    }
    const h = isHeader(i);
    if (h) {
      let sub: string | null;
      let first: string;
      if (h.main) {
        currentMain = Number(h.main[1]);
        sub = h.main[2]?.toLowerCase() ?? null;
        first = h.main[3];
      } else {
        sub = (h.sub as RegExpExecArray)[1].toLowerCase();
        first = (h.sub as RegExpExecArray)[2];
      }
      parts.push({ main: currentMain, sub, section, header: [first, ...lines.slice(i + 1, h.end + 1)], answer: [] });
      i = h.end;
      continue;
    }
    // A question number with no marks of its own, followed by its lettered parts.
    const stem = MAIN_START.exec(lines[i]);
    if (stem && !stem[2] && Number(stem[1]) > currentMain && [1, 2, 3].some((k) => isHeader(i + k)?.sub)) {
      currentMain = Number(stem[1]);
      stems.set(currentMain, tidy(stem[3]));
      continue;
    }
    if (!parts.length || SOLUTION.test(lines[i])) continue;
    parts[parts.length - 1].answer.push(lines[i]);
  }

  // One question per number; its lettered parts are kept together under it.
  const questions: SchemeQuestion[] = [];
  for (const p of parts) {
    const q = toQuestion(p, topic);
    const prev = questions.at(-1);
    if (p.sub && prev?.parts && prev.label === String(p.main)) prev.parts.push(toPart(p.sub, q));
    else questions.push({ ...q, label: String(p.main), ...(p.sub ? { parts: [toPart(p.sub, q)] } : {}) });
  }
  for (const q of questions) if (q.parts) Object.assign(q, combineParts(q.parts, stems.get(Number(q.label)) ?? null));

  const letters = [...new Set(questions.map((q) => q.section).filter((x): x is string => !!x))];
  const numbers = questions.map((q) => Number(q.label));
  const missingNumbers: number[] = [];
  for (let n = 1; n < Math.max(0, ...numbers); n++) if (!numbers.includes(n)) missingNumbers.push(n);
  const layout: SchemeLayout = {
    sections: letters.map((letter) => {
      const inSection = questions.filter((q) => q.section === letter);
      return {
        letter,
        title: sectionTitles.get(letter) ?? null,
        labels: inSection.map((q) => q.label),
        marks: inSection.map((q) => q.totalMarks),
        totalMarks: round(inSection.reduce((a, q) => a + q.totalMarks, 0)),
      };
    }),
    choose: choose ? { count: words(choose[1]) ?? 0, section: choose[2].toUpperCase() } : null,
    missingNumbers,
    header: readHeader(raw, topic),
  };
  return { questions, layout };
}

/** The heading above the first question: who set the paper, the course, the time and the marks. */
export function readHeader(raw: string, subject: string | null): PaperHeader {
  const all = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const end = all.findIndex((l) => MAIN_START.test(l));
  // A college name broken over two lines: "…COLLEGE OF LOGISTICS" / "AND MANAGEMENT".
  const top = all.slice(0, end < 0 ? 40 : end).reduce<string[]>((out, l) => {
    if (/^AND\s+[A-Z\s]+$/.test(l) && out.length && /\b(COLLEGE|SCHOOL|ACADEMY|INSTITUTE)\b/.test(out[out.length - 1])) out[out.length - 1] += ' ' + l;
    else out.push(l);
    return out;
  }, []);
  const text = top.join('\n');
  const find = (re: RegExp) => tidy(re.exec(text)?.[1] ?? '') || null;
  const titleLine = top.find((l) => /\b(test|exam(ination)?|quiz|assessment)\b/i.test(l) && !/^course\b/i.test(l));
  return {
    classification: top.find((l) => /^(RESTRICTED|CONFIDENTIAL|SECRET|UNCLASSIFIED)$/i.test(l))?.toUpperCase() ?? null,
    institution: top.find((l) => /\b(COLLEGE|SCHOOL|ACADEMY|INSTITUTE|UNIVERSITY)\b/i.test(l) && !/DEPARTMENT/i.test(l)) ?? null,
    department: top.find((l) => /\b(DEPARTMENT|WING|FACULTY|DIVISION)\b/i.test(l)) ?? null,
    // "Test 1 (IE)Marking Scheme (Green) and 3 Questions" → "Test 1 (IE)";
    // "Subject: LOGISTICS PLANNING TEST 1 IE Course: LMC 24/26" → "Logistics Planning Test 1 IE"
    paperTitle: titleLine ? displayCase(tidy(titleLine.replace(/^Subject\s*:\s*/i, '').replace(/\s+Course\s*:.*$/i, '').split(/\s*marking\s+scheme|\s+and\s+\d+\s+questions/i)[0])) || null : null,
    course: find(/Course\s*:\s*(.+?)(?:\s+Answer\b.*)?$/im),
    time: find(/Time(?:\s+Allowed)?\s*:\s*(.+?)(?=\s+(?:Total|HPS|Date)\b|$)/im),
    totalMarks: find(/(?:Total\s+Marks?|HPS)\s*:\s*([\d.]+\s*%?)/i),
    totalLabel: /\bHPS\s*:/i.test(text) ? 'HPS' : /Total\s+Marks?\s*:/i.test(text) ? 'Total Marks' : null,
    instruction: find(/Instructions?\s*:\s*(.+)$/im),
    subject,
  };
}

function toPart(label: string, q: SchemeQuestion): SchemePart {
  return { label, body: q.body, totalMarks: q.totalMarks, modelAnswer: q.modelAnswer, markingNotes: q.markingNotes, points: q.points };
}

/** The whole question as the candidate sees it, with one scheme across all its parts. */
export function combineParts(parts: SchemePart[], stem: string | null): Partial<SchemeQuestion> {
  const tag = (l: string) => `(${l})`;
  const notes = parts.filter((pt) => pt.markingNotes).map((pt) => `${tag(pt.label)} ${pt.markingNotes}`);
  return {
    type: 'THEORY',
    options: undefined,
    body: [...(stem ? [stem] : []), ...parts.map((pt) => `${tag(pt.label)} ${pt.body} (${pt.totalMarks} mark${pt.totalMarks === 1 ? '' : 's'})`)].join('\n'),
    totalMarks: round(parts.reduce((a, pt) => a + pt.totalMarks, 0)),
    modelAnswer: parts.map((pt) => `${tag(pt.label)} ${pt.modelAnswer ?? ''}`.trim()).join('\n\n'),
    markingNotes: notes.length ? notes.join('; ') : null,
    points: parts.flatMap((pt) => pt.points.map((point) => ({ ...point, canonicalTerm: `${tag(pt.label)} ${point.canonicalTerm}` }))),
  };
}

function toQuestion(p: Part, topic: string | null): SchemeQuestion {
  const label = `${p.main}${p.sub ?? ''}`;
  const section = p.section;
  const headerText = tidy(p.header.join(' '));
  const totalMarks = Number(QUESTION_MARKS.exec(headerText)?.[1] ?? 0);
  const body = tidy(headerText.replace(/\(\s*\d+(?:\.\d+)?\s*marks?\b[^)]*\)*\)?\.?/i, ''));
  const answerText = p.answer.join('\n');

  if (TRUE_FALSE.test(body)) {
    return {
      label,
      section,
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
  // Match each explanation to its point by name first, because the points aren't
  // always explained in the order they were listed; otherwise by position.
  // The first two words: "Increasing need…" must not match "Increasing organizational…".
  const key = (s: string) => s.toLowerCase().replace(/^the\s+/, '').split(/\s+/).slice(0, 2).join(' ');
  const explanationFor = (name: string, index: number) =>
    paragraphs.find((x) => x.explanation && key(x.name) === key(name))?.explanation ??
    (naming && paragraphs.length === names.length ? paragraphs[index]?.explanation : undefined) ??
    '';

  // Kept line by line, with wrapped lines rejoined, so lists print as lists.
  const answerLines: string[] = [];
  for (const line of p.answer) {
    const text = stripNotes(line);
    if (!text) continue;
    if (LIST_ITEM.test(line) || !answerLines.length) answerLines.push(text);
    else answerLines[answerLines.length - 1] += ' ' + text;
  }
  const modelAnswer = trimEnd(answerLines.join('\n')) || null;
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

  return { label, section, type: 'THEORY', body, totalMarks, topic, modelAnswer, markingNotes, points };
}
