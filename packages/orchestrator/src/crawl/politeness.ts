/**
 * Per-domain politeness gate.
 *
 * Two jobs:
 *   1) Pace requests to one domain — never exceed `perDomainConcurrency`
 *      inflight, and never start a new request faster than `minIntervalMs`
 *      since the last one returned. Robots.txt `Crawl-delay` overrides the
 *      configured min interval when it's larger.
 *   2) Back off on 429/503. If the server set `Retry-After`, honor it.
 *      Otherwise apply an exponential ramp from the configured base,
 *      capped at `maxBackoffMs`. The next request to that domain waits
 *      out the cooldown before starting.
 */

export type PolitenessOptions = {
  /** Max simultaneous in-flight requests per origin. Default 2. */
  perDomainConcurrency?: number;
  /** Floor on the gap between consecutive requests to the same origin. Default 200ms. */
  minIntervalMs?: number;
  /** Exponential-backoff cap. Default 60s. */
  maxBackoffMs?: number;
  /** Base for the exponential ramp. Default 1s. */
  baseBackoffMs?: number;
  /** Test seam: now provider. */
  now?: () => number;
  /** Test seam: sleeper. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MIN_INTERVAL_MS = 200;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

type DomainState = {
  inflight: number;
  lastFinishedAt: number;
  cooldownUntil: number;
  consecutiveFailures: number;
  waiters: Array<() => void>;
};

export class PolitenessGate {
  private readonly domains = new Map<string, DomainState>();
  private readonly concurrency: number;
  private readonly minIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly baseBackoffMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: PolitenessOptions = {}) {
    this.concurrency = opts.perDomainConcurrency ?? DEFAULT_CONCURRENCY;
    this.minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms))));
  }

  /**
   * Acquire a slot to fetch `url`. Returns a release callback that the caller
   * MUST invoke after the request completes (success OR failure). `crawlDelaySec`
   * comes from robots.txt and raises the effective min-interval when larger
   * than the configured one.
   */
  async acquire(url: string, crawlDelaySec?: number): Promise<() => void> {
    const origin = originOf(url);
    if (!origin) throw new Error(`politeness: cannot derive origin from ${url}`);
    const state = this.stateFor(origin);
    const effectiveMin = Math.max(this.minIntervalMs, (crawlDelaySec ?? 0) * 1000);

    while (true) {
      const now = this.now();
      const earliest = Math.max(state.lastFinishedAt + effectiveMin, state.cooldownUntil);

      if (state.inflight < this.concurrency && now >= earliest) {
        state.inflight++;
        return () => this.release(state);
      }

      const waitMs = Math.max(0, earliest - now);
      if (state.inflight >= this.concurrency) {
        // Wait for a slot to free up.
        await new Promise<void>((r) => state.waiters.push(r));
      } else {
        // We have a slot but need to honor the min-interval / cooldown.
        await this.sleep(waitMs);
      }
    }
  }

  /**
   * Tell the gate how a request finished. 429/503 (or a fetch error) increases
   * the cooldown; success resets the failure counter. Caller passes the
   * `Retry-After` header value when present.
   */
  noteResponse(
    url: string,
    info: { status?: number; retryAfter?: string | number; networkError?: boolean },
  ): void {
    const origin = originOf(url);
    if (!origin) return;
    const state = this.stateFor(origin);
    const isFailure = info.networkError === true || info.status === 429 || info.status === 503;
    if (!isFailure) {
      state.consecutiveFailures = 0;
      state.cooldownUntil = 0;
      return;
    }
    state.consecutiveFailures++;
    const retryAfterMs = parseRetryAfter(info.retryAfter, this.now());
    const exp = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** (state.consecutiveFailures - 1),
    );
    const waitMs = retryAfterMs ?? exp;
    state.cooldownUntil = this.now() + waitMs;
  }

  private release(state: DomainState): void {
    state.inflight = Math.max(0, state.inflight - 1);
    state.lastFinishedAt = this.now();
    const waiter = state.waiters.shift();
    if (waiter) waiter();
  }

  private stateFor(origin: string): DomainState {
    let s = this.domains.get(origin);
    if (!s) {
      s = {
        inflight: 0,
        lastFinishedAt: 0,
        cooldownUntil: 0,
        consecutiveFailures: 0,
        waiters: [],
      };
      this.domains.set(origin, s);
    }
    return s;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function parseRetryAfter(value: string | number | undefined, nowMs: number): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') return Math.max(0, value * 1000);
  const asNum = Number(value);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  const ts = Date.parse(value);
  if (Number.isFinite(ts)) return Math.max(0, ts - nowMs);
  return null;
}
