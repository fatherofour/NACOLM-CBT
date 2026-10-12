import { looksLikeMarkingScheme, parseMarkingScheme, requiredCount, schemeLayout } from './marking-scheme-parser.js';

// A made-up excerpt in the same layout as a NACOLM departmental marking
// scheme: header, subject heading, numbered questions with marks, lettered
// sub-parts, SOLUTION blocks, marking notes, page furniture and marks split
// across two lines, a skipped question number, and points explained in a
// different order from the one they were listed in.
const SCHEME = `RESTRICTED
1
RESTRICTED
NIGERIAN ARMY COLLEGE OF LOGISTICS
LOGISTICS DEPARTMENT
Test 2 (IE) Marking Scheme and 1 Question
from Section B.
Time: 2hrs Total Marks: 100%
= = = = = = = = = = =
MOVEMENT CONTROL
SECTION A - OBJECTIVE
1. List the 4 fundamental issues in predicting a requirement. (4 marks)
SOLUTION
a. Destination.
b. Duration.
c. Demand.
d. Distance.
2. A convoy halts on the left of the road keeping its interval (True or False). (1
mark)
3. Name 3 classes of supply. (1.5 marks –(0.5 marks each))
SOLUTION
a. Class I.
b. Class II.
c. Class III.
d. Class IV.
e. Class V.
f. Class VI.
g. Class VII.
h. Class VIII.
i. Class IX.
-- 1 of 2 --
RESTRICTED
2
4. What are the 3 parts of a movement order? (3 marks)
SOLUTION
The 3 parts of a movement order are route, timings and serials.
SECTION B - THEORY
6. a. Define movement control. (2 marks)
SOLUTION
The planning and direction of the movement of forces along lines of communication.
b. List and explain the 2 types of halt used by a convoy? (6
marks)
SOLUTION
i. Short halt.
ii. Long halt (each attracts one mark).
i. Long Halt. A planned stop for refuelling and meals, at a site chosen in the movement order.
ii Short Halt. A brief stop for rest and checks, with vehicles keeping their interval.
(2 marks for explaining each halt).
c. Identify and briefly describe the two attitudes to convoy discipline. (5 marks)
SOLUTION
i. The Careless Driver. Ignores intervals and speed limits, endangering the column.
ii. The Disciplined Driver. Keeps interval, speed and lighting rules at all times, even at night.
(2.5 marks for each)
d. Explain at least 2 safety precautions on a convoy. (4 marks)
SOLUTION
i. Keep the correct interval between vehicles at all times during the move.
ii. Post sentries during every halt so the column is protected from attack.
iii. Brief every driver on the route and emergency drills before departure.
7. a. What is a convoy? (2 marks)
SOLUTION
A group of vehicles moving together under a single commander.
b. Name 2 duties of a convoy commander. (2 marks)
SOLUTION
a. Briefing drivers.
b. Controlling the march.`;

describe('marking scheme parser', () => {
  const qs = parseMarkingScheme(SCHEME);
  const byLabel = Object.fromEntries(qs.map((q) => [q.label, q]));
  const part = (label: string) => {
    const [main, sub] = [label.slice(0, -1), label.slice(-1)];
    return byLabel[main].parts!.find((p) => p.label === sub)!;
  };

  it('recognises the format and reads one question per number', () => {
    expect(looksLikeMarkingScheme(SCHEME)).toBe(true);
    expect(qs.map((q) => q.label)).toEqual(['1', '2', '3', '4', '6', '7']);
    expect(qs.map((q) => q.section)).toEqual(['A', 'A', 'A', 'A', 'B', 'B']);
    expect(qs.every((q) => q.topic === 'Movement Control')).toBe(true);
  });

  it('keeps a question set in parts together, with each part and its marks', () => {
    const q = byLabel['6'];
    expect(q.parts!.map((p) => [p.label, p.totalMarks])).toEqual([['a', 2], ['b', 6], ['c', 5], ['d', 4]]);
    expect(q.totalMarks).toBe(17);
    expect(q.body.split('\n')).toEqual([
      '(a) Define movement control. (2 marks)',
      '(b) List and explain the 2 types of halt used by a convoy? (6 marks)',
      '(c) Identify and briefly describe the two attitudes to convoy discipline. (5 marks)',
      '(d) Explain at least 2 safety precautions on a convoy. (4 marks)',
    ]);
    expect(q.points.map((p) => p.canonicalTerm)).toContain('(b) Short halt');
    expect(q.modelAnswer).toMatch(/^\(a\) The planning and direction/);
    expect(q.markingNotes).toBe('(b) 2 marks for explaining each halt; each attracts one mark; (c) 2.5 marks for each');
  });

  it('reads how the paper is laid out', () => {
    const layout = schemeLayout(SCHEME);
    expect(layout.sections.map((s) => [s.letter, s.title, s.labels, s.marks])).toEqual([
      ['A', 'Objective', ['1', '2', '3', '4'], [4, 1, 1.5, 3]],
      ['B', 'Theory', ['6', '7'], [17, 4]],
    ]);
    expect(layout.choose).toEqual({ count: 1, section: 'B' });
    expect(layout.missingNumbers).toEqual([5]);
  });

  it('reads the paper heading so a printed paper can follow the same template', () => {
    expect(schemeLayout(SCHEME).header).toEqual({
      classification: 'RESTRICTED',
      institution: 'NIGERIAN ARMY COLLEGE OF LOGISTICS',
      department: 'LOGISTICS DEPARTMENT',
      paperTitle: 'Test 2 (IE)',
      course: null,
      time: '2hrs',
      totalMarks: '100%',
      totalLabel: 'Total Marks',
      instruction: null,
      subject: 'Movement Control',
    });
  });

  it('turns a list answer into one key point per item', () => {
    const q = byLabel['1'];
    expect(q).toMatchObject({ type: 'THEORY', body: 'List the 4 fundamental issues in predicting a requirement.', totalMarks: 4 });
    expect(q.points.map((p) => [p.canonicalTerm, p.marks])).toEqual([['Destination', 1], ['Duration', 1], ['Demand', 1], ['Distance', 1]]);
    // Kept as a list, one item per line, so it prints as one.
    expect(q.modelAnswer!.split('\n')).toEqual(['a. Destination.', 'b. Duration.', 'c. Demand.', 'd. Distance']);
  });

  it('reads a true/false question even when its marks run onto the next line', () => {
    expect(byLabel['2']).toMatchObject({ type: 'OBJECTIVE', options: ['True', 'False'], totalMarks: 1 });
  });

  it('marks "name 3 of these 9" as any 3 valid points, keeping all nine as accepted answers', () => {
    const [p] = byLabel['3'].points;
    expect(p.marks).toBe(1.5);
    expect(p.synonyms).toHaveLength(9);
    expect(p.notes).toContain('0.5 marks for each valid point, up to 3');
  });

  it('picks a list out of a sentence answer', () => {
    expect(byLabel['4'].points.map((p) => p.canonicalTerm)).toEqual(['Route', 'Timings', 'Serials']);
  });

  it('treats a definition as one point worth the whole question', () => {
    expect(part('6a').points).toHaveLength(1);
    expect(part('6a').points[0].marks).toBe(2);
    expect(part('6a').modelAnswer).toContain('lines of communication');
  });

  it('combines naming and explaining marks and attaches each explanation to its own point', () => {
    const q = part('6b');
    expect(q.totalMarks).toBe(6);
    expect(q.points.map((p) => [p.canonicalTerm, p.marks])).toEqual([['Short halt', 3], ['Long halt', 3]]);
    // Explained in the opposite order to the list; each explanation still lands on its point.
    expect(q.points[0].notes).toContain('1 for naming it, 2 for explaining it: A brief stop for rest');
    expect(q.points[1].notes).toContain('1 for naming it, 2 for explaining it: A planned stop for refuelling');
    expect(q.markingNotes).toContain('2 marks for explaining each halt');
  });

  it('uses explicit per-item marks and paragraph headings', () => {
    expect(part('6c').points.map((p) => [p.canonicalTerm, p.marks])).toEqual([['The Careless Driver', 2.5], ['The Disciplined Driver', 2.5]]);
  });

  it('allows any 2 of 3 explained precautions', () => {
    expect(part('6d').points[0]).toMatchObject({ canonicalTerm: 'Any 2 valid points from the list', marks: 4 });
  });

  it('every theory scheme, and every part of one, adds up to its marks', () => {
    for (const q of qs.filter((x) => x.type === 'THEORY')) {
      expect(q.points.reduce((s, p) => s + p.marks, 0)).toBeCloseTo(q.totalMarks);
      for (const p of q.parts ?? []) expect(p.points.reduce((s, pt) => s + pt.marks, 0)).toBeCloseTo(p.totalMarks);
    }
  });

  it('reads how many items a question asks for', () => {
    expect(requiredCount('List the 4 performance dimensions')).toBe(4);
    expect(requiredCount('Explain at least 5 stress management techniques')).toBe(5);
    expect(requiredCount('Identify and briefly describe the four attitudes')).toBe(4);
    expect(requiredCount('What is statistics?')).toBeNull();
  });
});
