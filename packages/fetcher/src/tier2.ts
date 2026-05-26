import type { BrowserAction, BrowserProvider } from './browser/types.js';
import { FetchError, type FetchRequestOptions, type FetchResult, type Fetcher } from './types.js';

export type Tier2Options = {
  provider: BrowserProvider;
  /** Default scripted actions to run on every navigation. */
  defaultActions?: BrowserAction[];
  /** Default per-navigation timeout. */
  defaultTimeoutMs?: number;
};

/**
 * Tier 2 fetcher — runs the URL through a real browser via a BrowserProvider.
 * The provider's identity (local Playwright, hosted, remote) is opaque to
 * callers; what they get back is the rendered HTML after scripts have run
 * (and any configured scripted actions have been applied).
 */
export class Tier2Fetcher implements Fetcher {
  readonly tier = 'headless' as const;

  constructor(private readonly opts: Tier2Options) {}

  async fetch(url: string, reqOpts: FetchRequestOptions = {}): Promise<FetchResult> {
    const startedAt = Date.now();
    try {
      const result = await this.opts.provider.navigate(url, {
        timeoutMs: reqOpts.timeoutMs ?? this.opts.defaultTimeoutMs ?? 30_000,
        ...(reqOpts.signal ? { signal: reqOpts.signal } : {}),
        ...(reqOpts.headers ? { extraHeaders: reqOpts.headers } : {}),
        ...(this.opts.defaultActions ? { actions: this.opts.defaultActions } : {}),
      });
      return {
        status: result.status,
        // Browser providers don't surface response headers individually; we
        // return an empty bag rather than fabricate. Callers that need a
        // header should fall back to Tier 0 for the lookup.
        headers: {},
        body: result.html,
        finalUrl: result.finalUrl,
        tierUsed: 'headless',
        timingMs: Date.now() - startedAt,
        attempts: 1,
        redirects: 0,
      };
    } catch (err) {
      throw new FetchError(`Tier 2 fetch failed: ${url}`, { cause: err });
    }
  }
}
