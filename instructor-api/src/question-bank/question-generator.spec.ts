import { generatePrompt, parseGenerated } from './question-generator.js';

describe('question generator', () => {
  it('grounds the prompt in the past question and its model answer', () => {
    const p = generatePrompt({ body: 'List the 4Ds.', topic: 'Logistics planning', totalMarks: 4, modelAnswer: 'Destination, duration, demand, distance.' });
    expect(p).toContain('Destination, duration, demand, distance.');
    expect(p).toContain('do not introduce anything it does not contain');
  });

  it('reads the model reply and keeps sensible marks', () => {
    const q = parseGenerated('ok {"question": "Explain how distance affects a convoy plan.", "marks": 5.3, "modelAnswer": "Longer lines of communication need more lift and time."}', 4);
    expect(q).toEqual({ body: 'Explain how distance affects a convoy plan.', totalMarks: 5.5, modelAnswer: 'Longer lines of communication need more lift and time.' });
    expect(parseGenerated('{"question": "Explain how distance affects a convoy plan.", "marks": 900, "modelAnswer": "Because lift and time."}', 4).totalMarks).toBe(4);
  });

  it('rejects an unusable reply', () => {
    expect(() => parseGenerated('{"question": "Hi"}', 4)).toThrow();
  });
});
