import { looksLikeInlineScheme, parseInlineScheme } from './inline-scheme-parser.js';
import { readScheme } from './scheme-reader.js';

// A made-up scheme in the layout where each answer follows its question
// directly, with no SOLUTION headings: parts under "the following", lettered
// answer items, a term and its answer on one line, "4a." numbering, a
// question answered and then followed by a lettered part, a list of names
// marked per name, an explained point whose number was left off, and page
// furniture.
const SCHEME = `RESTRICTED
NIGERIAN ARMY COLLEGE OF LOGISTICS AND MANAGEMENT
Subject: MOVEMENT CONTROL TEST 2 IE Course: LMC 25/27
Instructions: Attempt all questions
Time Allowed: 1 hr HPS: 35 Date: OCT 27
1. The Bde is preparing to move by road. Answer the following questions: (4mks).
a. 2 duties of a convoy commander.
(1) To brief every driver before departure.
(2) To control the march and its timings.
b. What are the 3 types of halt used by a convoy? (3mks).
(1) Short halt.
(2) Long halt.
(3) Night halt.
2. State the 3 purposes of a movement order. (3mks).
a. To give the route.
b. To give the timings.
c. To give the serials.
d. To give the halts.
1
RESTRICTED
-- 1 of 2 --
RESTRICTED
3. Write a brief note on the following (4mks):
a. Start Point. The point at which a column begins its move and from which timings are measured.
b. Traffic control handles the flow of vehicles along the route so that columns do not clash.
4a. What is movement control? (2mks).
Movement control is the planning, routing and scheduling of the movement of forces along lines of communication.
b. List the 2 means of movement. (2mks).
a. Road.
b. Rail.
5. Mention 2 tools used in movement planning. (2mks).
a. Movement tables.
b. Route cards.
c. Traffic circulation plans. (Any 2 for 2 marks).
b. What is the content of a movement table? (3mks)
a. The serials.
b. The timings.
c. The routes.
6. List all the principles of movement and explain the first 2. (6mks).
Control, Flexibility and Security. Others are Economy and Simplicity. (0.4mks for each correct listed item)
a. Control. All movement must be controlled by one HQ so that columns do not meet on the route. (2mks)
b. Flexibility. Plans must allow for changes in route and timings during the move. (2mks)
7. List and explain the fundamental issues of a move. (1mk for each correct listing)
(1) Distance. Distance sets the fuel, rest and turn round needed for the move. (2mks).
Duration. Duration sets how long the force must be supported on the route. (2mks).
2
RESTRICTED`;

describe('marking scheme with answers straight after each question', () => {
  const { questions: qs, layout } = parseInlineScheme(SCHEME);
  const byLabel = Object.fromEntries(qs.map((q) => [q.label, q]));
  const part = (label: string) => byLabel[label.slice(0, -1)].parts!.find((p) => p.label === label.slice(-1))!;
  const points = (label: string) => part(label).points.map((p) => [p.canonicalTerm, p.marks]);

  it('is recognised, unlike a blank question paper or a SOLUTION scheme', () => {
    expect(looksLikeInlineScheme(SCHEME)).toBe(true);
    const blank = SCHEME.split('\n').filter((l) => !/^(\(\d\)|[a-c]\. To |Movement control is|[a-c]\. (Road|Rail|The |Movement tables|Route|Traffic circ|Control\.|Flexibility\.)|Control, |Duration\.)/.test(l)).join('\n');
    expect(looksLikeInlineScheme(blank)).toBe(false);
    expect(readScheme(blank)).toBeNull();
    expect(looksLikeInlineScheme('1. Q? (2mks)\nSOLUTION\nA.\n2. Q? (2mks)\nSOLUTION\nB.\n3. Q (1mk)')).toBe(false);
  });

  it('reads one question per number, adding up to the paper’s HPS', () => {
    expect(qs.map((q) => [q.label, q.totalMarks])).toEqual([['1', 7], ['2', 3], ['3', 4], ['4', 4], ['5', 5], ['6', 6], ['7', 6]]);
    expect(layout.sections[0].totalMarks).toBe(Number(layout.header.totalMarks));
    expect(qs.every((q) => q.topic === 'Movement Control')).toBe(true);
  });

  it('reads the heading of this layout', () => {
    expect(layout.header).toMatchObject({
      institution: 'NIGERIAN ARMY COLLEGE OF LOGISTICS AND MANAGEMENT',
      paperTitle: 'Movement Control Test 2 IE',
      course: 'LMC 25/27',
      time: '1 hr',
      totalMarks: '35',
      totalLabel: 'HPS',
      instruction: 'Attempt all questions',
    });
  });

  it('gives a question’s own marks to its first part when only that part has none', () => {
    expect(byLabel['1'].parts!.map((p) => [p.label, p.totalMarks])).toEqual([['a', 4], ['b', 3]]);
    expect(points('1a')).toEqual([['To brief every driver before departure', 2], ['To control the march and its timings', 2]]);
    expect(byLabel['1'].body.split('\n')[0]).toBe('The Bde is preparing to move by road. Answer the following questions:');
  });

  it('treats lettered lines after a question as its answer, any 3 of 4 here', () => {
    expect(byLabel['2'].parts).toBeUndefined();
    expect(byLabel['2'].points[0]).toMatchObject({ canonicalTerm: 'Any 3 valid points from the list', marks: 3 });
    expect(byLabel['2'].modelAnswer!.split('\n')[0]).toBe('a. To give the route.');
  });

  it('splits "Term. Explanation" under "the following" into the part and its answer', () => {
    expect(byLabel['3'].parts!.map((p) => [p.body, p.totalMarks])).toEqual([['Start Point.', 2], ['Traffic control.', 2]]);
    expect(part('3a').modelAnswer).toBe('The point at which a column begins its move and from which timings are measured.');
  });

  it('keeps lettered answers inside a part and starts a part only at a lettered question', () => {
    expect(byLabel['4'].parts!.map((p) => p.label)).toEqual(['a', 'b']);
    expect(points('4b')).toEqual([['Road', 1], ['Rail', 1]]);
    expect(byLabel['5'].parts!.map((p) => [p.label, p.totalMarks])).toEqual([['a', 2], ['b', 3]]);
    expect(part('5a').points[0]).toMatchObject({ canonicalTerm: 'Any 2 valid points from the list', marks: 2 });
    expect(part('5a').markingNotes).toBe('Any 2 for 2 marks');
  });

  it('marks a list of names per name and each explained point by its own marks', () => {
    expect(byLabel['6'].points.map((p) => [p.canonicalTerm, p.marks])).toEqual([['Lists all 5', 2], ['Control', 2], ['Flexibility', 2]]);
    expect(byLabel['6'].points[0].synonyms).toEqual(['Control', 'Flexibility', 'Security', 'Economy', 'Simplicity']);
  });

  it('adds marks per listing to each explained point, including one whose number was left off', () => {
    expect(byLabel['7'].points.map((p) => [p.canonicalTerm, p.marks, p.notes])).toEqual([
      ['Distance', 3, '1 for naming it, 2 for explaining it'],
      ['Duration', 3, '1 for naming it, 2 for explaining it'],
    ]);
  });

  it('every scheme, and every part of one, adds up', () => {
    for (const q of qs) {
      expect(q.points.reduce((s, p) => s + p.marks, 0)).toBeCloseTo(q.totalMarks);
      for (const p of q.parts ?? []) expect(p.points.reduce((s, pt) => s + pt.marks, 0)).toBeCloseTo(p.totalMarks);
    }
  });
});
