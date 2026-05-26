import { describe, expect, it, vi } from 'vitest';
import { autoTierFetch, type TierDecision } from './auto-tier.js';
import type { FetchRequestOptions, FetchResult, Fetcher } from './types.js';
import { FetchError } from './types.js';

const okT0 = (body: string, status = 200): FetchResult => ({
  status,
  headers: {},
  body,
  finalUrl: 'https://example.com/',
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
});

const okT2 = (body: string, status = 200): FetchResult => ({
  status,
  headers: {},
  body,
  finalUrl: 'https://example.com/',
  tierUsed: 'headless',
  timingMs: 50,
  attempts: 1,
  redirects: 0,
});

const fetcher = (
  impl: (url: string, opts?: FetchRequestOptions) => Promise<FetchResult>,
): Fetcher => ({
  tier: 'static',
  fetch: impl,
});

describe('autoTierFetch', () => {
  it('keeps T0 when it returns 200 and fingerprints are present', async () => {
    const decisions: TierDecision[] = [];
    const t0 = fetcher(async () => okT0('<html><div data-tier="pro">…</div></html>'));
    const t2 = fetcher(async () => okT2('headless should not run'));
    const res = await autoTierFetch('https://example.com/', {
      static: t0,
      headless: t2,
      contentFingerprints: ['data-tier'],
      onDecision: (d) => decisions.push(d),
    });
    expect(res.decision.chosen).toBe('static');
    expect(res.decision.reason).toBe('t0-ok');
    expect(decisions).toHaveLength(1);
  });

  it('escalates to T2 when fingerprints are missing from T0 body', async () => {
    const t0 = fetcher(async () => okT0('<html><div id="app"></div></html>'));
    const t2Spy = vi.fn(async () => okT2('<html><div data-tier="pro">…</div></html>'));
    const t2 = fetcher(t2Spy);
    const res = await autoTierFetch('https://example.com/', {
      static: t0,
      headless: t2,
      contentFingerprints: ['data-tier'],
    });
    expect(res.decision.chosen).toBe('headless');
    expect(res.decision.reason).toBe('t0-missing-content');
    expect(res.tierUsed).toBe('headless');
    expect(t2Spy).toHaveBeenCalledOnce();
  });

  it('escalates to T2 on a 403 challenge from T0', async () => {
    const t0 = fetcher(async () => okT0('blocked', 403));
    const t2 = fetcher(async () => okT2('rendered'));
    const res = await autoTierFetch('https://example.com/', {
      static: t0,
      headless: t2,
    });
    expect(res.decision.chosen).toBe('headless');
    expect(res.decision.reason).toBe('t0-blocked');
    expect(res.decision.t0Status).toBe(403);
    expect(res.decision.t2Status).toBe(200);
  });

  it('escalates to T2 when T0 throws', async () => {
    const t0 = fetcher(async () => {
      throw new FetchError('network down');
    });
    const t2 = fetcher(async () => okT2('rendered'));
    const res = await autoTierFetch('https://example.com/', {
      static: t0,
      headless: t2,
    });
    expect(res.decision.chosen).toBe('headless');
    expect(res.decision.reason).toBe('t0-error');
  });

  it('does NOT escalate on a 404 — that is the real answer', async () => {
    const t0 = fetcher(async () => okT0('not found', 404));
    const t2Spy = vi.fn(async () => okT2('should not run'));
    const t2 = fetcher(t2Spy);
    const res = await autoTierFetch('https://example.com/', {
      static: t0,
      headless: t2,
    });
    expect(res.decision.chosen).toBe('static');
    expect(res.status).toBe(404);
    expect(t2Spy).not.toHaveBeenCalled();
  });

  it('respects custom escalateStatuses', async () => {
    const t0 = fetcher(async () => okT0('blocked', 451));
    const t2 = fetcher(async () => okT2('rendered'));
    const res = await autoTierFetch('https://example.com/', {
      static: t0,
      headless: t2,
      escalateStatuses: [451],
    });
    expect(res.decision.chosen).toBe('headless');
    expect(res.decision.t0Status).toBe(451);
  });

  it('throws FetchError when both tiers fail', async () => {
    const t0 = fetcher(async () => {
      throw new FetchError('t0 down');
    });
    const t2 = fetcher(async () => {
      throw new FetchError('t2 down');
    });
    const decisions: TierDecision[] = [];
    await expect(
      autoTierFetch('https://example.com/', {
        static: t0,
        headless: t2,
        onDecision: (d) => decisions.push(d),
      }),
    ).rejects.toThrow(FetchError);
    // The terminal decision marker should record the escalation failure.
    expect(decisions.at(-1)?.reason).toBe('t2-error');
  });

  it('passes a 200 through unchanged when no fingerprints are configured', async () => {
    const t0 = fetcher(async () => okT0('<html></html>'));
    const t2Spy = vi.fn(async () => okT2('should not run'));
    const res = await autoTierFetch('https://example.com/', {
      static: t0,
      headless: fetcher(t2Spy),
    });
    expect(res.decision.chosen).toBe('static');
    expect(t2Spy).not.toHaveBeenCalled();
  });
});
