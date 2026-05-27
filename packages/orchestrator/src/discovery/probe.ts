/**
 * Heuristic doc-path probing.
 *
 * When a site has no sitemap, we fall back to GETting the conventional doc
 * roots and seeing which ones come back with real content. Results carry the
 * probed path so the orchestrator can attribute candidate URLs back to their
 * source (vs. sitemap / nav).
 */

import type { Fetcher } from '@craiwl/fetcher';

export const DEFAULT_DOC_PATHS: readonly string[] = [
  '/docs',
  '/doc',
  '/documentation',
  '/api',
  '/api-docs',
  '/api-reference',
  '/reference',
  '/guide',
  '/guides',
  '/manual',
  '/handbook',
  '/help',
  '/learn',
  '/tutorials',
  '/developers',
];

export type ProbeResult = {
  url: string;
  path: string;
  status: number;
  /** True when status is 2xx and the body looked substantial (> minContentLength). */
  resolved: boolean;
};

export type ProbeOptions = {
  fetcher: Fetcher;
  /** Paths to probe. Defaults to `DEFAULT_DOC_PATHS`. */
  paths?: readonly string[];
  /** Minimum body length to call a probe "resolved". Default 256 bytes. */
  minContentLength?: number;
  /** Concurrent in-flight probes. Default 4. */
  concurrency?: number;
};

export async function probeDocPaths(origin: string, opts: ProbeOptions): Promise<ProbeResult[]> {
  const baseOrigin = new URL(origin).origin;
  const paths = opts.paths ?? DEFAULT_DOC_PATHS;
  const minLen = opts.minContentLength ?? 256;
  const concurrency = Math.max(1, opts.concurrency ?? 4);

  const out: ProbeResult[] = new Array(paths.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = next++;
      if (idx >= paths.length) return;
      const path = paths[idx]!;
      const url = `${baseOrigin}${path}`;
      try {
        const res = await opts.fetcher.fetch(url, { method: 'GET' });
        const ok = res.status >= 200 && res.status < 300 && res.body.length >= minLen;
        out[idx] = { url: res.finalUrl || url, path, status: res.status, resolved: ok };
      } catch {
        out[idx] = { url, path, status: 0, resolved: false };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()));
  return out;
}
