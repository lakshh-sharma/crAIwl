/**
 * URL canonicalization for frontier dedup.
 *
 * The goal is to collapse trivially-different URLs that point at the same
 * page so we don't crawl them twice. We don't try to be exhaustive — common
 * tracking parameters, fragment, trailing slash, and host casing are the
 * rules that actually matter. Anything more aggressive risks dropping
 * meaningful params (`?page=2`).
 */

const DEFAULT_TRACKING_PARAMS = new Set([
  // UTM family
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_name',
  'utm_id',
  // Click IDs
  'gclid',
  'fbclid',
  'dclid',
  'msclkid',
  'yclid',
  'twclid',
  // Analytics
  '_ga',
  '_gl',
  'mc_cid',
  'mc_eid',
  'igshid',
  // Vague referrer hints
  'ref',
  'referrer',
  'src',
  'source',
]);

export type CanonicalizeOptions = {
  /** Override the tracking-parameter blocklist. */
  trackingParams?: Set<string>;
  /**
   * Params that must be kept even if they appear in the tracking blocklist.
   * Use this for params your crawl actually cares about (e.g. `?page=2`).
   */
  paramAllowlist?: Set<string>;
};

/**
 * Returns the canonical form of a URL, or `null` if the input doesn't parse.
 *
 * Rules:
 *  - Host lowercased; default ports dropped (80/443).
 *  - Fragment removed.
 *  - Tracking params stripped (UTM, click IDs, common analytics).
 *  - Remaining query params sorted alphabetically for stable hashing.
 *  - Trailing slash removed on non-root paths (`/docs/` → `/docs`).
 */
export function canonicalize(rawUrl: string, opts: CanonicalizeOptions = {}): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  const tracking = opts.trackingParams ?? DEFAULT_TRACKING_PARAMS;
  const allowlist = opts.paramAllowlist ?? new Set<string>();

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    if (tracking.has(k) && !allowlist.has(k)) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

/**
 * Returns true when `url` is in scope relative to `entryUrl`.
 *  - 'single' — only the exact entry URL (after canonicalization).
 *  - 'section' — same origin AND `url.path` starts with the entry's path prefix.
 *  - 'site' — same origin only.
 */
export type CrawlScopeMode = 'single' | 'section' | 'site';

export function isInScope(url: string, entryUrl: string, scope: CrawlScopeMode): boolean {
  let u: URL;
  let e: URL;
  try {
    u = new URL(url);
    e = new URL(entryUrl);
  } catch {
    return false;
  }
  if (u.origin !== e.origin) return false;
  if (scope === 'site') return true;
  if (scope === 'section') {
    // For an entry like `/docs`, the user's natural intent for "section" is
    // "everything at or under /docs". Treat the entry's path itself as the
    // prefix when it has no trailing slash (the URL plus a `/` boundary),
    // and require a path-boundary match so `/docs` doesn't match `/docsearch`.
    if (e.pathname === '/' || e.pathname === '') return true;
    const prefix = e.pathname.replace(/\/+$/, '');
    return u.pathname === prefix || u.pathname.startsWith(`${prefix}/`);
  }
  // 'single' — only the exact entry URL after canonicalization
  return canonicalize(url) === canonicalize(entryUrl);
}
