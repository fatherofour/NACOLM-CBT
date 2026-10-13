// Splits a whole handwritten script into one answer per question. Candidates
// write on the printed question paper, so the AI's transcript of each page
// runs: printed question 1, the candidate's answer, printed question 2, ...
// with an answer often carrying over onto the next page.
//
// A printed question is found by its number AND its opening words, since the
// candidate's own numbered points ("1. To reduce ...") start the same way.
// Questions are printed in order, so each is looked for after the previous one.

export interface ScriptQuestion {
  questionId: string;
  number: number; // as printed on the paper: 1, 2, 3 ...
  body: string;
}

export interface SplitAnswer {
  questionId: string;
  number: number;
  found: boolean;
  text: string; // printed part labels kept, so the marker sees which part each answer is for
  pages: number[]; // 0-based pages the answer is on
  answered: boolean; // anything handwritten besides the printed question
}

const STOP = new Set(['the', 'and', 'for', 'you', 'are', 'what', 'that', 'with', 'this', 'your', 'from', 'which', 'following', 'mks', 'marks', 'mark']);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

const LINE_BREAK = /\r?\n/;

// Examiner's scores ("15.5", "(6)"), headers and footers: not the candidate's answer.
const NOISE = [/^\s*restricted\s*$/i, /^\s*section\s+[a-z]\b[^a-z]*(?:objective|theory|essay)?\s*$/i, /^\s*[([]?\d{1,3}(?:\.\d+)?\s*(?:\/\s*\d{1,3})?[)\]]?\s*$/, /^\s*(?:page\s*)?\d{1,2}\s*$/i];

// An examiner's tick or cross after a point ("Simplicity X") is not the candidate's.
const EXAMINER_MARK = /\s+[Xx✓✔✗✘×]\s*$/u;

/** The opening words a printed question is recognised by: its stem, or its first part when it has no stem. */
export function leadWords(body: string): string[] {
  const first = body
    .split(LINE_BREAK)
    .map((l) => l.replace(/^\s*\(?[a-z]\)\s*/i, '').trim())
    .find((l) => words(l).length >= 2);
  return words(first ?? body).slice(0, 12);
}

/** Each lettered part's opening words, for when the question's own opening line is not on the script. */
function partLeads(body: string): string[][] {
  return body
    .split(LINE_BREAK)
    .filter((l) => /^\s*\([a-z]\)\s/i.test(l))
    .map((l) => words(l.replace(/^\s*\([a-z]\)\s*/i, '').replace(/\(\s*\d+(?:\.\d+)?\s*marks?\s*\)/i, '')).slice(0, 8))
    .filter((lead) => lead.length >= 2);
}

/** Share of the lead words that appear in the text. */
function overlap(lead: string[], text: string): number {
  if (!lead.length) return 0;
  const have = new Set(words(text));
  return lead.filter((w) => have.has(w)).length / lead.length;
}

const startsWithNumber = (line: string, n: number) => new RegExp(`^\\s*(?:q(?:uestion)?\\.?\\s*)?${n}\\s*(?:[a-z]\\s*)?[.):]`, 'i').test(line);

export function splitScript(pages: string[], questions: ScriptQuestion[]): SplitAnswer[] {
  const lines: { text: string; page: number }[] = [];
  pages.forEach((p, page) => {
    for (const raw of p.split(LINE_BREAK)) {
      const text = raw.replace(/\[(?:Q|A)\]\s*/g, '').replace(EXAMINER_MARK, '').trimEnd();
      if (text.trim() && !NOISE.some((re) => re.test(text))) lines.push({ text, page });
    }
  });
  const window = (i: number) => lines.slice(i, i + 3).map((l) => l.text).join(' ');
  // The numbered line itself must carry the question's wording, or a candidate's
  // "5. Evaluation of course of action" just above the real question 5 would
  // borrow its words. Only a bare number on its own line looks at the next one.
  const head = (i: number) => (words(lines[i].text).length ? lines[i].text : window(i));

  // Where each question starts; -1 when it can't be found.
  const starts: number[] = [];
  let from = 0;
  for (const q of questions) {
    const lead = leadWords(q.body);
    let at = -1;
    for (let i = from; i < lines.length && at < 0; i++) {
      if (startsWithNumber(lines[i].text, q.number) && overlap(lead, head(i)) >= 0.3 && overlap(lead, window(i)) >= 0.5) at = i;
    }
    // The AI sometimes drops the printed number; then the wording has to match closely.
    for (let i = from; i < lines.length && at < 0; i++) {
      if (overlap(lead, head(i)) >= 0.5 && overlap(lead, window(i)) >= 0.75) at = i;
    }
    // Its opening line may be on a page that is missing: find it by one of its
    // lettered parts, whose title must open the line ("b. Cross Loading. When ...").
    for (const part of partLeads(q.body)) {
      if (at >= 0) break;
      const partSet = new Set(part);
      for (let i = from; i < lines.length && at < 0; i++) {
        if (!/^\s*(?:\d{1,2}\s*)?[a-z]\s*[.)]/i.test(lines[i].text)) continue;
        const opening = words(lines[i].text).slice(0, part.length);
        if (overlap(part, lines[i].text) >= 0.8 && opening.filter((w) => partSet.has(w)).length / opening.length >= 0.6) at = i;
      }
    }
    starts.push(at);
    if (at >= 0) from = at + 1;
  }

  const bodyWords = questions.map((q) => new Set(words(q.body)));
  return questions.map((q, k) => {
    const start = starts[k];
    if (start < 0) return { questionId: q.questionId, number: q.number, found: false, text: '', pages: [], answered: false };
    const end = starts.slice(k + 1).find((s) => s >= 0) ?? lines.length;
    const own = lines.slice(start, end);
    // A line is printed question text when nearly all its words are in the question.
    const handwritten = own.filter((l) => {
      const w = words(l.text);
      return w.length && w.filter((x) => bodyWords[k].has(x)).length / w.length < 0.7;
    });
    return {
      questionId: q.questionId,
      number: q.number,
      found: true,
      text: own.map((l) => l.text).join('\n'),
      pages: [...new Set(own.map((l) => l.page))],
      // "[illegible]" is the AI's placeholder, not the candidate's writing: a blank answer
      // space often comes back as a row of them.
      answered: handwritten.reduce((n, l) => n + (l.text.replace(/\[illegible\]/gi, '').match(/[a-z]/gi)?.length ?? 0), 0) >= 10,
    };
  });
}
