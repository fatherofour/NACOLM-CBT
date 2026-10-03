// The AI's first draft of a theory marking scheme, from the question and the
// instructor's model answer. It only ever produces a DRAFT: the instructor
// edits it, tests it and approves it before it can mark anything.

export interface DraftPoint {
  canonicalTerm: string;
  marks: number;
  required: boolean;
  synonyms: string[];
  notes: string | null;
}

export interface SampleAnswer {
  label: string;
  text: string;
}

export interface SchemeDraft {
  points: DraftPoint[];
  partialCreditNotes: string | null;
  zeroCreditNotes: string | null;
  samples: SampleAnswer[];
}

export const SAMPLE_LABELS = ['full', 'partial', 'weak', 'off-topic'] as const;

export function draftPrompt(question: string, totalMarks: number, modelAnswer: string): string {
  return `You help a Nigerian Army College instructor build a marking scheme for a handwritten theory exam answer.

Question: ${question}
Total marks: ${totalMarks}

The instructor's model answer (the only source of truth — do not add points it doesn't contain):
"""
${modelAnswer}
"""

Produce:
1. Key points: 2 to 8 distinct points a good answer must show, taken from the model answer. Give each a short name, its marks (all marks must add up to exactly ${totalMarks}; halves are allowed), whether it is required (only if the answer is wrong without it), a note on part marks (e.g. "half if named but not explained"), and 3 to 8 accepted variations: synonyms, paraphrases, military terms and abbreviations a candidate might use, and likely handwriting misreadings.
2. One sentence on how part marks work overall, and one sentence on common wrong answers or padding that earn nothing.
3. Four short sample candidate answers to test the scheme with, written like a student: "full" (deserves full marks), "partial" (about half), "weak" (a quarter or less, vague), "off-topic" (answers something else).

Respond with ONLY JSON of this exact shape:
{"points": [{"name": "...", "marks": 0, "required": false, "partial": "...", "variations": ["..."]}], "partialCredit": "...", "zeroCredit": "...", "samples": [{"label": "full", "text": "..."}, {"label": "partial", "text": "..."}, {"label": "weak", "text": "..."}, {"label": "off-topic", "text": "..."}]}`;
}

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Validates and tidies the model's draft; throws if it is unusable. */
export function parseDraft(raw: string): SchemeDraft {
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
  const d = JSON.parse(jsonText) as {
    points?: { name?: unknown; marks?: unknown; required?: unknown; partial?: unknown; variations?: unknown }[];
    partialCredit?: unknown;
    zeroCredit?: unknown;
    samples?: { label?: unknown; text?: unknown }[];
  };
  if (!Array.isArray(d.points) || !d.points.length) throw new Error('the AI draft had no key points');

  const points: DraftPoint[] = d.points.slice(0, 10).flatMap((p) => {
    const name = clean(p.name, 120);
    if (!name) return [];
    const marks = Number(p.marks);
    const seen = new Set([name.toLowerCase()]);
    const synonyms = (Array.isArray(p.variations) ? p.variations : [])
      .map((v) => clean(v, 80))
      .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
      .slice(0, 12);
    return [{ canonicalTerm: name, marks: Number.isFinite(marks) && marks > 0 ? Math.round(marks * 2) / 2 : 1, required: p.required === true, synonyms, notes: clean(p.partial, 300) || null }];
  });
  if (!points.length) throw new Error('the AI draft had no usable key points');

  const samples: SampleAnswer[] = (Array.isArray(d.samples) ? d.samples : [])
    .map((s) => ({ label: clean(s.label, 20).toLowerCase(), text: clean(s.text, 2000) }))
    .filter((s) => s.text)
    .slice(0, 6);

  return {
    points,
    partialCreditNotes: clean(d.partialCredit, 500) || null,
    zeroCreditNotes: clean(d.zeroCredit, 500) || null,
    samples,
  };
}
