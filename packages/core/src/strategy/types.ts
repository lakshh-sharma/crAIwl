import { z } from 'zod';
import { STRATEGY_CONFIG_VERSION } from './version.js';
import { validateExpression } from './expression.js';
import { validateTransformPipeline } from './transforms.js';

/**
 * StrategyConfig — the compiled extraction program. See
 * `crAIwl-technical-design.md` §2.2 for the conceptual overview.
 *
 * The Zod schemas in this file are the **single source of truth** for both:
 *   - runtime parsing/validation in TypeScript
 *   - the JSON Schema we ship for external consumers (`./schema.ts`)
 *
 * Every object uses `.strict()` — unknown fields are rejected. New fields go
 * through a minor version bump, never through silent acceptance.
 */

// ── Primitives ───────────────────────────────────────────────────────────

const semverString = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a semver string like "1.2.3"');

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be kebab-case slug');

const nonEmptyString = z.string().min(1);

const url = z.string().url();

const isoDateTime = z.string().datetime({ offset: true });

const confidence = z.number().min(0).max(1);

// ── FieldSpec ────────────────────────────────────────────────────────────

export const fieldType = z.enum(['string', 'number', 'integer', 'boolean', 'date', 'url']);
export type FieldType = z.infer<typeof fieldType>;

export const fieldSpec = z
  .object({
    /**
     * Ranked locators tried in order at execute time. The first that resolves
     * AND passes `validate` wins. ≥1 required — this is the resilience
     * guarantee from §2.2 ("multiple locators per field, ranked").
     */
    locators: z.array(nonEmptyString).min(1),
    /**
     * Natural-language description of what the field semantically is.
     * Self-heal uses this string to re-derive a locator when all of the
     * existing ones break.
     */
    semanticAnchor: nonEmptyString,
    type: fieldType,
    /**
     * Pipe-composed transform chain, e.g. `"stripCurrency|toFloat"`. The
     * registry of legal transforms is in `./transforms.ts`; an unknown
     * transform name fails parsing here, not at extraction time.
     */
    transform: z
      .string()
      .min(1)
      .superRefine((pipeline, ctx) => {
        const result = validateTransformPipeline(pipeline);
        if (!result.valid) {
          ctx.addIssue({
            code: 'custom',
            message: result.error,
          });
        }
      })
      .optional(),
    /**
     * Sandboxed expression evaluated against the extracted value, e.g.
     * `"value>=0 && value<100000"` or `"len>0 && len<60"`. The grammar is
     * defined in `./expression.ts`; malformed expressions are rejected
     * here at config-load time, not at runtime.
     */
    validate: z
      .string()
      .min(1)
      .superRefine((expr, ctx) => {
        const result = validateExpression(expr);
        if (!result.valid) {
          ctx.addIssue({
            code: 'custom',
            message: `invalid validate expression: ${result.error}`,
          });
        }
      })
      .optional(),
    required: z.boolean().default(true),
    description: z.string().optional(),
  })
  .strict();

export type FieldSpec = z.infer<typeof fieldSpec>;

// ── PageTemplate ─────────────────────────────────────────────────────────

export const pageTemplate = z
  .object({
    id: slug,
    /**
     * Locator (or pipe-separated alternatives) that selects the repeating
     * record region. `null` / omitted means "the whole page is one record."
     */
    matchHeuristic: z.string().min(1).optional(),
    /**
     * `true` when one page yields many records (e.g. a list of pricing cards);
     * `false` when each page is one record (e.g. a single doc article).
     * Inferred at compile time; persisted so executor and pagination logic
     * don't have to re-detect.
     */
    multiRecord: z.boolean().default(false),
    fields: z.record(slug, fieldSpec).refine((m) => Object.keys(m).length >= 1, {
      message: 'a page template must define at least one field',
    }),
  })
  .strict();

export type PageTemplate = z.infer<typeof pageTemplate>;

// ── Pagination (discriminated union) ─────────────────────────────────────

export const pagination = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z
    .object({
      type: z.literal('next-link'),
      /** Locator for the `next` link/button. */
      locator: nonEmptyString,
      maxPages: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('numbered'),
      /** URL template with `{page}` placeholder, e.g. `/blog?page={page}`. */
      urlTemplate: nonEmptyString,
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('cursor'),
      /** Query param name carrying the cursor. */
      paramName: nonEmptyString,
      /** Locator that yields the next cursor value from the rendered page. */
      locator: nonEmptyString,
      maxPages: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('infinite-scroll'),
      maxIterations: z.number().int().positive().optional(),
      stableThresholdMs: z.number().int().positive().optional(),
    })
    .strict(),
]);

export type Pagination = z.infer<typeof pagination>;

// ── Fetch profile & scope ─────────────────────────────────────────────────

export const fetchProfile = z.enum(['static', 'impersonate', 'headless', 'proxy']);
export type FetchProfile = z.infer<typeof fetchProfile>;

export const crawlScope = z.enum(['single', 'section', 'site']);
export type CrawlScope = z.infer<typeof crawlScope>;

export const configReason = z.enum(['compile', 'self-heal', 'manual-edit']);
export type ConfigReason = z.infer<typeof configReason>;

// ── Top-level StrategyConfig ─────────────────────────────────────────────

export const strategyConfig = z
  .object({
    strategyVersion: semverString.default(STRATEGY_CONFIG_VERSION),
    /**
     * Provenance: who authored this version. `claude-opus-4-7` for compiled
     * configs, `user:<id>` for manual edits, `self-heal:<run-id>` for repairs.
     */
    createdBy: nonEmptyString,
    createdAt: isoDateTime,
    lastValidated: isoDateTime.nullable().default(null),
    /** Why this version exists. Drives diff display + audit summaries. */
    reason: configReason,

    target: z
      .object({
        entryUrl: url,
        scope: crawlScope,
      })
      .strict(),

    goal: nonEmptyString,
    pageTemplates: z.array(pageTemplate).min(1),
    pagination: pagination.default({ type: 'none' }),
    fetchProfile,
    confidenceFloor: confidence.default(0.8),
  })
  .strict();

export type StrategyConfig = z.infer<typeof strategyConfig>;
export type StrategyConfigInput = z.input<typeof strategyConfig>;
