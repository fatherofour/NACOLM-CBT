import { formatFromLayout, formatTotal, isChoice, pickExact, pickToMarks, sectionInstructions } from './paper-format.js';

// The layout of a NACOLM test: Section A answered in full (25 marks), and
// four 25-mark Section B questions of which candidates answer three.
const LAYOUT = {
  sections: [
    { letter: 'A', title: 'Objective', labels: ['1', '2', '3', '4', '5', '8'], marks: [4, 3, 1, 1, 14, 2], totalMarks: 25 },
    { letter: 'B', title: 'Theory', labels: ['15', '16', '17', '18'], marks: [25, 25, 25, 25], totalMarks: 100 },
  ],
  choose: { count: 3, section: 'B' },
  missingNumbers: [6, 7],
  header: null as never,
};

describe('paper format', () => {
  const format = formatFromLayout(LAYOUT, { id: 'doc1', title: 'Management Test 1' });

  it('turns a past paper layout into sections to fill', () => {
    expect(format.sections).toEqual([
      { letter: 'A', title: 'Objective', marks: 25 },
      { letter: 'B', title: 'Theory', count: 4, choose: 3, marksEach: 25 },
    ]);
    expect(formatTotal(format)).toBe(100);
    expect(sectionInstructions(format.sections[1])).toBe('Answer any 3 of the 4 questions in this section. Each carries 25 marks.');
  });

  it('treats a choice over questions of different marks as a section answered in full', () => {
    const uneven = formatFromLayout({ ...LAYOUT, sections: [{ ...LAYOUT.sections[1], marks: [25, 20, 25, 30] }] }, { id: 'd', title: 't' });
    expect(isChoice(uneven.sections[0])).toBe(false);
  });

  it('fills a section to exactly its marks with whole questions', () => {
    const pool = [4, 3, 1, 1, 1, 1, 1, 2, 5, 1.5, 3, 1.5, 6, 10, 2.5].map((marks, i) => ({ id: i, marks }));
    for (let run = 0; run < 50; run++) {
      const picked = pickToMarks(pool, 25);
      expect(picked.reduce((a, q) => a + q.marks, 0)).toBeCloseTo(25);
      expect(new Set(picked.map((q) => q.id)).size).toBe(picked.length);
    }
  });

  it('draws different questions on different runs when the pool allows', () => {
    const pool = Array.from({ length: 30 }, (_, i) => ({ id: i, marks: 5 }));
    const sets = new Set(Array.from({ length: 10 }, () => pickToMarks(pool, 25).map((q) => q.id).sort().join(',')));
    expect(sets.size).toBeGreaterThan(1);
  });

  it('comes as close as it can below the marks when no exact set exists', () => {
    const picked = pickToMarks([{ marks: 10 }, { marks: 10 }, { marks: 4 }], 25);
    expect(picked.reduce((a, q) => a + q.marks, 0)).toBe(24);
  });

  it('only takes choice questions of exactly the right marks', () => {
    const pool = [25, 25, 20, 25, 25, 25].map((marks, i) => ({ id: i, marks }));
    const picked = pickExact(pool, 4, 25);
    expect(picked).toHaveLength(4);
    expect(picked.every((q) => q.marks === 25)).toBe(true);
  });
});
