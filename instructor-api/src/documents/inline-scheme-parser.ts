// Reads a marking scheme written without SOLUTION headings, where each
// answer follows its question directly (the Logistics Planning layout):
//
//   1. … answers to the following questions: (6mks).     ← question with parts
//   a. 4 purpose of establishing a support area.          ← part (a)
//   (1) To reduce the amount of transport …               ← its answer, item by item
//   2. … the 5 purpose of logistics. (5mks).              ← question without parts
//   a. To facilitate movement and fire.                   ← lettered answer items
//   3. Write a brief note on … the following (10mks):
//   a. Support Area. A support area is …                  ← term (the part) and answer on one line
//   4a. What is LPB? (3mks).  …  b. What is the purpose of LPB? (3mks).
//
// Lettered lines are parts when the question asks about "the following", or
// when they read as a question with marks ("b. What is …? (7.5mks)");
// otherwise they are answer items. Marks notes such as "(Any 5 for 5 marks)",
// "(0.5mks for each correct listed item)" and "(2mks)" after an explained
// point become the key points' marks. Everything lands as DRAFT for an
// instructor to check, like the SOLUTION layout.
import {
  combineParts,
  displayCase,
  readHeader,
  requiredCount,
  round,
  tidy,
  type SchemeLayout,
  type SchemePart,
  type SchemePoint,
  type SchemeQuestion,
} from './marking-scheme-parser.js';

const NOISE = /^(RESTRICTED|CONFIDENTIAL|SECRET|UNCLASSIFIED)$|^\d{1,3}$|^--\s*\d+\s*of\s*\d+\s*--$|^=+(\s*=)*$/i;
const SOLUTION = /^(SOLUTIONS?|ANSWERS?|MARKING\s+GUIDE|MODEL\s+ANSWER)\s*:?\s*$/i;
const MAIN = /^(\d{1,2})([a-z])?\.\s+(.*)$/;
const LETTER = /^([a-zA-Z])\.\s+(.*)$/;
const PAREN = /^\((\d{1,2}|[a-z]|[ivx]{1,4})\)\s+(.*)$/;
// "(6mks)", "(7.5mks)", "(3 marks)": a question's or an item's marks.
const MARKS = /\(\s*(\d+(?:\.\d+)?)\s*(?:mks?|marks?)\s*\)\.?/i;
const ENDS_WITH_MARKS = /\(\s*\d+(?:\.\d+)?\s*(?:mks?|marks?)\s*\)\.?\s*$/i;
// "(1mk for each correct listing)", "(0.5mks for each correct listed item)"
const PER_LISTING = /\(\s*(\d+(?:\.\d+)?)\s*(?:mks?|marks?)\s+for\s+each\b[^)]*\)\.?/i;
// "(Any 5 for 5 marks)"
const ANY_K = /\(\s*any\s+(\d{1,2})\s+for\s+\d+(?:\.\d+)?\s*(?:mks?|marks?)\s*\)\.?/i;
const ASKS = /\?|\b(what|which|why|how|list|mention|explain|state|describe|define|give|name|write|outline|identify|discuss|enumerate|highlight|differentiate|compare|distinguish)\b/i;
const FOLLOWING = /\bthe following\b/i;
// "Support Area. A support area is…": a term and its explanation.
const TERM = /^([A-Z][^.:?]{1,60}?)[.:]\s+(\S.{15,})$/;
// "Reverse logistics handles the flow…": a term with no full stop after it.
const TERM_VERB = /^(.{3,60}?)\s+(?:is|are|handles|means|refers to|involves|deals with)\s/;
const PARAPHRASE_NOTE = 'Full marks for an equivalent answer in the candidate’s own words; part marks for a partly correct one';

interface Block {
  kind: 'main' | 'letter' | 'paren' | 'text';
  label: string; // "3", "a", "(1)", or "" for a paragraph
  sub?: string; // "a" in "4a."
  text: string;
}

interface Part {
  label: string | null;
  question: string;
  answers: Block[];
  marks?: number | null; // set from the question for parts without their own marks
}

interface Main {
  number: number;
  stem: string;
  following: boolean;
  parts: Part[];
  stemAnswers: Block[];
}

const nextLetter = (l: string) => String.fromCharCode(l.charCodeAt(0) + 1);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const marksIn = (s: string) => {
  const cleaned = s.replace(PER_LISTING, '').replace(ANY_K, '');
  const m = MARKS.exec(cleaned);
  return m ? Number(m[1]) : null;
};

/** Lines grouped into numbered questions, lettered and bracketed items, and paragraphs. */
function toBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let lastMain = 0;
  for (const line of lines) {
    const main = MAIN.exec(line);
    if (main && Number(main[1]) > lastMain && Number(main[1]) <= lastMain + 3) {
      lastMain = Number(main[1]);
      out.push({ kind: 'main', label: main[1], sub: main[2], text: main[3] });
      continue;
    }
    if (!lastMain) continue; // the heading
    const paren = PAREN.exec(line);
    if (paren) {
      out.push({ kind: 'paren', label: `(${paren[1]})`, text: paren[2] });
      continue;
    }
    const letter = LETTER.exec(line);
    if (letter) {
      out.push({ kind: 'letter', label: letter[1].toLowerCase(), text: letter[2] });
      continue;
    }
    const prev = out[out.length - 1];
    // An explained point whose number was left off, after one that ended with its marks: "Destination. Destination focuses…"
    if (prev.kind !== 'main' && ENDS_WITH_MARKS.test(prev.text) && /^[A-Z][A-Za-z ]{2,40}\.\s+[A-Z]/.test(line)) {
      out.push({ kind: 'paren', label: '', text: line });
      continue;
    }
    // An answer paragraph after a question ending with its marks, a "?" or a ":", or after a short title line.
    const titleLine = prev.kind === 'letter' && words(prev.text) <= 10 && !/[.?:!)]$/.test(prev.text);
    if (ENDS_WITH_MARKS.test(prev.text) || /[?:]$/.test(prev.text) || titleLine) {
      out.push({ kind: 'text', label: '', text: line });
      continue;
    }
    prev.text += ' ' + line;
  }
  return out;
}

/** Numbered questions with their parts and answers. */
function toMains(blocks: Block[]): Main[] {
  const mains: Main[] = [];
  for (const b of blocks) {
    if (b.kind === 'main') {
      mains.push({
        number: Number(b.label),
        stem: b.sub ? '' : b.text,
        following: !b.sub && FOLLOWING.test(b.text),
        parts: b.sub ? [{ label: b.sub, question: b.text, answers: [] }] : [],
        stemAnswers: [],
      });
      continue;
    }
    const cur = mains[mains.length - 1];
    const last = cur.parts[cur.parts.length - 1];
    const expected = last?.label ? nextLetter(last.label) : cur.stemAnswers.length ? 'b' : 'a';
    const isPart =
      b.kind === 'letter' &&
      b.label === expected &&
      (cur.following || (ASKS.test(b.text) && (marksIn(b.text) != null || b.text.includes('?'))));
    if (isPart) {
      // A question answered directly, then a lettered part: the question itself was part (a).
      if (!cur.parts.length && !cur.following && cur.stem) {
        cur.parts.push({ label: 'a', question: cur.stem, answers: cur.stemAnswers });
        cur.stem = '';
        cur.stemAnswers = [];
      }
      cur.parts.push({ label: b.label, question: b.text, answers: [] });
    } else if (last) {
      last.answers.push(b);
    } else {
      cur.stemAnswers.push(b);
    }
  }
  return mains;
}

/** A question (or one part of one) and its answer, as a model answer and key points with marks. */
function buildPart(label: string | null, questionRaw: string, answers: Block[], inherited: number | null): SchemePart {
  const notes: string[] = [];
  let listMark: number | null = null;
  let anyK: number | null = null;
  const takeNotes = (t: string) => {
    const pl = PER_LISTING.exec(t);
    if (pl) {
      listMark ??= Number(pl[1]);
      notes.push(tidy(pl[0].replace(/^\(|\)\.?$/g, '')));
    }
    const ak = ANY_K.exec(t);
    if (ak) {
      anyK ??= Number(ak[1]);
      notes.push(tidy(ak[0].replace(/^\(|\)\.?$/g, '')));
    }
    return t.replace(PER_LISTING, '').replace(ANY_K, '');
  };

  const q = takeNotes(questionRaw);
  const total = marksIn(questionRaw) ?? inherited;
  const body = tidy(q.replace(MARKS, '')).replace(/[\s:]+$/, '');

  const items = answers.map((a) => {
    const t = takeNotes(a.text);
    const m = MARKS.exec(t);
    return { label: a.label, kind: a.kind, text: tidy(t.replace(MARKS, '')), marks: m ? Number(m[1]) : null };
  });
  const modelAnswer =
    items
      .map((i) => (i.label ? `${i.kind === 'letter' ? `${i.label}.` : i.label} ${i.text}` : i.text))
      .join('\n')
      .trim() || null;

  const named = (t: string) => {
    const m = TERM.exec(t);
    return m && words(m[1]) <= 8 ? m[1].trim() : null;
  };
  const termOf = (t: string) => named(t) ?? (t.length > 140 ? `${t.slice(0, 137)}…` : t.replace(/[.;]$/, ''));

  let points: SchemePoint[] = [];
  const k = anyK ?? requiredCount(body);
  if (items.some((i) => i.marks != null)) {
    // Explained points carry their own marks; a list of names may carry marks per name.
    const listing = items.filter((i) => i.marks == null && !i.label);
    const explained = items.filter((i) => i.marks != null);
    if (listing.length && listMark != null) {
      const names = listing
        .map((i) => i.text)
        .join(', ')
        .replace(/\bOthers are\b/gi, ',')
        .split(/,|\band\b|\./)
        .map((n) => n.trim())
        .filter((n) => n.length > 1);
      points.push({ canonicalTerm: `Lists all ${names.length}`, synonyms: names, marks: round(listMark * names.length), required: false, notes: `${listMark} for each one correctly listed` });
    }
    const perName = !listing.length && listMark != null ? listMark : 0;
    points.push(
      ...explained.map((i) => ({
        canonicalTerm: termOf(i.text),
        synonyms: [],
        marks: round(i.marks! + perName),
        required: false,
        notes: perName ? `${perName} for naming it, ${i.marks} for explaining it` : `${i.marks} for explaining it`,
      })),
    );
  } else if (items.length === 1 || (items.length && items.every((i) => !i.label))) {
    const text = items.map((i) => i.text).join(' ');
    const marks = total ?? 1;
    points = [{ canonicalTerm: text.length > 140 ? `${text.slice(0, 137)}…` : text, synonyms: [], marks, required: false, notes: PARAPHRASE_NOTE }];
  } else if (items.length) {
    const marks = total ?? items.length;
    if (k && k < items.length) {
      // "Mention 5 IT tools" with 8 listed: any 5 earn marks.
      points = [
        {
          canonicalTerm: `Any ${k} valid points from the list`,
          synonyms: items.map((i) => termOf(i.text)).slice(0, 30),
          marks,
          required: false,
          notes: `${round(marks / k)} mark${marks / k === 1 ? '' : 's'} for each valid point, up to ${k}`,
        },
      ];
    } else {
      const per = round(marks / items.length);
      points = items.map((i) => ({ canonicalTerm: termOf(i.text), synonyms: [], marks: per, required: false, notes: null }));
      // Rounding: the last point takes up any difference, so the scheme adds up.
      const diff = round(marks - per * items.length);
      if (diff) points[points.length - 1].marks = round(points[points.length - 1].marks + diff);
    }
  }
  const totalMarks = total ?? round(points.reduce((a, p) => a + p.marks, 0));
  return { label: label ?? '', body, totalMarks, modelAnswer, markingNotes: notes.length ? notes.join('; ') : null, points };
}

/** Parts of a question about "the following" written as "Term. Explanation": the term is the part, the rest its answer. */
function splitTerm(part: Part): Part {
  if (part.answers.length) return part;
  const text = tidy(part.question.replace(MARKS, ''));
  const t = TERM.exec(text);
  if (t && words(t[1]) <= 8) return { ...part, question: `${t[1].trim()}.${marksIn(part.question) != null ? ` (${marksIn(part.question)}mks)` : ''}`, answers: [{ kind: 'text', label: '', text: t[2] }] };
  const v = TERM_VERB.exec(text);
  if (v) return { ...part, question: `${v[1].trim()}.`, answers: [{ kind: 'text', label: '', text }] };
  return part;
}

function parse(raw: string): { questions: SchemeQuestion[]; layout: SchemeLayout; answeredShare: number } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOISE.test(l));
  // "Subject: LOGISTICS PLANNING TEST 1 IE" → topic "Logistics Planning"
  const subjectLine = /Subject\s*:\s*(.+?)(?=\s+Course\s*:|$)/im.exec(lines.slice(0, 12).join('\n'))?.[1] ?? null;
  const topic = subjectLine ? displayCase(tidy(subjectLine.replace(/\s+(test|exam(ination)?|quiz|assessment)\b.*$/i, ''))) || null : null;

  const mains = toMains(toBlocks(lines));
  let parts = 0;
  let answered = 0;
  const questions: SchemeQuestion[] = mains.map((m) => {
    const stemMarks = marksIn(m.stem);
    if (!m.parts.length) {
      parts++;
      if (m.stemAnswers.length) answered++;
      const p = buildPart(null, m.stem, m.stemAnswers, null);
      return { label: String(m.number), section: '', type: 'THEORY', body: p.body, totalMarks: p.totalMarks, topic, modelAnswer: p.modelAnswer, markingNotes: p.markingNotes, points: p.points };
    }
    let list = m.following ? m.parts.map(splitTerm) : m.parts;
    // The question's own marks: for its first part when only that one has none ("…the following questions: (6mks)" then "a." without marks), otherwise shared by parts without marks.
    const missing = list.filter((p) => marksIn(p.question) == null);
    if (stemMarks != null && missing.length) {
      list = list.map((p) =>
        marksIn(p.question) != null ? p : { ...p, marks: missing.length === 1 ? stemMarks : round(stemMarks / missing.length) },
      );
    }
    const built = list.map((p) => {
      parts++;
      if (p.answers.length) answered++;
      return buildPart(p.label, p.question, p.answers, p.marks ?? null);
    });
    const stem = tidy(m.stem.replace(MARKS, '')).replace(/[\s:]+$/, '');
    return { label: String(m.number), section: '', type: 'THEORY', topic, body: '', totalMarks: 0, modelAnswer: null, markingNotes: null, points: [], parts: built, ...combineParts(built, stem ? `${stem}:` : null) } as SchemeQuestion;
  });

  const numbers = questions.map((q) => Number(q.label));
  const missingNumbers: number[] = [];
  for (let n = 1; n < Math.max(0, ...numbers); n++) if (!numbers.includes(n)) missingNumbers.push(n);
  const layout: SchemeLayout = {
    sections: questions.length
      ? [{ letter: '', title: null, labels: questions.map((q) => q.label), marks: questions.map((q) => q.totalMarks), totalMarks: round(questions.reduce((a, q) => a + q.totalMarks, 0)) }]
      : [],
    choose: null,
    missingNumbers,
    header: readHeader(raw, topic),
  };
  return { questions, layout, answeredShare: parts ? answered / parts : 0 };
}

/** A marking scheme with answers written straight after their questions (not a blank question paper). */
export function looksLikeInlineScheme(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.filter((l) => SOLUTION.test(l)).length >= 2) return false;
  if (lines.filter((l) => MARKS.test(l) || PER_LISTING.test(l)).length < 3) return false;
  const { questions, answeredShare } = parse(text);
  return questions.length >= 2 && answeredShare >= 0.6;
}

export function parseInlineScheme(text: string): { questions: SchemeQuestion[]; layout: SchemeLayout } {
  const { questions, layout } = parse(text);
  return { questions, layout };
}
