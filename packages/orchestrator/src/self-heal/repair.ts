/**
 * Single-field locator repair.
 *
 * When the executor reports that every ranked locator for a field missed,
 * we re-invoke the LLM in a tightly scoped repair call: just this one
 * field, just this one page. The model gets the field's semantic anchor
 * (what the field IS, not where to find it) plus the locators that used
 * to work, and emits 2 ranked replacements that should resolve on the
 * new DOM. Every candidate is validated against the actual page before
 * we accept it — a model that fabricates a new "selector" that doesn't
 * resolve gets rejected at the door.
 */

import { z } from 'zod';
import type { LLMProvider, LLMTool } from '@craiwl/core';
import {
  parseHtml,
  testLocatorOnDom,
  type LocatorTestResult,
} from '../compile/locator-validate.js';

const repairResponse = z.object({
  newLocators: z.array(z.string().min(1)).min(2),
});

const REPAIR_TOOL: LLMTool<z.infer<typeof repairResponse>> = {
  name: 'emit_repair_locator',
  description: 'Emit replacement locators for a broken field on a redesigned page.',
  inputSchema: {
    type: 'object',
    properties: {
      newLocators: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
      },
    },
    required: ['newLocators'],
    additionalProperties: false,
  },
  outputSchema: repairResponse,
};

const SYSTEM_PROMPT = `You repair a single broken locator on a redesigned page.

Inputs:
- The field's semantic description (what content it represents).
- Its declared type.
- The locators that USED to work but no longer resolve.
- A cleaned snapshot of the current DOM.

Emit exactly 2 ranked CSS or XPath locators (best-first) that find the same semantic content on the NEW DOM. Use stable hooks: ids, semantic class names, data-* attributes. Avoid auto-generated hashed class names. Do not emit Playwright/Selenium pseudo-selectors.`;

export type RepairFieldInput = {
  fieldName: string;
  semanticAnchor: string;
  type: string;
  brokenLocators: string[];
  cleanedHtml: string;
  llm: LLMProvider;
  /** Truncation cap for the prompt's DOM snippet. Default 20kB. */
  maxHtmlChars?: number;
};

export type RepairFieldResult =
  | {
      ok: true;
      newLocator: string;
      candidates: LocatorTestResult[];
      usage: { inputTokens: number; outputTokens: number };
      model: string;
    }
  | {
      ok: false;
      reason: 'llm-error' | 'all-candidates-invalid';
      candidates?: LocatorTestResult[];
      error?: string;
    };

const DEFAULT_MAX_HTML_CHARS = 20_000;

export async function repairField(input: RepairFieldInput): Promise<RepairFieldResult> {
  const maxChars = input.maxHtmlChars ?? DEFAULT_MAX_HTML_CHARS;
  const userMsg = `Field name: ${input.fieldName}
Semantic description: ${input.semanticAnchor}
Declared type: ${input.type}

Locators that USED to work (now failing — DOM has changed):
${input.brokenLocators.map((l) => `  ${l}`).join('\n')}

Current cleaned DOM:
\`\`\`html
${input.cleanedHtml.slice(0, maxChars)}
\`\`\``;

  let result;
  try {
    result = await input.llm.callStructured(REPAIR_TOOL, {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
      temperature: 0,
    });
  } catch (err) {
    return { ok: false, reason: 'llm-error', error: (err as Error).message };
  }

  const dom = parseHtml(input.cleanedHtml);
  const candidates: LocatorTestResult[] = result.value.newLocators.map((loc) =>
    testLocatorOnDom(dom, loc),
  );
  const winner = candidates.find((c) => c.resolves);
  if (!winner) {
    return { ok: false, reason: 'all-candidates-invalid', candidates };
  }
  return {
    ok: true,
    newLocator: winner.locator,
    candidates,
    usage: result.usage,
    model: result.model,
  };
}
