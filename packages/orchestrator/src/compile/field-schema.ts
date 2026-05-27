/**
 * Step 1 of compile: turn a natural-language goal (and optional user-specified
 * fields) into a normalized field schema. User-specified fields take
 * precedence and are tagged inferred=false; LLM-proposed fields fill in the
 * gaps and are tagged inferred=true.
 */

import { z } from 'zod';
import type { LLMProvider, LLMTool } from '@craiwl/core';

export const fieldType = z.enum(['string', 'number', 'boolean', 'url', 'date', 'array']);
export type FieldType = z.infer<typeof fieldType>;

export const fieldSchemaItem = z.object({
  name: z.string().min(1),
  type: fieldType,
  required: z.boolean(),
  description: z.string().min(1),
  /** True when this field came from the LLM, false when supplied by the user. */
  inferred: z.boolean(),
});
export type FieldSchemaItem = z.infer<typeof fieldSchemaItem>;

const inferredResponse = z.object({
  fields: z.array(fieldSchemaItem).min(1),
});

export type UserField = {
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string;
};

export type InferFieldsOptions = {
  goal: string;
  /** Fields the user supplied verbatim. These win over inferred fields with the same name. */
  userFields?: UserField[];
  /** Small DOM/text excerpt to give the model page context. Truncated to ~4kB. */
  pageContext?: string;
};

const SYSTEM_PROMPT = `You are designing the OUTPUT SCHEMA for a web extraction job.

Given a natural-language goal and (optionally) a small page excerpt, produce a list of fields the user wants extracted from each record on the page.

Rules:
- Use lowercase snake_case for field names.
- Choose the narrowest type that fits: string, number, boolean, url, date, or array.
- Mark a field required ONLY when the goal clearly demands it; default false.
- Write a short (<= 15 words) description per field that explains WHAT the field is, not WHERE to find it.
- Prefer 3-8 fields. Do not invent fields the goal does not imply.
- If the goal names specific fields, use those exact names.
- Mark every field you propose with inferred=true. The caller layers user-specified fields on top.`;

const FIELD_SCHEMA_TOOL: LLMTool<z.infer<typeof inferredResponse>> = {
  name: 'emit_field_schema',
  description: 'Emit the structured field schema for the extraction goal.',
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
            type: { type: 'string', enum: ['string', 'number', 'boolean', 'url', 'date', 'array'] },
            required: { type: 'boolean' },
            description: { type: 'string' },
            inferred: { type: 'boolean' },
          },
          required: ['name', 'type', 'required', 'description', 'inferred'],
          additionalProperties: false,
        },
      },
    },
    required: ['fields'],
    additionalProperties: false,
  },
  outputSchema: inferredResponse,
};

export type InferFieldsResult = {
  fields: FieldSchemaItem[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

const MAX_CONTEXT_CHARS = 4_000;

export async function inferFieldSchema(
  llm: LLMProvider,
  opts: InferFieldsOptions,
): Promise<InferFieldsResult> {
  const userFieldsSummary =
    opts.userFields && opts.userFields.length > 0
      ? `User has specified these fields verbatim. Treat them as authoritative — do not rename them and do not propose duplicates:\n${JSON.stringify(opts.userFields, null, 2)}`
      : 'User has not specified any fields. Infer all fields from the goal.';

  const pageContextText = opts.pageContext
    ? `\n\nPage excerpt (truncated):\n${opts.pageContext.slice(0, MAX_CONTEXT_CHARS)}`
    : '';

  const userMessage = `Goal: ${opts.goal}\n\n${userFieldsSummary}${pageContextText}`;

  const result = await llm.callStructured(FIELD_SCHEMA_TOOL, {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0,
  });

  const merged: FieldSchemaItem[] = [];
  const seen = new Set<string>();

  for (const uf of opts.userFields ?? []) {
    const name = normalizeName(uf.name);
    if (!name || seen.has(name)) continue;
    merged.push({
      name,
      type: uf.type,
      required: uf.required ?? false,
      description: uf.description?.trim() || `User-specified field "${uf.name}".`,
      inferred: false,
    });
    seen.add(name);
  }

  for (const item of result.value.fields) {
    const name = normalizeName(item.name);
    if (!name || seen.has(name)) continue;
    merged.push({ ...item, name, inferred: true });
    seen.add(name);
  }

  return {
    fields: merged,
    model: result.model,
    usage: result.usage,
  };
}

function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
