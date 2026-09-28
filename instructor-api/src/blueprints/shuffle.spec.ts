import { describe, expect, it } from 'vitest';
import { shuffle } from './shuffle.js';

describe('shuffle', () => {
  it('returns the exact same elements, just reordered', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffle(input);
    expect(result).toHaveLength(input.length);
    expect([...result].sort()).toEqual([...input].sort());
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it('actually varies the order across calls (not a no-op)', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    const outputs = new Set(Array.from({ length: 20 }, () => shuffle(input).join(',')));
    // With 30 items shuffled 20 times, getting the exact same permutation
    // every time would mean shuffle does nothing — this would only ever be
    // flaky in a way that indicates a real bug, not by chance.
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([1])).toEqual([1]);
  });
});
