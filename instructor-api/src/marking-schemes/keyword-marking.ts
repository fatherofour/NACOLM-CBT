/**
 * Keyword marking scheme scorer — ported line-for-line from the offline
 * engine that actually runs at the exam centre
 * (local-exam-server/internal/marking/keyword.go). This is what makes
 * Screen 3's "test your scheme" box meaningful: it must produce the exact
 * same score the offline engine would produce for the same answer, or an
 * instructor could approve a scheme here that behaves differently on exam
 * day. Any change to the matching/scoring rules must be made in both
 * places, ideally with the worked examples in both test suites kept in
 * sync.
 *
 * Deliberately a simple heuristic, not a real stemmer: exact match, or a
 * shared 4+ character prefix (so "convoy"/"convoys" and "secured"/"security"
 * match without a dictionary). Known limitation: it won't bridge irregular
 * pairs like "timing"/"timed" — the instructor's synonym list is the real
 * defense against that gap, this is a bonus on top of it.
 */

export interface ConceptGroupInput {
  label: string; // shown to the instructor, not matched against
  terms: string[]; // canonical term + synonyms, all equally matchable
  marks: number;
  required: boolean;
}

export interface MarkingSchemeInput {
  totalMarks: number;
  groups: ConceptGroupInput[];
  requiredGroupCeilingPercent: number;
  minWordCount: number;
}

export interface MarkingResult {
  score: number;
  maxScore: number;
  matchedGroups: string[];
  missingGroups: string[];
  requiredGroupMissing: boolean;
  flaggedTooShort: boolean;
  wordCount: number;
}

export function scoreAnswer(answer: string, scheme: MarkingSchemeInput): MarkingResult {
  const tokens = tokenize(answer);
  const wordCount = tokens.length;
  const tooShort = wordCount < scheme.minWordCount;

  const matched: string[] = [];
  const missing: string[] = [];
  let raw = 0;
  let requiredMissing = false;

  for (const group of scheme.groups) {
    if (matchesGroup(tokens, group)) {
      matched.push(group.label);
      raw += group.marks;
    } else {
      missing.push(group.label);
      if (group.required) requiredMissing = true;
    }
  }

  let score = raw;
  if (requiredMissing) {
    const ceiling = Math.floor((scheme.totalMarks * scheme.requiredGroupCeilingPercent) / 100);
    if (score > ceiling) score = ceiling;
  }
  if (score > scheme.totalMarks) score = scheme.totalMarks;
  if (tooShort) {
    // Deliberately zeroed, not just flagged-but-scored: an answer this short
    // auto-crediting any marks at all is the exact keyword-stuffing failure
    // mode this guard exists to close.
    score = 0;
  }

  return {
    score,
    maxScore: scheme.totalMarks,
    matchedGroups: matched,
    missingGroups: missing,
    requiredGroupMissing: requiredMissing,
    flaggedTooShort: tooShort,
    wordCount,
  };
}

function matchesGroup(tokens: string[], group: ConceptGroupInput): boolean {
  for (const term of group.terms) {
    if (termPresent(tokens, term)) return true; // first hit counts — repeats don't add marks
  }
  return false;
}

// Multi-word terms ("ambush risk") match if every word in the term appears
// somewhere in the answer, not necessarily adjacent.
function termPresent(tokens: string[], term: string): boolean {
  const termWords = term.toLowerCase().split(/\s+/).filter(Boolean);
  return termWords.every((termWord) => tokens.some((tok) => wordMatches(termWord, tok)));
}

function wordMatches(term: string, candidate: string): boolean {
  if (term === candidate) return true;
  const prefixLen = 4;
  if (term.length < prefixLen || candidate.length < prefixLen) return false;
  return term.slice(0, prefixLen) === candidate.slice(0, prefixLen);
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .split('')
    .map((ch) => (/[a-z0-9 ]/.test(ch) ? ch : ' '))
    .join('');
  return normalized.split(/\s+/).filter(Boolean);
}
