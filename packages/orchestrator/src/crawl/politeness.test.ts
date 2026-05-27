import { describe, expect, it } from 'vitest';
import { PolitenessGate } from './politeness.js';

/**
 * The gate is time-sensitive; we drive a fake clock so tests stay fast.
 */
function fakeClock(initial = 0) {
  let t = initial;
  const sleeps: number[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

describe('PolitenessGate', () => {
  it('honors per-domain concurrency', async () => {
    const clock = fakeClock();
    const gate = new PolitenessGate({
      perDomainConcurrency: 2,
      minIntervalMs: 0,
      now: clock.now,
      sleep: clock.sleep,
    });

    const a = await gate.acquire('https://x.com/1');
    const b = await gate.acquire('https://x.com/2');
    // Third acquire is queued — start it but don't await yet.
    let acquired3 = false;
    const p3 = gate.acquire('https://x.com/3').then((rel) => {
      acquired3 = true;
      rel();
    });
    // Microtask flush — should still be waiting.
    await Promise.resolve();
    expect(acquired3).toBe(false);

    a();
    await p3;
    expect(acquired3).toBe(true);

    b();
  });

  it('enforces min-interval between requests on the same domain', async () => {
    const clock = fakeClock();
    const gate = new PolitenessGate({
      perDomainConcurrency: 1,
      minIntervalMs: 500,
      now: clock.now,
      sleep: clock.sleep,
    });

    const r1 = await gate.acquire('https://x.com/a');
    r1();
    clock.advance(100); // Only 100ms passed — gate should make us wait ~400 more.

    await gate.acquire('https://x.com/b');
    expect(clock.sleeps.some((s) => s >= 400 && s <= 500)).toBe(true);
  });

  it('respects robots crawl-delay when larger than minInterval', async () => {
    const clock = fakeClock();
    const gate = new PolitenessGate({
      perDomainConcurrency: 1,
      minIntervalMs: 100,
      now: clock.now,
      sleep: clock.sleep,
    });

    const r1 = await gate.acquire('https://x.com/a', 2);
    r1();
    // Effective min = 2000ms (crawl-delay), beats configured 100ms.
    await gate.acquire('https://x.com/b', 2);
    expect(clock.sleeps.some((s) => s >= 1900)).toBe(true);
  });

  it('cools down after a 429 and honors Retry-After (seconds)', async () => {
    const clock = fakeClock();
    const gate = new PolitenessGate({
      perDomainConcurrency: 1,
      minIntervalMs: 0,
      baseBackoffMs: 1000,
      now: clock.now,
      sleep: clock.sleep,
    });

    const r1 = await gate.acquire('https://x.com/a');
    r1();
    gate.noteResponse('https://x.com/a', { status: 429, retryAfter: '10' });

    await gate.acquire('https://x.com/b');
    expect(clock.sleeps.some((s) => s >= 10_000)).toBe(true);
  });

  it('grows the cooldown exponentially on repeated failures', async () => {
    const clock = fakeClock();
    const gate = new PolitenessGate({
      perDomainConcurrency: 1,
      minIntervalMs: 0,
      baseBackoffMs: 100,
      maxBackoffMs: 10_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    (await gate.acquire('https://x.com/a'))();
    gate.noteResponse('https://x.com/a', { status: 503 });
    (await gate.acquire('https://x.com/b'))();
    gate.noteResponse('https://x.com/b', { status: 503 });
    (await gate.acquire('https://x.com/c'))();
    gate.noteResponse('https://x.com/c', { status: 503 });
    await gate.acquire('https://x.com/d');

    // 3rd failure → base * 2^(3-1) = 400ms cooldown.
    const lastSleep = clock.sleeps[clock.sleeps.length - 1]!;
    expect(lastSleep).toBeGreaterThanOrEqual(400);
  });

  it('resets the failure counter on success', async () => {
    const clock = fakeClock();
    const gate = new PolitenessGate({
      perDomainConcurrency: 1,
      minIntervalMs: 0,
      baseBackoffMs: 1000,
      now: clock.now,
      sleep: clock.sleep,
    });

    (await gate.acquire('https://x.com/a'))();
    gate.noteResponse('https://x.com/a', { status: 503 });
    (await gate.acquire('https://x.com/b'))();
    gate.noteResponse('https://x.com/b', { status: 200 }); // Reset.

    clock.advance(10_000);
    const sleepsBefore = clock.sleeps.length;
    await gate.acquire('https://x.com/c');
    // No cooldown sleep expected on /c.
    const cooldownSleeps = clock.sleeps.slice(sleepsBefore).filter((s) => s >= 500);
    expect(cooldownSleeps).toHaveLength(0);
  });

  it('treats per-domain state independently', async () => {
    const clock = fakeClock();
    const gate = new PolitenessGate({
      perDomainConcurrency: 1,
      minIntervalMs: 1000,
      now: clock.now,
      sleep: clock.sleep,
    });
    (await gate.acquire('https://a.com/'))();
    const sleepsBefore = clock.sleeps.length;
    await gate.acquire('https://b.com/');
    const newSleeps = clock.sleeps.slice(sleepsBefore).filter((s) => s > 0);
    expect(newSleeps).toHaveLength(0);
  });
});
