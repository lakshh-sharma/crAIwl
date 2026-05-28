import { describe, expect, it } from 'vitest';
import { RedesignDetector, RepairBudget } from './budget.js';

describe('RepairBudget', () => {
  it('hands out tokens until the limit, then refuses', () => {
    const b = new RepairBudget(3);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
    expect(b.exhausted).toBe(true);
    expect(b.spent).toBe(3);
    expect(b.remaining).toBe(0);
  });

  it('treats a zero-limit budget as immediately exhausted', () => {
    const b = new RepairBudget(0);
    expect(b.tryConsume()).toBe(false);
    expect(b.exhausted).toBe(true);
  });

  it('rejects non-integer or negative limits', () => {
    expect(() => new RepairBudget(-1)).toThrow();
    expect(() => new RepairBudget(1.5)).toThrow();
  });
});

describe('RedesignDetector', () => {
  it('does not trip before reaching minPages', () => {
    const d = new RedesignDetector({ thresholdRatio: 0.5, minPages: 4 });
    d.notePage(true);
    d.notePage(true);
    d.notePage(true);
    expect(d.likelyRedesign).toBe(false);
  });

  it('trips when failures cross the threshold ratio after minPages', () => {
    const d = new RedesignDetector({ thresholdRatio: 0.5, minPages: 4 });
    d.notePage(true);
    d.notePage(true);
    d.notePage(true);
    d.notePage(false);
    expect(d.likelyRedesign).toBe(true);
    expect(d.ratio).toBe(0.75);
  });

  it('stays calm when most pages succeed', () => {
    const d = new RedesignDetector({ thresholdRatio: 0.5, minPages: 4 });
    for (let i = 0; i < 10; i++) d.notePage(false);
    d.notePage(true);
    expect(d.likelyRedesign).toBe(false);
  });

  it('returns ratio=0 with no pages observed yet', () => {
    expect(new RedesignDetector().ratio).toBe(0);
  });
});
