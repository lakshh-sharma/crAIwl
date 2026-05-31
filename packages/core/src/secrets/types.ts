/**
 * Pluggable secrets provider.
 *
 * The contract is intentionally narrow: name in, optional value out. Real-world
 * implementations can be backed by env vars, a local file, an OS keychain,
 * or a hosted vault — the orchestrator never sees the secret material until
 * a request is about to be sent, and never logs it. ADR-008 documents the
 * decision to keep the interface this thin.
 *
 * Names should be treated as opaque labels (no validation here) so users
 * can pick whatever fits their workflow. Provider implementations may
 * normalize names (env-var provider uppercases and prefixes) — keep those
 * rules in the provider, not the interface.
 */

export interface SecretsProvider {
  /** Look up `name`. Returns undefined when not set, never throws on miss. */
  get(name: string): Promise<string | undefined>;
  /**
   * Persist a secret. Providers that don't support writes (env vars) throw
   * `SecretsReadOnlyError`. The orchestrator surfaces that as a clear
   * error rather than silently dropping the secret.
   */
  set(name: string, value: string): Promise<void>;
  /** Names of all stored secrets. Values must NOT appear in the result. */
  list(): Promise<string[]>;
  /** Remove `name`. Returns true when something was removed. */
  remove(name: string): Promise<boolean>;
  /** Human-readable identifier — appears in logs/UI for "which provider holds this secret." */
  readonly label: string;
}

export class SecretsReadOnlyError extends Error {
  override readonly name = 'SecretsReadOnlyError';
  constructor(provider: string) {
    super(`secrets provider "${provider}" is read-only`);
  }
}

export class SecretNotFoundError extends Error {
  override readonly name = 'SecretNotFoundError';
  constructor(public readonly secretName: string) {
    super(`secret "${secretName}" not found in any configured provider`);
  }
}
