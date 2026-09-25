// Simple, deterministic near-duplicate check: Jaccard similarity over word
// sets. Good enough to catch an AI-drafted question that's a light rephrase
// of something already in the bank — the spec explicitly wants these
// visible ("3 near-duplicates skipped"), not silently dropped.
const SIMILARITY_THRESHOLD = 0.7;

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split('')
      .map((ch) => (/[a-z0-9 ]/.test(ch) ? ch : ' '))
      .join('')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isNearDuplicate(candidateBody: string, existingBodies: string[]): boolean {
  const candidateSet = wordSet(candidateBody);
  return existingBodies.some((body) => jaccard(candidateSet, wordSet(body)) >= SIMILARITY_THRESHOLD);
}
