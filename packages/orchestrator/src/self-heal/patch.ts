/**
 * Apply repaired locators to a StrategyConfig.
 *
 * The repair appends the new locator to the END of the field's ranked
 * candidate list. Old locators are deliberately retained so previously
 * crawled pages with the old DOM shape still extract cleanly — on those
 * pages the old locator wins; on the redesigned ones, the executor falls
 * through to the new one.
 *
 * Every patch bumps the config's `lastValidated` and switches `reason`
 * to `self-heal` so the version store can tell repair commits apart
 * from compile commits in the audit trail.
 */

import { parseStrategyConfig, type StrategyConfig } from '@craiwl/core';

export type RepairPatch = {
  templateId: string;
  fieldName: string;
  newLocator: string;
};

export type ApplyOptions = {
  now?: () => Date;
};

export function applyRepairPatches(
  config: StrategyConfig,
  patches: RepairPatch[],
  opts: ApplyOptions = {},
): StrategyConfig {
  if (patches.length === 0) return config;
  const now = opts.now ?? (() => new Date());

  // Round-trip through JSON to detach from the caller's reference.
  const draft = JSON.parse(JSON.stringify(config)) as StrategyConfig;

  for (const patch of patches) {
    const template = draft.pageTemplates.find((t) => t.id === patch.templateId);
    if (!template) continue;
    const field = template.fields[patch.fieldName];
    if (!field) continue;
    if (field.locators.includes(patch.newLocator)) continue;
    field.locators.push(patch.newLocator);
  }

  draft.lastValidated = now().toISOString();
  draft.reason = 'self-heal';

  // Re-parse so any drift in the patched shape fails loudly here rather than
  // at execute time. parseStrategyConfig also re-runs the validate-expression
  // and transform-pipeline checks on every field, which is what we want.
  return parseStrategyConfig(draft);
}
