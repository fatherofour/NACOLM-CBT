// Fisher-Yates shuffle — returns a new array, never mutates the input. Used
// at authoring time to pick a varied sample of past-paper questions instead
// of always the same rows in database order; this is not the exam-time
// randomization that matters for exam security (see local-exam-server's
// internal/randomize for that, which is salted and seeded per candidate).
export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
