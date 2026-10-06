import { looksLikeMarkingScheme, parseMarkingScheme, requiredCount } from './marking-scheme-parser.js';

// A made-up excerpt in the same layout as a NACOLM departmental marking
// scheme: header, subject heading, numbered questions with marks, lettered
// sub-parts, SOLUTION blocks, marking notes, page furniture and marks split
// across two lines.
const SCHEME = `RESTRICTED
1
RESTRICTED
NIGERIAN ARMY COLLEGE OF LOGISTICS
LOGISTICS DEPARTMENT
Test 2 (IE) Marking Scheme and 3 Questions
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
5. a. Define movement control. (2 marks)
SOLUTION
The planning and direction of the movement of forces along lines of communication.
b. List and explain the 2 types of halt used by a convoy? (6
marks)
SOLUTION
i. Short halt.
ii. Long halt (each attracts one mark).
i Short Halt. A brief stop for rest and checks, with vehicles keeping their interval.
ii. Long Halt. A planned stop for refuelling and meals, at a site chosen in the movement order.
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
iii. Brief every driver on the route and emergency drills before departure.`;

describe('marking scheme parser', () => {
  const qs = parseMarkingScheme(SCHEME);
  const byLabel = Object.fromEntries(qs.map((q) => [q.label, q]));

  it('recognises the format and reads every question part', () => {
    expect(looksLikeMarkingScheme(SCHEME)).toBe(true);
    expect(qs.map((q) => q.label)).toEqual(['1', '2', '3', '4', '5a', '5b', '5c', '5d']);
    expect(qs.every((q) => q.topic === 'Movement Control')).toBe(true);
  });

  it('turns a list answer into one key point per item', () => {
    const q = byLabel['1'];
    expect(q).toMatchObject({ type: 'THEORY', body: 'List the 4 fundamental issues in predicting a requirement.', totalMarks: 4 });
    expect(q.points.map((p) => [p.canonicalTerm, p.marks])).toEqual([['Destination', 1], ['Duration', 1], ['Demand', 1], ['Distance', 1]]);
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
    expect(byLabel['5a'].points).toHaveLength(1);
    expect(byLabel['5a'].points[0].marks).toBe(2);
    expect(byLabel['5a'].modelAnswer).toContain('lines of communication');
  });

  it('combines naming and explaining marks and attaches each explanation', () => {
    const q = byLabel['5b'];
    expect(q.totalMarks).toBe(6);
    expect(q.points.map((p) => [p.canonicalTerm, p.marks])).toEqual([['Short halt', 3], ['Long halt', 3]]);
    expect(q.points[1].notes).toContain('1 for naming it, 2 for explaining it: A planned stop for refuelling');
    expect(q.markingNotes).toContain('2 marks for explaining each halt');
  });

  it('uses explicit per-item marks and paragraph headings', () => {
    expect(byLabel['5c'].points.map((p) => [p.canonicalTerm, p.marks])).toEqual([['The Careless Driver', 2.5], ['The Disciplined Driver', 2.5]]);
  });

  it('allows any 2 of 3 explained precautions', () => {
    expect(byLabel['5d'].points[0]).toMatchObject({ canonicalTerm: 'Any 2 valid points from the list', marks: 4 });
  });

  it('every theory scheme adds up to its question', () => {
    for (const q of qs.filter((x) => x.type === 'THEORY')) {
      expect(q.points.reduce((s, p) => s + p.marks, 0)).toBeCloseTo(q.totalMarks);
    }
  });

  it('reads how many items a question asks for', () => {
    expect(requiredCount('List the 4 performance dimensions')).toBe(4);
    expect(requiredCount('Explain at least 5 stress management techniques')).toBe(5);
    expect(requiredCount('Identify and briefly describe the four attitudes')).toBe(4);
    expect(requiredCount('What is statistics?')).toBeNull();
  });
});
