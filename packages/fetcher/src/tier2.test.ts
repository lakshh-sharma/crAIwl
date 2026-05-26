import { describe, expect, it, vi } from 'vitest';
import { Tier2Fetcher } from './tier2.js';
import type { BrowserProvider, NavigateOptions, NavigateResult } from './browser/types.js';
import { FetchError } from './types.js';

const mockProvider = (impl: BrowserProvider['navigate']): BrowserProvider => ({
  kind: 'local',
  navigate: impl,
  close: async () => undefined,
});

describe('Tier2Fetcher', () => {
  it('returns the rendered HTML from the provider', async () => {
    const provider = mockProvider(async (url) => ({
      html: `<html><body>rendered ${url}</body></html>`,
      finalUrl: url,
      status: 200,
      actionsApplied: 0,
    }));
    const fetcher = new Tier2Fetcher({ provider });
    const res = await fetcher.fetch('https://example.com/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('rendered https://example.com/');
    expect(res.tierUsed).toBe('headless');
    expect(res.attempts).toBe(1);
    expect(res.finalUrl).toBe('https://example.com/');
  });

  it('passes default actions to the provider', async () => {
    const seen: NavigateOptions[] = [];
    const provider = mockProvider(async (_url, opts): Promise<NavigateResult> => {
      seen.push(opts ?? {});
      return { html: '<html></html>', finalUrl: 'x', status: 200, actionsApplied: 0 };
    });
    const fetcher = new Tier2Fetcher({
      provider,
      defaultActions: [{ type: 'scroll-to-bottom', maxIterations: 5 }],
    });
    await fetcher.fetch('https://example.com/');
    expect(seen[0]?.actions).toEqual([{ type: 'scroll-to-bottom', maxIterations: 5 }]);
  });

  it('forwards request headers to extraHeaders', async () => {
    const seen: NavigateOptions[] = [];
    const provider = mockProvider(async (_url, opts) => {
      seen.push(opts ?? {});
      return { html: '<html></html>', finalUrl: 'x', status: 200, actionsApplied: 0 };
    });
    const fetcher = new Tier2Fetcher({ provider });
    await fetcher.fetch('https://example.com/', { headers: { 'x-trace': 'abc' } });
    expect(seen[0]?.extraHeaders).toEqual({ 'x-trace': 'abc' });
  });

  it('wraps provider failures in FetchError', async () => {
    const provider = mockProvider(() => {
      throw new Error('boom');
    });
    const fetcher = new Tier2Fetcher({ provider });
    await expect(fetcher.fetch('https://example.com/')).rejects.toThrow(FetchError);
  });

  it('records the elapsed timing', async () => {
    const provider = mockProvider(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { html: '<html></html>', finalUrl: 'x', status: 200, actionsApplied: 0 };
    });
    const fetcher = new Tier2Fetcher({ provider });
    const res = await fetcher.fetch('https://example.com/');
    expect(res.timingMs).toBeGreaterThanOrEqual(10);
  });
});

describe('Tier2Fetcher: mocked provider lifecycle', () => {
  it('does not hold the provider open after a single call', async () => {
    const closeSpy = vi.fn(async () => undefined);
    const provider: BrowserProvider = {
      kind: 'local',
      navigate: async () => ({
        html: '<html></html>',
        finalUrl: 'x',
        status: 200,
        actionsApplied: 0,
      }),
      close: closeSpy,
    };
    const fetcher = new Tier2Fetcher({ provider });
    await fetcher.fetch('https://example.com/');
    // Tier2Fetcher does NOT close the provider — that's the caller's job.
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
