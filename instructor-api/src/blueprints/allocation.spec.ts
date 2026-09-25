import { describe, expect, it } from 'vitest';
import { allocateByWeight, allocateEvenly } from './allocation.js';

describe('allocateEvenly', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(allocateEvenly(9, ['a', 'b', 'c'])).toEqual({ a: 3, b: 3, c: 3 });
  });

  it('distributes the remainder without losing or gaining questions', () => {
    const result = allocateEvenly(10, ['a', 'b', 'c']);
    const sum = Object.values(result).reduce((s, v) => s + v, 0);
    expect(sum).toBe(10);
    // 10/3 = 3.33 each, floor=3 for all three (sum 9) — exactly one bucket
    // absorbs the single remaining unit.
    expect(Object.values(result).sort()).toEqual([3, 3, 4]);
  });

  it('handles a single bucket', () => {
    expect(allocateEvenly(7, ['only'])).toEqual({ only: 7 });
  });
});

describe('allocateByWeight', () => {
  it('respects proportional weights and still sums exactly', () => {
    const result = allocateByWeight(10, { objective: 0.7, theory: 0.3 });
    expect(result.objective + result.theory).toBe(10);
    expect(result.objective).toBe(7);
    expect(result.theory).toBe(3);
  });

  it('returns all zeros when total weight is zero', () => {
    expect(allocateByWeight(10, { a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });
});
