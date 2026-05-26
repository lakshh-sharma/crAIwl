import { fetch as undiciFetch, type Dispatcher } from 'undici';
import {
  FetchError,
  type FetchMethod,
  type FetchRequestOptions,
  type FetchResult,
  type Fetcher,
} from './types.js';

export type Tier0Options = {
  /** Default User-Agent — sites prefer honest UAs over forged ones at this tier. */
  userAgent?: string;
  /** Per-request timeout if the caller doesn't override. */
  defaultTimeoutMs?: number;
  /** Max retries on transient errors (5xx / network). 4xx never retries. */
  defaultMaxRetries?: number;
  /** Inject a dispatcher (used by tests with MockAgent). */
  dispatcher?: Dispatcher;
};

const DEFAULT_USER_AGENT = 'craiwl/0.0.0 (+https://github.com/lakshh-sharma/crAIwl)';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Tier 0 fetcher — plain server-side HTTP via `undici`. Cheap, fast, and the
 * right default for docs, sitemaps, robots.txt, and most cooperative
 * targets. Escalation to higher tiers is the orchestrator's job.
 *
 * Behavioural contract:
 *   - Follows redirects automatically (handled by undici's WHATWG fetch).
 *   - Decompresses gzip/deflate/br responses transparently.
 *   - Retries on 5xx + network errors with exponential backoff, capped.
 *   - Does NOT retry on 4xx — those are signals, not noise.
 *   - Honors the caller's AbortSignal; a wall-clock timeout signal is
 *     composed in alongside it.
 */
export class Tier0Fetcher implements Fetcher {
  readonly tier = 'static' as const;

  constructor(private readonly opts: Tier0Options = {}) {}

  async fetch(url: string, reqOpts: FetchRequestOptions = {}): Promise<FetchResult> {
    const startedAt = Date.now();
    const method: FetchMethod = reqOpts.method ?? 'GET';
    const timeoutMs = reqOpts.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = reqOpts.maxRetries ?? this.opts.defaultMaxRetries ?? DEFAULT_MAX_RETRIES;

    const headers: Record<string, string> = {
      'user-agent': this.opts.userAgent ?? DEFAULT_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
      ...lowercaseHeaders(reqOpts.headers ?? {}),
    };

    let lastError: unknown;
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(new Error('timeout')), timeoutMs);
      const signal = reqOpts.signal
        ? composeSignals(reqOpts.signal, timeoutCtrl.signal)
        : timeoutCtrl.signal;

      try {
        const res = await undiciFetch(url, {
          method,
          headers,
          signal,
          redirect: 'follow',
          ...(this.opts.dispatcher ? { dispatcher: this.opts.dispatcher } : {}),
        });
        const status = res.status;
        const responseHeaders = headersToObject(res.headers);
        const body = method === 'HEAD' ? '' : await res.text();
        const finalUrl = res.url || url;
        const redirects = res.redirected ? 1 : 0; // undici doesn't expose chain length
        clearTimeout(timer);

        if (status >= 500 && attempt <= maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }

        return {
          status,
          headers: responseHeaders,
          body,
          finalUrl,
          tierUsed: 'static',
          timingMs: Date.now() - startedAt,
          attempts: attempt,
          redirects,
        };
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (reqOpts.signal?.aborted) break;
        if (attempt <= maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        break;
      }
    }

    throw new FetchError(`Tier 0 fetch failed after ${attempt} attempt(s): ${url}`, {
      cause: lastError,
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function lowercaseHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms, 1s, 2s … with mild jitter.
  const base = 250 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 50);
  return Math.min(base + jitter, 4_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function composeSignals(...signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0]!;
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
