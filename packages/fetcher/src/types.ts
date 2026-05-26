/**
 * Shared types for every Fetcher implementation. The interface is what the
 * orchestrator depends on — concrete implementations (Tier 0 HTTP, Tier 1
 * TLS-impersonation, Tier 2 headless, Tier 3 proxy) all conform to it so the
 * fetch ladder can escalate without callers caring which tier serves a
 * request.
 */

export type FetchTier = 'static' | 'impersonate' | 'headless' | 'proxy';

export type FetchMethod = 'GET' | 'HEAD';

export type FetchRequestOptions = {
  method?: FetchMethod;
  headers?: Record<string, string>;
  /** Total budget for this request, including retries. */
  timeoutMs?: number;
  /** Caller-controlled cancellation. Composes with `timeoutMs`. */
  signal?: AbortSignal;
  /**
   * Cap on automatic retries for transient (5xx / network) failures. Default
   * is implementation-specific; 4xx never retries regardless.
   */
  maxRetries?: number;
};

export type FetchResult = {
  status: number;
  /** Lower-case header names. Multi-valued headers are comma-joined. */
  headers: Record<string, string>;
  body: string;
  /** Final URL after redirects (matches `url` if no redirect occurred). */
  finalUrl: string;
  tierUsed: FetchTier;
  timingMs: number;
  attempts: number;
  redirects: number;
};

/** Thrown when a request exhausts its retry budget or hits a non-retryable error. */
export class FetchError extends Error {
  override readonly name = 'FetchError';
  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    if (options?.status !== undefined) this.status = options.status;
  }
  readonly status?: number;
}

export interface Fetcher {
  readonly tier: FetchTier;
  fetch(url: string, opts?: FetchRequestOptions): Promise<FetchResult>;
}
