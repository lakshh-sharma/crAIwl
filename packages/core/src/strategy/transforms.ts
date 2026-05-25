/**
 * Registry of named, composable, pure transforms applied to a raw matched
 * value before validation. Transforms are pipe-composed in config strings,
 * e.g. `"stripCurrency|toFloat"`. The whole pipeline is type-agnostic — each
 * step receives whatever the previous one produced; mismatches are caught by
 * the field's `validate` rule downstream.
 *
 * Adding a transform is a public API change: it goes in this file, gets a
 * unit test, and survives a config that uses it surviving a round-trip
 * `parse → serialize → parse`. Removing one is a major version bump.
 */

export type Transform = (value: unknown) => unknown;

class UnknownTransformError extends Error {
  override readonly name = 'UnknownTransformError';
  constructor(public readonly transformName: string) {
    super(`unknown transform '${transformName}'`);
  }
}

export { UnknownTransformError };

// ── Primitive helpers ───────────────────────────────────────────────────

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : v == null ? undefined : String(v);

const trim: Transform = (v) => asString(v)?.trim();

const normalizeWhitespace: Transform = (v) => asString(v)?.replace(/\s+/g, ' ').trim();

const lower: Transform = (v) => asString(v)?.toLowerCase();
const upper: Transform = (v) => asString(v)?.toUpperCase();

// ── Numeric ─────────────────────────────────────────────────────────────

const stripCurrency: Transform = (v) => {
  const s = asString(v);
  if (s === undefined) return undefined;
  // Drop common currency symbols, thousands separators, spaces, surrounding parens.
  return s
    .replace(/[\s,]/g, '')
    .replace(/^\(([^)]+)\)$/, '-$1')
    .replace(/[$€£¥₹]/g, '');
};

const toFloat: Transform = (v) => {
  if (typeof v === 'number') return v;
  const s = asString(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const toInt: Transform = (v) => {
  const n = toFloat(v);
  if (typeof n !== 'number') return undefined;
  return Math.trunc(n);
};

// ── Dates & URLs ────────────────────────────────────────────────────────

const parseDate: Transform = (v) => {
  const s = asString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const absoluteUrl: Transform = (v) => {
  const s = asString(v);
  if (!s) return undefined;
  try {
    // Already absolute → URL parses cleanly.
    return new URL(s).toString();
  } catch {
    // Caller must supply a base via a higher-level wrapper; we don't take
    // arguments here. A relative URL with no base is left for downstream
    // validation to flag.
    return undefined;
  }
};

// ── Booleans & nullables ────────────────────────────────────────────────

const toBool: Transform = (v) => {
  if (typeof v === 'boolean') return v;
  const s = asString(v)?.toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return undefined;
};

const nullIfEmpty: Transform = (v) => {
  if (v === '' || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
};

// ── Registry ────────────────────────────────────────────────────────────

const REGISTRY: Readonly<Record<string, Transform>> = Object.freeze({
  trim,
  normalizeWhitespace,
  lower,
  upper,
  stripCurrency,
  toFloat,
  toInt,
  parseDate,
  absoluteUrl,
  toBool,
  nullIfEmpty,
});

export const REGISTERED_TRANSFORMS = Object.freeze(Object.keys(REGISTRY).sort());

export function isRegisteredTransform(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

export function getTransform(name: string): Transform {
  const t = REGISTRY[name];
  if (!t) throw new UnknownTransformError(name);
  return t;
}

/**
 * Compile a pipe-composed transform string into a single function. Unknown
 * names throw at compile time (not at execution time) — this is what the
 * Zod `transform` field hooks into so configs with typos fail at parse.
 */
export function compileTransformPipeline(pipeline: string): Transform {
  const steps = pipeline
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (steps.length === 0) return (v) => v;
  const fns = steps.map(getTransform);
  return (value) => fns.reduce<unknown>((acc, fn) => fn(acc), value);
}

export type ValidationResult = { valid: true } | { valid: false; error: string };

export function validateTransformPipeline(pipeline: string): ValidationResult {
  try {
    compileTransformPipeline(pipeline);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}
