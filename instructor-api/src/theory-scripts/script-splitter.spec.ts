import { describe, expect, it } from 'vitest';
import { leadWords, splitScript, type ScriptQuestion } from './script-splitter.js';

const questions: ScriptQuestion[] = [
  {
    questionId: 'q1',
    number: 1,
    body: 'The HQ 91 Bde is preparing for an offensive operation against the KAKANBA Terrorist Group. As the ACOS G4, the Bde Comd wants you to refresh his memory by providing answers to the following questions:\n(a) 4 purpose of establishing a support area. (6 marks)\n(b) What are the 10 criteria you must borne in mind when selecting a support area. (10 marks)',
  },
  {
    questionId: 'q2',
    number: 2,
    body: 'Still as ACOS G4 HQ 91 Bde, you attended a simulation exercise for the impending operation. Intimate the Director General the 5 purpose of logistics.',
  },
  { questionId: 'q3', number: 3, body: '(a) What is Logistics Preparation of the Battlefield (LPB)? (3 marks)\n(b) What is the purpose of LPB? (3 marks)' },
  { questionId: 'q4', number: 4, body: 'Mention 5 IT tools that can enhance your service delivery as a logistician.' },
];

// As the AI read real pages: printed questions, the candidate's own numbered
// points, an examiner's score and the RESTRICTED footer.
const pages = [
  `RESTRICTED
NIGERIAN ARMY COLLEGE OF LOGISTICS AND MANAGEMENT
Subject: LOGISTICS PLANNING TEST 1 IE
1. The HQ 91 Bde is preparing for an offensive operation against the KAKANBA Terrorist Group. As the ACOS G4, the Bde Comd, Brig BB Biu wants you to refresh his memory by providing answers to the following questions: (6mks).
a. 4 purpose of establishing a support area.
1. To reduce the amount of transport in the forward area.
2. To facilitate the effective defence of the support unit.
b. What are the 10 criteria you must bear in mind when selecting a support area. (10mks).
1. Should have hard and negotiable ground with good traffic route.
2. Still located within the turn around time.
15.5
RESTRICTED`,
  `3. Proximity to source of water.
2. Still as ACOS G4 HQ 91 Bde, you attended a simulation exercise for the impending operations your bde was about to embark on.
1) Simplicity
2) Cooperation
3. Write a brief note on what you understand by the following (10mks):
4a. What is Logistics Preparation of the Battlefield (LPB)? (3mks). It is the systematic distillation of planning data
2.5`,
  `b. What is the purpose of LPB? (3mks).
1. Battlefield area evaluation
4`,
];

describe('splitScript', () => {
  it('finds each printed question by number and wording, not by the candidate’s own numbering', () => {
    const out = splitScript(pages, [questions[0], questions[1], { ...questions[2], number: 4 }]);
    expect(out.map((a) => a.found)).toEqual([true, true, true]);
    expect(out[0].text).toContain('Proximity to source of water'); // carried over onto page 2
    expect(out[0].text).toContain('Should have hard and negotiable ground');
    expect(out[0].pages).toEqual([0, 1]);
    expect(out[1].text.split('\n')[0]).toMatch(/^2\. Still as ACOS/);
    expect(out[1].text).toContain('Cooperation');
  });

  it('keeps an answer that runs onto the next page with its question', () => {
    const out = splitScript(pages, [questions[0], questions[1], { ...questions[2], number: 4 }]);
    expect(out[2].text).toContain('systematic distillation');
    expect(out[2].text).toContain('Battlefield area evaluation');
    expect(out[2].pages).toEqual([1, 2]);
  });

  it('drops the examiner’s scores, the heading and the RESTRICTED footer', () => {
    const all = splitScript(pages, [questions[0], questions[1], { ...questions[2], number: 4 }]).map((a) => a.text).join('\n');
    expect(all).not.toMatch(/^15\.5$|^2\.5$|^4$|RESTRICTED|NIGERIAN ARMY/m);
  });

  it('reports a question that is not on the script, and one printed but left blank', () => {
    const out = splitScript(
      [`1. The HQ 91 Bde is preparing for an offensive operation against the KAKANBA Terrorist Group.\na. 4 purpose of establishing a support area.\nTo reduce transport in the forward area\n2. Still as ACOS G4 HQ 91 Bde, you attended a simulation exercise for the impending operation.`],
      [questions[0], questions[1], questions[3]],
    );
    expect(out.map((a) => [a.found, a.answered])).toEqual([[true, true], [true, false], [false, false]]);
  });

  it('finds a question whose printed number the AI dropped when its wording matches closely', () => {
    const out = splitScript(['Mention 5 IT tools that can enhance your service delivery as a logistician.\nIOT internet of things\nAI artificial intelligence'], [questions[3]]);
    expect(out[0]).toMatchObject({ found: true, answered: true });
  });

  it('finds a question by a lettered part when the page with its opening line is missing', () => {
    const explain = { questionId: 'q7', number: 7, body: 'Briefly explain the following:\n(a) Bulk Breaking (2 marks)\n(b) Cross Loading (2 marks)\n(c) Through Running (2 marks)' };
    const out = splitScript(
      [
        '5. Logisticians use some logistics planning tools in their everyday activities. Mention 5 IT tools that can enhance your service delivery as a logistician.\n1. IoT internet of things\n2. AI artificial intelligence',
        'b. Cross Loading. When the load of the third line transport is handed over to the second line.\nc. Through Running. When the vehicle and driver go through.',
      ],
      [{ questionId: 'q5', number: 5, body: 'Logisticians use some logistics planning tools in their everyday activities. Mention 5 IT tools.' }, explain],
    );
    expect(out[1]).toMatchObject({ found: true, answered: true, pages: [1] });
    expect(out[0].text).not.toContain('Cross Loading');
  });

  it('does not take a short numbered point just above the next question for that question', () => {
    const stages = { questionId: 'q4', number: 4, body: '(a) List the 6 stages of logistics estimate process that you know. (6 marks)' };
    const tools = { questionId: 'q5', number: 5, body: '(a) Logisticians use some logistics planning tools in their everyday activities. Mention 5 IT tools. (5 marks)' };
    const out = splitScript(
      ['4. List the 6 stages of logistics estimate process that you know.\n4. Development of course of action\n5. Evaluation of course of action\n6. Commander Decision\n5. Logisticians use some logistics planning tools in their everyday activities.\n1. IoT'],
      [stages, tools],
    );
    expect(out[0].text).toContain('6. Commander Decision');
    expect(out[1].text.split('\n')[0]).toMatch(/^5\. Logisticians/);
  });

  it('treats a row of [illegible] placeholders as a blank answer, and drops section headings', () => {
    const out = splitScript(
      ['4. Mention 5 IT tools that can enhance your service delivery as a logistician.\nAns\na. [illegible]\nb. [illegible]\nc. [illegible]\nSECTION B - THEORY'],
      [{ ...questions[3], number: 4 }],
    );
    expect(out[0]).toMatchObject({ found: true, answered: false });
    expect(out[0].text).not.toContain('SECTION B');
  });

  it('drops the examiner’s ticks and crosses after a point', () => {
    const out = splitScript(
      ['2. Still as ACOS G4 HQ 91 Bde, you attended a simulation exercise for the impending operation.\nSimplicity X\nFlexibility ✓'],
      [questions[1]],
    );
    expect(out[0].text).toContain('Simplicity\nFlexibility');
  });

  it('recognises a question without a stem by its first part', () => {
    expect(leadWords(questions[2].body)).toEqual(['logistics', 'preparation', 'battlefield', 'lpb']);
  });
});
