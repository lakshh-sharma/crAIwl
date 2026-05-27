/**
 * End-to-end compile.
 *
 * Pipeline:
 *   1. Infer the output field schema from the goal (+ optional user fields).
 *   2. Synthesize ranked locators for every field against the cleaned DOM.
 *   3. Drop locators that don't resolve; flag any required field left with
 *      zero working candidates.
 *   4. Assemble a complete StrategyConfig and parse it through the canonical
 *      Zod schema so the result is guaranteed to be a valid config.
 *
 * The compile function is the only entry point the orchestrator and API need
 * to know about. Lower-level building blocks remain exported for tests and
 * for the eventual eval harness.
 */

import {
  parseStrategyConfig,
  STRATEGY_CONFIG_VERSION,
  type LLMProvider,
  type StrategyConfig,
  type StrategyConfigInput,
  type FetchProfile,
  type CrawlScope,
} from '@craiwl/core';
import type { ChunkOptions } from '@craiwl/extractor';
import { inferFieldSchema, type FieldSchemaItem, type UserField } from './field-schema.js';
import { synthesizeLocators, type SynthesizedField } from './synthesize.js';

export type CompileOptions = {
  /** The crawl target entry URL (the page the cleaned HTML came from). */
  entryUrl: string;
  /** Cleaned HTML — output of the extractor's `cleanHtml`. */
  cleanedHtml: string;
  /** Natural-language goal. */
  goal: string;
  /** Optional crawl scope. Default 'single'. */
  scope?: CrawlScope;
  /** Optional fetch profile (which tier proved necessary for the entry URL). Default 'static'. */
  fetchProfile?: FetchProfile;
  /** Optional user-specified fields (take precedence over inferred ones). */
  userFields?: UserField[];
  /** LLM provider. */
  llm: LLMProvider;
  /** Token-budget chunking options. */
  chunk?: ChunkOptions;
  /** Override for "now" (used in tests to get deterministic createdAt). */
  now?: () => Date;
};

export type CompileResult = {
  /** The fully validated config. */
  config: StrategyConfig;
  /** Raw merged field schema (incl. inferred-vs-user provenance). */
  fields: FieldSchemaItem[];
  /** Per-field synthesis output (incl. rejected locator diagnostics). */
  synthesized: SynthesizedField[];
  /** Required fields that failed synthesis. Empty on a happy compile. */
  unresolvedRequired: string[];
  /** Whether the page is multi-record. */
  multiRecord: boolean;
  /** Cost: input/output tokens across all LLM calls in the pipeline. */
  usage: { inputTokens: number; outputTokens: number };
  /** Identifier of the model that drove the compile. */
  model: string;
};

export class CompileError extends Error {
  override readonly name = 'CompileError';
  readonly unresolvedRequired: string[];

  constructor(message: string, unresolvedRequired: string[]) {
    super(message);
    this.unresolvedRequired = unresolvedRequired;
  }
}

const TEMPLATE_ID = 'primary';

export async function compile(opts: CompileOptions): Promise<CompileResult> {
  const now = opts.now ?? (() => new Date());

  // 1. Field schema.
  const schemaResult = await inferFieldSchema(opts.llm, {
    goal: opts.goal,
    ...(opts.userFields ? { userFields: opts.userFields } : {}),
    pageContext: opts.cleanedHtml,
  });

  // 2. Locator synthesis.
  const synthResult = await synthesizeLocators({
    cleanedHtml: opts.cleanedHtml,
    fields: schemaResult.fields,
    llm: opts.llm,
    ...(opts.chunk ? { chunk: opts.chunk } : {}),
  });

  if (synthResult.unresolvedRequired.length > 0) {
    throw new CompileError(
      `compile failed: required fields had no working locator: ${synthResult.unresolvedRequired.join(', ')}`,
      synthResult.unresolvedRequired,
    );
  }

  if (synthResult.fields.length === 0) {
    throw new CompileError('compile failed: synthesis produced zero usable fields', []);
  }

  // 3. Build the page template's fields map.
  const fieldsRecord: Record<
    string,
    StrategyConfigInput['pageTemplates'][number]['fields'][string]
  > = {};
  for (const f of synthResult.fields) {
    fieldsRecord[f.name] = {
      locators: f.locators,
      semanticAnchor: f.semanticAnchor,
      type: f.type,
      required: f.required,
      ...(f.transform ? { transform: f.transform } : {}),
      ...(f.validate ? { validate: f.validate } : {}),
      ...(f.description ? { description: f.description } : {}),
    };
  }

  // 4. Assemble + parse the StrategyConfig.
  const input: StrategyConfigInput = {
    strategyVersion: STRATEGY_CONFIG_VERSION,
    createdBy: synthResult.model,
    createdAt: now().toISOString(),
    lastValidated: null,
    reason: 'compile',
    target: {
      entryUrl: opts.entryUrl,
      scope: opts.scope ?? 'single',
    },
    goal: opts.goal,
    pageTemplates: [
      {
        id: TEMPLATE_ID,
        multiRecord: synthResult.multiRecord,
        ...(synthResult.matchHeuristic ? { matchHeuristic: synthResult.matchHeuristic } : {}),
        fields: fieldsRecord,
      },
    ],
    pagination: { type: 'none' },
    fetchProfile: opts.fetchProfile ?? 'static',
    confidenceFloor: 0.8,
  };

  const config = parseStrategyConfig(input);

  return {
    config,
    fields: schemaResult.fields,
    synthesized: synthResult.fields,
    unresolvedRequired: synthResult.unresolvedRequired,
    multiRecord: synthResult.multiRecord,
    usage: {
      inputTokens: schemaResult.usage.inputTokens + synthResult.usage.inputTokens,
      outputTokens: schemaResult.usage.outputTokens + synthResult.usage.outputTokens,
    },
    model: synthResult.model,
  };
}
