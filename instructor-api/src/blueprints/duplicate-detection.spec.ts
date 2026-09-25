import { describe, expect, it } from 'vitest';
import { isNearDuplicate } from './duplicate-detection.js';

describe('isNearDuplicate', () => {
  it('flags a near-identical rephrase', () => {
    const existing = ['Which OSI layer is responsible for routing between networks?'];
    expect(isNearDuplicate('Which OSI layer is responsible for routing between two networks?', existing)).toBe(true);
  });

  it('does not flag genuinely different questions', () => {
    const existing = ['Which OSI layer is responsible for routing between networks?'];
    expect(isNearDuplicate('Explain why subnetting improves network security.', existing)).toBe(false);
  });

  it('returns false against an empty bank', () => {
    expect(isNearDuplicate('Anything at all.', [])).toBe(false);
  });
});
