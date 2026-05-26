import { FetchError, type FetchRequestOptions, type FetchResult, type Fetcher } from './types.js';

export type TierDecisionReason =
  | 't0-ok'
  | 't0-blocked'
  | 't0-error'
  | 't0-missing-content'
  | 't2-fallback'
  | 't2-error';

export type TierDecision = {
  url: string;
  chosen: 'static' | 'headless';
  reason: TierDecisionReason;
  t0Status?: number;
  t2Status?: number;
};

export type AutoTierOptions = {
  /** Tier 0 (plain HTTP) fetcher. */
  static: Fetcher;
  /** Tier 2 (headless browser) fetcher. */
  headless: Fetcher;
  /**
   * Substrings or attribute names that MUST appear in the response body for
   * Tier 0 to be considered successful. The caller derives these from the
   * field anchors / locators it expects to extract. Empty array means "any
   * 200 response from Tier 0 is fine."
   */
  contentFingerprints?: string[];
  /**
   * HTTP statuses that force escalation to Tier 2 regardless of body. Defaults
   * to challenge codes commonly emitted by anti-bot middleware.
   */
  escalateStatuses?: number[];
  /** Callback to record the decision (for logs, audit, dashboards). */
  onDecision?: (decision: TierDecision) => void;
};

export type AutoTierResult = FetchResult & { decision: TierDecision };

const DEFAULT_ESCALATE_STATUSES = [401, 403, 429, 503];

/**
 * Auto-tier fetch — try Tier 0 first, escalate to Tier 2 when the response
 * indicates the cheaper tier can't see the content (challenge status,
 * network failure, or the expected anchors missing from raw HTML).
 *
 * The winning tier is reported back via `decision` so the orchestrator can
 * pin it into the StrategyConfig's `fetchProfile` and skip the ladder on
 * subsequent runs.
 */
export async function autoTierFetch(
  url: string,
  opts: AutoTierOptions,
  reqOpts: FetchRequestOptions = {},
): Promise<AutoTierResult> {
  const escalateStatuses = opts.escalateStatuses ?? DEFAULT_ESCALATE_STATUSES;

  let t0Body: FetchResult;
  try {
    t0Body = await opts.static.fetch(url, reqOpts);
    if (!escalateStatuses.includes(t0Body.status) && t0Body.status < 400) {
      if (containsAllFingerprints(t0Body.body, opts.contentFingerprints)) {
        return finish(
          t0Body,
          {
            url,
            chosen: 'static',
            reason: 't0-ok',
            t0Status: t0Body.status,
          },
          opts.onDecision,
        );
      }
      // T0 returned 2xx/3xx but content fingerprints didn't show up.
      const decision: TierDecision = {
        url,
        chosen: 'headless',
        reason: 't0-missing-content',
        t0Status: t0Body.status,
      };
      return escalate(url, opts, reqOpts, decision);
    }
    // T0 hit a 4xx/5xx the caller considers escalation-worthy.
    if (escalateStatuses.includes(t0Body.status)) {
      const decision: TierDecision = {
        url,
        chosen: 'headless',
        reason: 't0-blocked',
        t0Status: t0Body.status,
      };
      return escalate(url, opts, reqOpts, decision);
    }
    // Other 4xx (404, 410, …) — that's the real answer, no escalation.
    return finish(
      t0Body,
      {
        url,
        chosen: 'static',
        reason: 't0-ok',
        t0Status: t0Body.status,
      },
      opts.onDecision,
    );
  } catch (err) {
    const decision: TierDecision = { url, chosen: 'headless', reason: 't0-error' };
    return escalate(url, opts, reqOpts, decision, err);
  }
}

function finish(
  result: FetchResult,
  decision: TierDecision,
  onDecision?: (d: TierDecision) => void,
): AutoTierResult {
  onDecision?.(decision);
  return { ...result, decision };
}

async function escalate(
  url: string,
  opts: AutoTierOptions,
  reqOpts: FetchRequestOptions,
  decision: TierDecision,
  cause?: unknown,
): Promise<AutoTierResult> {
  try {
    const t2 = await opts.headless.fetch(url, reqOpts);
    const finalDecision: TierDecision = { ...decision, t2Status: t2.status };
    opts.onDecision?.(finalDecision);
    return { ...t2, decision: finalDecision };
  } catch (err) {
    opts.onDecision?.({ ...decision, reason: 't2-error' });
    throw new FetchError(`auto-tier escalation failed for ${url}`, {
      cause: cause ?? err,
    });
  }
}

function containsAllFingerprints(body: string, fingerprints?: string[]): boolean {
  if (!fingerprints || fingerprints.length === 0) return true;
  for (const f of fingerprints) {
    if (!body.includes(f)) return false;
  }
  return true;
}
