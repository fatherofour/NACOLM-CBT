import { markingPrompt, parseMarking, type SchemeSnapshot } from './marking.js';

const scheme: SchemeSnapshot = {
  totalMarks: 10,
  ceilingPercent: 50,
  minWordCount: 15,
  modelAnswer: 'Ambush risk, road condition, fuel, communications.',
  partialCreditNotes: 'Named but not explained earns half.',
  zeroCreditNotes: 'Weather alone.',
  conceptGroups: [
    { canonicalTerm: 'ambush risk', synonyms: ['enemy attack'], marks: 3, required: true, notes: '1 mark if only named' },
    { canonicalTerm: 'road condition', synonyms: [], marks: 2, required: false },
    { canonicalTerm: 'fuel availability', synonyms: [], marks: 2, required: false },
    { canonicalTerm: 'communication', synonyms: ['radio'], marks: 3, required: false },
  ],
};

describe('marking prompt', () => {
  it('carries the model answer, notes, variations and the per-point output shape', () => {
    const p = markingPrompt('Discuss convoy planning.', scheme, 'answer');
    for (const s of ['Model answer', 'Named but not explained earns half', 'Earns nothing: Weather alone', 'also accept: enemy attack', '1 mark if only named', '"points"']) {
      expect(p).toContain(s);
    }
  });

  it('asks for a holistic score when there are no key points', () => {
    const p = markingPrompt('Q', { ...scheme, conceptGroups: [] }, 'a');
    expect(p).toContain('no key points defined');
    expect(p).not.toContain('"points"');
  });
});

describe('parseMarking', () => {
  it('scores as the sum of points, each capped at its marks', () => {
    const m = parseMarking(
      JSON.stringify({
        points: [
          { point: 'ambush risk', awarded: 5, evidence: 'risk of ambush' },
          { point: 'road condition', awarded: 1.3, evidence: 'roads' },
          { point: 'fuel availability', awarded: 0, evidence: 'missing' },
          { point: 'communication', awarded: 2, evidence: 'radio' },
        ],
        score: 9,
        justification: 'ok',
      }),
      scheme,
    );
    expect(m.points.map((p) => p.awarded)).toEqual([3, 1.25, 0, 2]);
    expect(m.score).toBe(6.25);
  });

  it('caps the total when a required point is missing', () => {
    const m = parseMarking(
      JSON.stringify({
        points: [
          { point: 'ambush risk', awarded: 0 },
          { point: 'road condition', awarded: 2 },
          { point: 'fuel availability', awarded: 2 },
          { point: 'communication', awarded: 3 },
        ],
        score: 7,
        justification: 'x',
      }),
      scheme,
    );
    expect(m.score).toBe(5);
  });

  it('matches points by position when the model renames them', () => {
    const m = parseMarking('{"points":[{"point":"Ambush!","awarded":3},{"point":"x","awarded":2}],"score":5,"justification":"j"}', scheme);
    expect(m.points[0].awarded).toBe(3);
    expect(m.points[1].awarded).toBe(2);
    expect(m.points[2].awarded).toBe(0);
  });

  it('falls back to the holistic score and clamps it', () => {
    expect(parseMarking('noise {"score": 14, "justification": "j"}', { ...scheme, conceptGroups: [] }).score).toBe(10);
    expect(() => parseMarking('{"justification":"no score"}', { ...scheme, conceptGroups: [] })).toThrow();
  });
});
