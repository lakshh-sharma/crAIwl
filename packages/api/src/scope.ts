/**
 * Scope-confirmation pipeline.
 *
 * The endpoint a UI calls before committing to a real crawl:
 *
 *   1. Fetch the entry page.
 *   2. Compile a StrategyConfig from the goal + cleaned page.
 *   3. Return the config plus a short estimate the user can sanity-check:
 *      how many templates were inferred, how many on-page links the entry
 *      has, and what the confidence floor will be.
 *
 * Compile is the only LLM-billed step. The estimate is derived from the
 * compiled config + the entry page DOM — no extra calls.
 *
 * Auth-gated entry URLs are supported the same way `runJob` handles them
 * — the caller supplies `auth` + `secrets` and we resolve a header bundle
 * once, used for the entry fetch.
 */

import { JSDOM } from 'jsdom';
import { cleanHtml } from '@craiwl/extractor';
import {
  auditedProvider,
  InMemoryAuditLog,
  resolveAuthHeaders,
  type AuditLog,
  type AuthProfile,
  type LLMProvider,
  type SecretsProvider,
  type StrategyConfig,
} from '@craiwl/core';
import type { Fetcher } from '@craiwl/fetcher';
import { compile, type UserField } from '@craiwl/orchestrator';

export type ScopeConfirmRequest = {
  entryUrl: string;
  goal: string;
  /** Optional user-supplied fields to merge with the inferred ones. */
  userFields?: UserField[];
  scope?: 'single' | 'section' | 'site';
  /** Optional auth profile — resolved against `secrets` before the entry fetch. */
  auth?: AuthProfile;
};

export type ScopeConfirmDeps = {
  fetcher: Fetcher;
  llm: LLMProvider;
  /** Required when `request.auth` is set. */
  secrets?: SecretsProvider;
  /** Audit sink — defaults to an InMemoryAuditLog. */
  auditLog?: AuditLog;
  /** Override clock for deterministic tests. */
  now?: () => Date;
};

export type ScopeEstimate = {
  templatesProposed: number;
  fieldsProposed: number;
  requiredFields: number;
  /** Confidence floor that will be used at extraction time. */
  confidenceFloor: number;
  /** Distinct same-origin links found on the entry page — a hint at crawl size. */
  sampleOriginLinks: number;
  /** Up to 10 sample URLs the crawl would follow. */
  sampleLinks: string[];
  /** True when the config carries an auth profile. */
  authenticated: boolean;
  /** Bytes of cleaned HTML the LLM saw — useful when the bill looks off. */
  cleanedHtmlBytes: number;
};

export type ScopeConfirmResponse = {
  config: StrategyConfig;
  estimate: ScopeEstimate;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export class ScopeConfirmError extends Error {
  constructor(
    message: string,
    /** HTTP status the server should return. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ScopeConfirmError';
  }
}

export async function confirmScope(
  request: ScopeConfirmRequest,
  deps: ScopeConfirmDeps,
): Promise<ScopeConfirmResponse> {
  if (!request.entryUrl) throw new ScopeConfirmError('entryUrl is required', 400);
  if (!request.goal) throw new ScopeConfirmError('goal is required', 400);

  const now = deps.now ?? (() => new Date());
  const auditLog = deps.auditLog ?? new InMemoryAuditLog();

  // 1. Resolve auth headers once, the same way runJob does.
  let authHeaders: Record<string, string> | undefined;
  if (request.auth) {
    if (!deps.secrets) {
      throw new ScopeConfirmError('auth was provided but no SecretsProvider is configured', 400);
    }
    const provider = auditedProvider(deps.secrets, { audit: auditLog, reason: 'resolve-auth' });
    authHeaders = await resolveAuthHeaders(request.auth, provider);
  }

  // 2. Fetch entry.
  const entry = await deps.fetcher.fetch(
    request.entryUrl,
    authHeaders ? { headers: { ...authHeaders } } : {},
  );
  if (entry.status >= 400) {
    throw new ScopeConfirmError(`entry URL returned http-${entry.status}`, 502);
  }
  const cleaned = cleanHtml(entry.body);

  // 3. Compile.
  const compileResult = await compile({
    entryUrl: entry.finalUrl || request.entryUrl,
    cleanedHtml: cleaned.html,
    goal: request.goal,
    ...(request.userFields ? { userFields: request.userFields } : {}),
    ...(request.scope ? { scope: request.scope === 'single' ? 'single' : 'site' } : {}),
    llm: deps.llm,
    now,
  });

  let config = compileResult.config;
  if (request.auth) {
    config = { ...config, auth: request.auth };
  }

  // 4. Sample on-origin links from the entry page. The dashboard estimate
  //    uses this to show "we'd start with N candidates" — no parser
  //    differences vs the crawl loop because it shares the same logic.
  const sampleLinks = collectOriginLinks(entry.body, entry.finalUrl || request.entryUrl);

  const estimate: ScopeEstimate = {
    templatesProposed: config.pageTemplates.length,
    fieldsProposed: countFields(config),
    requiredFields: countRequired(config),
    confidenceFloor: config.confidenceFloor,
    sampleOriginLinks: sampleLinks.length,
    sampleLinks: sampleLinks.slice(0, 10),
    authenticated: !!request.auth,
    cleanedHtmlBytes: cleaned.html.length,
  };

  return {
    config,
    estimate,
    usage: compileResult.usage,
    model: compileResult.model,
  };
}

function countFields(config: StrategyConfig): number {
  let n = 0;
  for (const t of config.pageTemplates) n += Object.keys(t.fields).length;
  return n;
}

function countRequired(config: StrategyConfig): number {
  let n = 0;
  for (const t of config.pageTemplates) {
    for (const f of Object.values(t.fields)) if (f.required) n++;
  }
  return n;
}

function collectOriginLinks(html: string, baseUrl: string): string[] {
  try {
    const dom = new JSDOM(html, { url: baseUrl });
    const origin = new URL(baseUrl).origin;
    const anchors = dom.window.document.querySelectorAll('a[href]');
    const out = new Set<string>();
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      try {
        const abs = new URL(href, baseUrl);
        if (abs.origin !== origin) continue;
        abs.hash = '';
        out.add(abs.toString());
      } catch {
        // skip malformed
      }
    }
    return Array.from(out);
  } catch {
    return [];
  }
}
