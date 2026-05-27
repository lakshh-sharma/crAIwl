import { describe, expect, it } from 'vitest';
import { scoreConfidence } from './confidence.js';

describe('scoreConfidence', () => {
  it('returns 1.0 for the best case: first locator + grounded + validate passed', () => {
    expect(
      scoreConfidence({ locatorRank: 0, totalLocators: 3, grounded: true, hadValidate: true }),
    ).toBe(1);
  });

  it('drops below 0.8 (default confidenceFloor) when the value is not grounded', () => {
    expect(
      scoreConfidence({ locatorRank: 0, totalLocators: 3, grounded: false, hadValidate: true }),
    ).toBeLessThan(0.8);
  });

  it('penalizes fallback locators proportional to rank', () => {
    const first = scoreConfidence({
      locatorRank: 0,
      totalLocators: 3,
      grounded: true,
      hadValidate: false,
    });
    const middle = scoreConfidence({
      locatorRank: 1,
      totalLocators: 3,
      grounded: true,
      hadValidate: false,
    });
    const last = scoreConfidence({
      locatorRank: 2,
      totalLocators: 3,
      grounded: true,
      hadValidate: false,
    });
    expect(first).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(last);
  });

  it('does not penalize when there was only one locator available', () => {
    expect(
      scoreConfidence({ locatorRank: 0, totalLocators: 1, grounded: true, hadValidate: false }),
    ).toBe(1);
  });

  it('clamps to [0, 1]', () => {
    expect(
      scoreConfidence({
        locatorRank: 99,
        totalLocators: 100,
        grounded: false,
        hadValidate: false,
      }),
    ).toBeGreaterThanOrEqual(0);
    expect(
      scoreConfidence({ locatorRank: 0, totalLocators: 1, grounded: true, hadValidate: true }),
    ).toBeLessThanOrEqual(1);
  });
});
