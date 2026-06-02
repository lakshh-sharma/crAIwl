/**
 * Wraps a SecretsProvider so every successful `get()` records an
 * `secret-accessed` audit event. Misses (returning undefined) are not
 * audited — they're not an access. set/list/remove pass through.
 *
 * This is how we keep audit events out of the provider implementations
 * themselves — the wrapping is a per-run concern, not a per-provider one.
 */

import type { SecretsProvider } from '../secrets/types.js';
import type { AuditLog, SecretAccessedEvent } from './types.js';

export type WrapOptions = {
  audit: AuditLog;
  /** Pipeline stage that triggered the access. Tagged into the event. */
  reason: SecretAccessedEvent['reason'];
  /** Override clock for deterministic tests. */
  now?: () => Date;
};

export function auditedProvider(inner: SecretsProvider, opts: WrapOptions): SecretsProvider {
  const now = opts.now ?? (() => new Date());
  return {
    label: inner.label,
    get: async (name) => {
      const value = await inner.get(name);
      if (value !== undefined) {
        opts.audit.record({
          at: now().toISOString(),
          kind: 'secret-accessed',
          secretName: name,
          providerLabel: inner.label,
          reason: opts.reason,
        });
      }
      return value;
    },
    set: (name, value) => inner.set(name, value),
    list: () => inner.list(),
    remove: (name) => inner.remove(name),
  };
}
