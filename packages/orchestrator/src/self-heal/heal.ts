/**
 * Page-scoped self-heal.
 *
 * The crawl loop calls this after each page's deterministic execute(). If
 * any required field failed AND we still have repair budget, we re-invoke
 * the LLM ONLY for those fields, append working replacements to the
 * config, and re-run the executor on the same cleaned HTML. The repaired
 * config is the function's return value so the orchestrator can use it
 * for the next page (a redesign usually breaks the same field across the
 * whole section).
 */

import { execute, type ExtractionResult } from '@craiwl/extractor';
import type { LLMProvider, StrategyConfig, FieldSpec } from '@craiwl/core';
import { repairField } from './repair.js';
import { applyRepairPatches, type RepairPatch } from './patch.js';
import type { RepairBudget } from './budget.js';

export type HealPageInput = {
  config: StrategyConfig;
  cleanedHtml: string;
  sourceUrl: string;
  /** Execution result from running `config` against `cleanedHtml`. */
  execution: ExtractionResult;
  llm: LLMProvider;
  budget: RepairBudget;
  now?: () => Date;
};

export type RepairAttempt = {
  templateId: string;
  fieldName: string;
} & (
  | { ok: true; newLocator: string }
  | { ok: false; reason: 'llm-error' | 'all-candidates-invalid' | 'budget-exhausted' }
);

export type HealPageResult = {
  /** Updated config — same reference as input when no repairs succeeded. */
  config: StrategyConfig;
  /** Execution result against the (possibly repaired) config. */
  execution: ExtractionResult;
  attempts: RepairAttempt[];
  /** Total tokens spent on repair this page. */
  usage: { inputTokens: number; outputTokens: number };
};

export async function healPageFailures(input: HealPageInput): Promise<HealPageResult> {
  const candidates = collectFailedRequired(input.config, input.execution);
  if (candidates.length === 0) {
    return {
      config: input.config,
      execution: input.execution,
      attempts: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const attempts: RepairAttempt[] = [];
  const applied: RepairPatch[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const cand of candidates) {
    if (!input.budget.tryConsume()) {
      attempts.push({
        templateId: cand.templateId,
        fieldName: cand.fieldName,
        ok: false,
        reason: 'budget-exhausted',
      });
      continue;
    }

    const result = await repairField({
      fieldName: cand.fieldName,
      semanticAnchor: cand.spec.semanticAnchor,
      type: cand.spec.type,
      brokenLocators: cand.spec.locators,
      cleanedHtml: input.cleanedHtml,
      llm: input.llm,
    });

    if (result.ok) {
      applied.push({
        templateId: cand.templateId,
        fieldName: cand.fieldName,
        newLocator: result.newLocator,
      });
      attempts.push({
        templateId: cand.templateId,
        fieldName: cand.fieldName,
        ok: true,
        newLocator: result.newLocator,
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
    } else {
      attempts.push({
        templateId: cand.templateId,
        fieldName: cand.fieldName,
        ok: false,
        reason: result.reason,
      });
    }
  }

  if (applied.length === 0) {
    return { config: input.config, execution: input.execution, attempts, usage };
  }

  const patched = applyRepairPatches(input.config, applied, {
    ...(input.now ? { now: input.now } : {}),
  });
  const reExecuted = execute({
    cleanedHtml: input.cleanedHtml,
    config: patched,
    sourceUrl: input.sourceUrl,
    ...(input.now ? { now: input.now } : {}),
  });

  return { config: patched, execution: reExecuted, attempts, usage };
}

type FailedCandidate = {
  templateId: string;
  fieldName: string;
  spec: FieldSpec;
};

function collectFailedRequired(
  config: StrategyConfig,
  execution: ExtractionResult,
): FailedCandidate[] {
  // Build the set of (templateId, fieldName) where any record had a failure.
  const failedKeys = new Set<string>();
  for (const rec of execution.records) {
    for (const [fieldName, outcome] of Object.entries(rec.fields)) {
      if (!outcome.ok) failedKeys.add(`${rec.templateId}.${fieldName}`);
    }
  }

  const out: FailedCandidate[] = [];
  for (const template of config.pageTemplates) {
    for (const [fieldName, spec] of Object.entries(template.fields)) {
      if (!spec.required) continue;
      if (!failedKeys.has(`${template.id}.${fieldName}`)) continue;
      out.push({ templateId: template.id, fieldName, spec });
    }
  }
  return out;
}
