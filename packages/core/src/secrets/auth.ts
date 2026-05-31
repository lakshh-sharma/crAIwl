/**
 * Auth-profile schema and header resolution.
 *
 * StrategyConfig.auth (when set) describes how to authenticate the crawl's
 * outbound requests. The profile is stored alongside the config so a saved
 * config + a secret-store reference is enough to re-run an authenticated
 * crawl — no extra wiring at run time.
 *
 * Three v1 shapes (all header-based — form login is deferred):
 *
 *   api-key  — header: <name>, value: a template string with `{secret}`
 *              substituted from the named secret. Use this for
 *              `X-API-Key: <token>`-style auth.
 *   bearer   — shorthand for `Authorization: Bearer <secret>`.
 *   basic    — shorthand for `Authorization: Basic base64(user:secret)`.
 *
 * `resolveAuthHeaders` looks the secret(s) up via the supplied
 * SecretsProvider and returns ready-to-attach headers. The resolved string
 * is never logged — that's the caller's contract too. Missing secrets
 * surface as `SecretNotFoundError` rather than silently producing a header
 * with the literal value "undefined".
 */

import { z } from 'zod';
import { SecretNotFoundError, type SecretsProvider } from './types.js';

const nonEmpty = z.string().min(1);

export const authProfile = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('api-key'),
      /** HTTP header name, e.g. "X-API-Key", "Api-Token". */
      header: nonEmpty,
      /**
       * Template applied to the resolved secret. `{secret}` is substituted
       * verbatim. Defaults to just the secret. Use this when the header
       * value needs a prefix (e.g. `Token {secret}`).
       */
      valueTemplate: z.string().default('{secret}'),
      /** Logical secret name — looked up via the SecretsProvider. */
      secret: nonEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal('bearer'),
      secret: nonEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal('basic'),
      username: nonEmpty,
      /** Logical secret name holding the password. */
      secret: nonEmpty,
    })
    .strict(),
]);

export type AuthProfile = z.infer<typeof authProfile>;

export async function resolveAuthHeaders(
  profile: AuthProfile,
  provider: SecretsProvider,
): Promise<Record<string, string>> {
  const secret = await provider.get(profile.secret);
  if (secret === undefined) {
    throw new SecretNotFoundError(profile.secret);
  }

  switch (profile.type) {
    case 'api-key': {
      const value = profile.valueTemplate.replace(/\{secret\}/g, secret);
      return { [profile.header]: value };
    }
    case 'bearer':
      return { Authorization: `Bearer ${secret}` };
    case 'basic': {
      const encoded = Buffer.from(`${profile.username}:${secret}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }
  }
}

/**
 * Redacts an auth header value for safe logging. The actual header name is
 * preserved; the value is replaced with `***`. Use this on any path where
 * headers might be serialized to logs or surfaced to users.
 */
export function redactAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isAuthHeader(k) ? redact(v) : v;
  }
  return out;
}

function isAuthHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'authorization' ||
    lower === 'cookie' ||
    lower.startsWith('x-api') ||
    lower.endsWith('-token') ||
    lower.endsWith('-key')
  );
}

function redact(value: string): string {
  // Preserve the auth-scheme prefix ("Bearer", "Basic") if present so logs
  // remain useful for debugging without leaking the credential itself.
  const m = /^(Bearer|Basic|Token)\s/i.exec(value);
  return m ? `${m[1]} ***` : '***';
}
