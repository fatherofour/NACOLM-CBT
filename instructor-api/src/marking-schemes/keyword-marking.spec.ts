import { describe, expect, it } from 'vitest';
import { scoreAnswer, type MarkingSchemeInput } from './keyword-marking.js';

// Mirrors local-exam-server/internal/marking/keyword_test.go's convoyScheme
// exactly, so both implementations are validated against the same worked
// example from the design brief.
function convoyScheme(): MarkingSchemeInput {
  return {
    totalMarks: 10,
    groups: [
      { label: 'Convoy control / coordination', terms: ['control', 'coordination', 'command'], marks: 2, required: true },
      { label: 'Timing / synchronisation', terms: ['timing', 'schedule', 'synchronise', 'eta'], marks: 2, required: false },
      { label: 'Route security', terms: ['security', 'ambush risk', 'threat'], marks: 2, required: true },
      { label: 'Terrain / road condition', terms: ['terrain', 'road condition', 'gradient'], marks: 2, required: false },
      { label: 'Fuel / resupply', terms: ['fuel', 'pol', 'resupply', 'refuel'], marks: 2, required: false },
    ],
    requiredGroupCeilingPercent: 50,
    minWordCount: 15,
  };
}

describe('scoreAnswer', () => {
  it('credits all groups for a full answer', () => {
    const answer =
      'The convoy movement order establishes control and coordination of the convoy, ' +
      'addresses route security against ambush risk, accounts for terrain and road condition, ' +
      'sets timing for synchronisation, and plans fuel resupply for the whole journey.';

    const result = scoreAnswer(answer, convoyScheme());

    expect(result.score).toBe(10);
    expect(result.requiredGroupMissing).toBe(false);
    expect(result.flaggedTooShort).toBe(false);
    expect(result.matchedGroups).toHaveLength(5);
  });

  it('caps the score at the ceiling when a required group is missing', () => {
    const answer =
      'It addresses route security against ambush risk, accounts for terrain and road condition, ' +
      'sets timing for synchronisation, and plans fuel resupply for the whole journey which takes several hours.';

    const result = scoreAnswer(answer, convoyScheme());

    expect(result.requiredGroupMissing).toBe(true);
    expect(result.score).toBe(5); // raw 8, capped at 50% of 10
    expect(result.missingGroups).toContain('Convoy control / coordination');
  });

  it('does not let repeating a keyword add marks', () => {
    const answer =
      'security security security security security security security security ' +
      'security security security security security security security security security security security security';

    const result = scoreAnswer(answer, convoyScheme());

    expect(result.wordCount).toBeGreaterThanOrEqual(15);
    expect(result.flaggedTooShort).toBe(false);
    expect(result.score).toBe(2);
    expect(result.matchedGroups).toHaveLength(1);
  });

  it('flags and zero-scores a too-short answer even with keywords present', () => {
    const result = scoreAnswer('control security timing terrain fuel', convoyScheme());

    expect(result.flaggedTooShort).toBe(true);
    expect(result.score).toBe(0);
    expect(result.matchedGroups).toHaveLength(5);
  });

  it('matches the light-stemming examples from the design (convoy/convoys, secured/security)', () => {
    const result = scoreAnswer(
      'The convoys were secured throughout the route to prevent any incident along the way today.',
      convoyScheme(),
    );
    expect(result.matchedGroups).toContain('Route security');
  });

  it('matches a multi-word synonym when its words appear anywhere in the answer', () => {
    const result = scoreAnswer(
      'There is a significant risk of ambush along this stretch of road which must be planned for carefully in advance.',
      convoyScheme(),
    );
    expect(result.matchedGroups).toContain('Route security');
  });

  it('never exceeds totalMarks', () => {
    const scheme: MarkingSchemeInput = {
      totalMarks: 3,
      groups: [
        { label: 'A', terms: ['alpha'], marks: 2, required: false },
        { label: 'B', terms: ['beta'], marks: 2, required: false },
      ],
      requiredGroupCeilingPercent: 100,
      minWordCount: 1,
    };
    const result = scoreAnswer('alpha and beta both appear in this answer for the test', scheme);
    expect(result.score).toBe(3);
  });

  it('is deterministic', () => {
    const answer = 'control coordination security terrain fuel timing all mentioned here in a reasonably long sentence.';
    expect(scoreAnswer(answer, convoyScheme())).toEqual(scoreAnswer(answer, convoyScheme()));
  });
});
