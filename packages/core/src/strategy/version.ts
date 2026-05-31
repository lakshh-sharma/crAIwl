/**
 * Semantic versioning rules for StrategyConfig payloads.
 *
 * The version stamped on a config (`strategyVersion`) describes the *shape* of
 * the config, not the targeted site. Two configs with the same `strategyVersion`
 * can be parsed by the same code path.
 *
 * - **MAJOR** — incompatible schema change: a required field was removed or
 *   re-typed, a discriminated-union variant was deleted, or an enum lost a
 *   member. Old configs must be migrated before they load.
 *
 * - **MINOR** — additive change: a new optional field, a new pagination type,
 *   a new transform/locator dialect. Old configs continue to load unchanged.
 *
 * - **PATCH** — documentation, default-value tweaks, or wording. No behavioural
 *   change at parse time.
 *
 * The current version is exported below. Bump it deliberately (and in the same
 * PR as the schema change) — this is the durable contract self-heal and
 * scheduling rely on.
 */
export const STRATEGY_CONFIG_VERSION = '1.1.0' as const;

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export type ParsedSemver = { major: number; minor: number; patch: number };

export function parseSemver(input: string): ParsedSemver | undefined {
  const m = SEMVER_RE.exec(input);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function isStrategyVersionCompatible(version: string): boolean {
  const current = parseSemver(STRATEGY_CONFIG_VERSION)!;
  const incoming = parseSemver(version);
  if (!incoming) return false;
  // Loader is forward-compatible within the same major.
  return incoming.major === current.major && incoming.minor <= current.minor;
}
