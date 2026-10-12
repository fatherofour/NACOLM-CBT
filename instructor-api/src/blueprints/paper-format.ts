// A new exam that follows a past paper's layout: the same sections, each
// filled with whole questions to the same marks. A section the candidate
// answers in full ("Section A, 25 marks") is filled with questions adding up
// to exactly its marks; a section with a choice ("answer 3 of the 4 Section B
// questions, 25 marks each") gets that many questions of exactly those marks.
import type { PaperHeader, SchemeLayout } from '../documents/marking-scheme-parser.js';
import { shuffle } from './shuffle.js';

export interface CompulsorySection {
  letter: string;
  title: string | null;
  marks: number;
}

export interface ChoiceSection {
  letter: string;
  title: string | null;
  count: number; // questions printed
  choose: number; // questions each candidate answers
  marksEach: number;
}

export type FormatSection = CompulsorySection | ChoiceSection;

export interface PaperFormat {
  sourceDocumentId: string;
  sourceTitle: string;
  sections: FormatSection[];
  // The past paper's heading, so a printed paper follows the same template.
  header?: PaperHeader | null;
}

export const isChoice = (s: FormatSection): s is ChoiceSection => 'choose' in s;

export function formatFromLayout(layout: SchemeLayout, source: { id: string; title: string }): PaperFormat {
  return {
    sourceDocumentId: source.id,
    sourceTitle: source.title,
    header: layout.header ?? null,
    sections: layout.sections.map((s): FormatSection => {
      const even = s.marks.length > 0 && s.marks.every((m) => m === s.marks[0]);
      if (layout.choose?.section === s.letter && layout.choose.count < s.labels.length && even) {
        return { letter: s.letter, title: s.title, count: s.labels.length, choose: layout.choose.count, marksEach: s.marks[0] };
      }
      return { letter: s.letter, title: s.title, marks: s.totalMarks };
    }),
  };
}

/** What a candidate can score on a paper in this format. */
export function formatTotal(format: PaperFormat): number {
  return format.sections.reduce((sum, s) => sum + (isChoice(s) ? s.choose * s.marksEach : s.marks), 0);
}

/** The instruction printed under a section heading. */
export function sectionInstructions(s: FormatSection): string {
  return isChoice(s)
    ? `Answer any ${s.choose} of the ${s.count} questions in this section. Each carries ${s.marksEach} marks.`
    : `Answer all the questions in this section (${s.marks} marks).`;
}

// Marks go down to quarter marks, so the search works in quarters.
const UNIT = 4;

/**
 * A random set of questions whose marks add up to exactly `target`, or the
 * nearest set below it when no exact one exists. Shuffled first, so each
 * call gives a different paper when the pool allows it.
 */
export function pickToMarks<T extends { marks: number }>(pool: T[], target: number): T[] {
  const items = shuffle(pool).filter((q) => q.marks > 0 && q.marks <= target);
  const goal = Math.round(target * UNIT);
  // reachedBy[s]: the item that first made a total of s, and the total before it.
  const reachedBy: ({ item: number; from: number } | null)[] = new Array(goal + 1).fill(null);
  const reached = new Array<boolean>(goal + 1).fill(false);
  reached[0] = true;
  items.forEach((q, i) => {
    const w = Math.round(q.marks * UNIT);
    for (let s = goal; s >= w; s--) {
      if (!reached[s] && reached[s - w]) {
        reached[s] = true;
        reachedBy[s] = { item: i, from: s - w };
      }
    }
  });
  let s = goal;
  while (s > 0 && !reached[s]) s--;
  const picked: T[] = [];
  while (s > 0) {
    const step = reachedBy[s]!;
    picked.push(items[step.item]);
    s = step.from;
  }
  return picked;
}

/** `count` questions worth exactly `marksEach`, chosen at random. */
export function pickExact<T extends { marks: number }>(pool: T[], count: number, marksEach: number): T[] {
  return shuffle(pool.filter((q) => Math.abs(q.marks - marksEach) < 0.001)).slice(0, count);
}
