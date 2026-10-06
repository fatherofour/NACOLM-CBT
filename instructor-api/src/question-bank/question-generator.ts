// Prompt and parsing for writing new theory questions from past ones with
// the local model. Grounded on the past question's own model answer, so the
// new question tests course content the department has already set, not
// whatever the model happens to know.

export interface SeedQuestion {
  body: string;
  topic: string;
  totalMarks: number;
  modelAnswer: string;
}

export interface GeneratedQuestion {
  body: string;
  totalMarks: number;
  modelAnswer: string;
}

export function generatePrompt(seed: SeedQuestion): string {
  return `You help a Nigerian Army College instructor set new exam questions from past ones.

Past question (${seed.totalMarks} marks), topic "${seed.topic}":
${seed.body}

Its model answer from the department's marking scheme:
"""
${seed.modelAnswer}
"""

Write ONE new theory question that tests the same knowledge but is not a copy. Change the angle: a different command word (explain, compare, apply, justify), a different combination of the points, or apply the points to a short military logistics scenario. Use only the facts in the model answer above; do not introduce anything it does not contain.

Rules:
- The question must stand on its own for a candidate in the exam hall. Never mention "the model answer", "the list above", "the past question" or anything the candidate cannot see; name the points or the topic instead.
- The new model answer must answer the NEW question. If the question asks how or why, explain each point in that context; do not just repeat the old list.
- Keep the marks close to the original and say in the model answer how the marks are shared between the points.

Respond with ONLY JSON of this exact shape:
{"question": "...", "marks": 0, "modelAnswer": "..."}`;
}

export function parseGenerated(raw: string, fallbackMarks: number): GeneratedQuestion {
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
  const d = JSON.parse(jsonText) as { question?: unknown; marks?: unknown; modelAnswer?: unknown };
  const body = String(d.question ?? '').replace(/\s+/g, ' ').trim();
  const modelAnswer = String(d.modelAnswer ?? '').trim();
  if (body.length < 15 || modelAnswer.length < 10) throw new Error('the AI did not return a usable question');
  const marks = Number(d.marks);
  return { body: body.slice(0, 1500), modelAnswer: modelAnswer.slice(0, 5000), totalMarks: Number.isFinite(marks) && marks > 0 && marks <= 50 ? Math.round(marks * 2) / 2 : fallbackMarks };
}
