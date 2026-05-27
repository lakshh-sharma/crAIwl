/**
 * Step 2 of compile: locator synthesis.
 *
 * Given a cleaned HTML body and a field schema, ask the LLM for ranked
 * locator candidates per field (CSS or XPath), plus a semantic anchor,
 * an optional transform pipeline, and an optional validate expression.
 *
 * Every locator the model proposes is run against the actual DOM. Locators
 * that don't resolve are dropped before the field even reaches the config
 * builder. A required field with zero surviving locators is flagged as
 * unresolved so the caller can refuse to emit a config that would be
 * dead on arrival.
 *
 * Template detection (one record per page vs. many) is folded into the
 * same call so the model can use the DOM shape to decide.
 */

import { z } from 'zod';
import { chunkForBudget, type ChunkOptions } from '@craiwl/extractor';
import type { LLMProvider, LLMTool } from '@craiwl/core';
import type { FieldSchemaItem } from './field-schema.js';
import { parseHtml, testLocatorOnDom, type LocatorTestResult } from './locator-validate.js';

const synthesizedField = z.object({
  name: z.string().min(1),
  locators: z.array(z.string().min(1)).min(2),
  semanticAnchor: z.string().min(1),
  transform: z.string().optional(),
  validate: z.string().optional(),
});
export type SynthesizedFieldRaw = z.infer<typeof synthesizedField>;

const synthesisResponse = z.object({
  fields: z.array(synthesizedField).min(1),
  multiRecord: z.boolean(),
  matchHeuristic: z.string().min(1).optional(),
});

const SYSTEM_PROMPT = `You write extraction programs as ranked locator candidates against a cleaned DOM.

Output rules per field:
- locators[] MUST contain at least 2 candidates, ranked best-first. Each must be either a CSS selector OR an XPath expression. Use XPath only when CSS cannot express the intent (e.g. matching by text). Do not use Playwright/Selenium pseudo-selectors.
- semanticAnchor is a short natural-language description of what the field IS on this page (e.g. "the plan name in the pricing card header"). Used later for self-heal.
- transform is optional, a pipe-composed pipeline (e.g. "stripCurrency|toFloat", "trim|toFloat", "iso8601"). Only specify a transform when the raw text needs cleanup to match the declared type.
- validate is optional, a small predicate like "len>0 && len<60" or "value>=0 && value<100000". Only specify when there's a clear numeric/length bound.

Page shape:
- Set multiRecord=true when the page contains multiple records of the same shape (e.g. pricing tiers, listing rows). Set false when the whole page is one record (e.g. a single doc article).
- When multiRecord=true, also provide matchHeuristic — a CSS or XPath selector for the repeating element. Field locators must then resolve relative to one such element (the executor scopes them per match).

Quality bar:
- Prefer selectors anchored on stable hooks: ids, semantic class names, data- attributes. Avoid auto-generated hashed class names.
- The first locator should be your best guess; the second is a fallback that survives common HTML rewrites.
- Never invent fields the user did not ask for.`;

const SYNTHESIS_TOOL: LLMTool<z.infer<typeof synthesisResponse>> = {
  name: 'emit_strategy',
  description: 'Emit the ranked locators, semantic anchors, and template shape for the page.',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            locators: { type: 'array', minItems: 2, items: { type: 'string' } },
            semanticAnchor: { type: 'string' },
            transform: { type: 'string' },
            validate: { type: 'string' },
          },
          required: ['name', 'locators', 'semanticAnchor'],
          additionalProperties: false,
        },
      },
      multiRecord: { type: 'boolean' },
      matchHeuristic: { type: 'string' },
    },
    required: ['fields', 'multiRecord'],
    additionalProperties: false,
  },
  outputSchema: synthesisResponse,
};

export type SynthesizedField = {
  name: string;
  type: FieldSchemaItem['type'];
  required: boolean;
  description: string;
  /** Locators the model proposed that ACTUALLY resolve on the source DOM, ranked best-first. */
  locators: string[];
  /** Per-locator diagnostics from the validator (including the rejected ones). */
  locatorTests: LocatorTestResult[];
  semanticAnchor: string;
  transform?: string;
  validate?: string;
};

export type SynthesisOptions = {
  cleanedHtml: string;
  fields: FieldSchemaItem[];
  llm: LLMProvider;
  /** Token-budget chunking options for the cleaned HTML before it goes to the model. */
  chunk?: ChunkOptions;
};

export type SynthesisResult = {
  fields: SynthesizedField[];
  multiRecord: boolean;
  matchHeuristic?: string;
  /** Names of required fields that ended up with zero working locators. */
  unresolvedRequired: string[];
  /** Tokens of HTML actually sent to the model (post-chunking). */
  inputHtmlTokens: number;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export async function synthesizeLocators(opts: SynthesisOptions): Promise<SynthesisResult> {
  const chunked = chunkForBudget(opts.cleanedHtml, opts.chunk ?? {});

  const fieldSchemaSummary = opts.fields.map((f) => ({
    name: f.name,
    type: f.type,
    required: f.required,
    description: f.description,
  }));

  const userMessage = `Field schema to populate (one entry per field):
${JSON.stringify(fieldSchemaSummary, null, 2)}

Cleaned DOM:
\`\`\`html
${chunked.html}
\`\`\``;

  const result = await opts.llm.callStructured(SYNTHESIS_TOOL, {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0,
  });

  // Validate every locator against the actual DOM and drop the ones that don't resolve.
  const dom = parseHtml(opts.cleanedHtml);
  const fieldsByName = new Map(opts.fields.map((f) => [f.name, f]));
  const synthesized: SynthesizedField[] = [];
  const unresolvedRequired: string[] = [];

  for (const raw of result.value.fields) {
    const spec = fieldsByName.get(raw.name);
    // The model may have hallucinated a field name that isn't in the schema — skip it.
    if (!spec) continue;

    const tests = raw.locators.map((loc) => testLocatorOnDom(dom, loc));
    const working = tests.filter((t) => t.resolves && !t.error).map((t) => t.locator);

    if (working.length === 0 && spec.required) {
      unresolvedRequired.push(spec.name);
    }
    if (working.length === 0) continue; // skip fields with no working locator; required ones are already flagged

    const field: SynthesizedField = {
      name: spec.name,
      type: spec.type,
      required: spec.required,
      description: spec.description,
      locators: working,
      locatorTests: tests,
      semanticAnchor: raw.semanticAnchor,
    };
    if (raw.transform) field.transform = raw.transform;
    if (raw.validate) field.validate = raw.validate;
    synthesized.push(field);
  }

  return {
    fields: synthesized,
    multiRecord: result.value.multiRecord,
    ...(result.value.matchHeuristic ? { matchHeuristic: result.value.matchHeuristic } : {}),
    unresolvedRequired,
    inputHtmlTokens: chunked.finalTokens,
    model: result.model,
    usage: result.usage,
  };
}
