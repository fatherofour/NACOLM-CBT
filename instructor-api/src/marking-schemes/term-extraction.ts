/**
 * Deterministic, stop-word-filtered term extraction from a model answer —
 * no AI involved. This only pre-populates suggested concept groups for the
 * instructor to edit into real groups; it never becomes a scheme on its own.
 */

const STOP_WORDS = new Set(
  `a an the of to in on for and or but with without within into onto by at is are was were
   be been being this that these those it its as from over under between among not no nor
   can could should would will shall may might must do does did have has had if then than
   so such also only very more most other another each all any some such which who whom
   whose what when where why how their them they he she his her you your our we i`
    .split(/\s+/)
    .filter(Boolean),
);

export interface SuggestedConceptGroup {
  canonicalTerm: string;
  synonyms: string[];
  marks: number;
  required: boolean;
}

export function suggestConceptGroups(modelAnswer: string, totalMarks: number, maxGroups = 5): SuggestedConceptGroup[] {
  const words = modelAnswer
    .toLowerCase()
    .split('')
    .map((ch) => (/[a-z0-9 ]/.test(ch) ? ch : ' '))
    .join('')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const frequency = new Map<string, number>();
  const firstSeenOrder: string[] = [];
  for (const word of words) {
    if (!frequency.has(word)) firstSeenOrder.push(word);
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  const ranked = firstSeenOrder
    .sort((a, b) => (frequency.get(b)! - frequency.get(a)!) || a.localeCompare(b))
    .slice(0, maxGroups);

  if (ranked.length === 0) return [];

  const marksPerGroup = allocateEvenly(totalMarks, ranked.length);

  return ranked.map((word, i) => ({
    canonicalTerm: word,
    synonyms: [],
    marks: marksPerGroup[i],
    required: false,
  }));
}

// Largest-remainder split so the suggested marks actually sum to totalMarks.
function allocateEvenly(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const remainder = total - base * buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < remainder ? 1 : 0));
}
