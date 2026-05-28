import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@craiwl/core';
import { execute, type ExtractionResult } from '@craiwl/extractor';
import { parseStrategyConfig, type StrategyConfigInput } from '@craiwl/core';
import { RepairBudget } from './budget.js';
import { healPageFailures } from './heal.js';

const FIXED_NOW = () => new Date('2026-05-29T12:00:00.000Z');

function buildConfig(): StrategyConfigInput {
  return {
    strategyVersion: '1.0.0',
    createdBy: 'test',
    createdAt: '2026-05-01T00:00:00.000Z',
    lastValidated: null,
    reason: 'compile',
    target: { entryUrl: 'https://example.com/', scope: 'site' },
    goal: 'extract titles',
    pageTemplates: [
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['#legacy-title', '.legacy-title'],
            semanticAnchor: 'main heading',
            type: 'string',
            required: true,
          },
        },
      },
    ],
    pagination: { type: 'none' },
    fetchProfile: 'static',
    confidenceFloor: 0.8,
  };
}

const redesignedHtml = `<!doctype html>
<html><body>
  <article>
    <h1 class="article-title">New Title</h1>
  </article>
</body></html>`;

function runFirstExecute(): {
  config: ReturnType<typeof parseStrategyConfig>;
  execution: ExtractionResult;
} {
  const config = parseStrategyConfig(buildConfig());
  const execution = execute({
    cleanedHtml: redesignedHtml,
    config,
    sourceUrl: 'https://example.com/page',
    now: FIXED_NOW,
  });
  return { config, execution };
}

describe('healPageFailures', () => {
  it('repairs a broken required field, patches the config, and re-extracts cleanly', async () => {
    const { config, execution } = runFirstExecute();
    expect(execution.failureCount).toBe(1);

    const llm = new MockLLMProvider(() => ({
      newLocators: ['.article-title', 'h1'],
    }));
    const budget = new RepairBudget(5);

    const result = await healPageFailures({
      config,
      cleanedHtml: redesignedHtml,
      sourceUrl: 'https://example.com/page',
      execution,
      llm,
      budget,
      now: FIXED_NOW,
    });

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!).toMatchObject({ ok: true, newLocator: '.article-title' });
    expect(result.config.reason).toBe('self-heal');
    // Old locators retained, new one appended.
    expect(result.config.pageTemplates[0]!.fields['title']!.locators).toEqual([
      '#legacy-title',
      '.legacy-title',
      '.article-title',
    ]);
    // Re-executed result actually extracts the value.
    expect(result.execution.failureCount).toBe(0);
    const outcome = result.execution.records[0]!.fields['title']!;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBe('New Title');
    expect(budget.spent).toBe(1);
  });

  it('returns the input config unchanged when no required fields failed', async () => {
    const cleanHtml = `<article><h1 id="legacy-title">Hi</h1></article>`;
    const config = parseStrategyConfig(buildConfig());
    const execution = execute({
      cleanedHtml: cleanHtml,
      config,
      sourceUrl: 'https://example.com/page',
      now: FIXED_NOW,
    });
    const llm = new MockLLMProvider(() => {
      throw new Error('should not be called');
    });
    const result = await healPageFailures({
      config,
      cleanedHtml: cleanHtml,
      sourceUrl: 'https://example.com/page',
      execution,
      llm,
      budget: new RepairBudget(5),
      now: FIXED_NOW,
    });
    expect(result.config).toBe(config);
    expect(result.attempts).toEqual([]);
  });

  it('records budget-exhausted attempts without calling the LLM', async () => {
    const { config, execution } = runFirstExecute();
    const llm = new MockLLMProvider(() => {
      throw new Error('should not be called');
    });
    const budget = new RepairBudget(0);

    const result = await healPageFailures({
      config,
      cleanedHtml: redesignedHtml,
      sourceUrl: 'https://example.com/page',
      execution,
      llm,
      budget,
      now: FIXED_NOW,
    });

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!).toMatchObject({ ok: false, reason: 'budget-exhausted' });
    expect(result.config).toBe(config);
  });

  it('records all-candidates-invalid when the LLM proposes only broken locators', async () => {
    const { config, execution } = runFirstExecute();
    const llm = new MockLLMProvider(() => ({
      newLocators: ['.never-1', '.never-2'],
    }));
    const result = await healPageFailures({
      config,
      cleanedHtml: redesignedHtml,
      sourceUrl: 'https://example.com/page',
      execution,
      llm,
      budget: new RepairBudget(5),
      now: FIXED_NOW,
    });
    expect(result.attempts[0]!).toMatchObject({ ok: false, reason: 'all-candidates-invalid' });
    expect(result.config).toBe(config);
  });

  it('does not attempt repairs for non-required fields that failed', async () => {
    const input = buildConfig();
    input.pageTemplates[0]!.fields['subtitle'] = {
      locators: ['.nope-one', '.nope-two'],
      semanticAnchor: 'subtitle',
      type: 'string',
      required: false,
    };
    const config = parseStrategyConfig(input);
    const execution = execute({
      cleanedHtml: redesignedHtml,
      config,
      sourceUrl: 'https://example.com/page',
      now: FIXED_NOW,
    });

    let calls = 0;
    const llm = new MockLLMProvider(() => {
      calls++;
      return { newLocators: ['.article-title', 'h1'] };
    });
    await healPageFailures({
      config,
      cleanedHtml: redesignedHtml,
      sourceUrl: 'https://example.com/page',
      execution,
      llm,
      budget: new RepairBudget(5),
      now: FIXED_NOW,
    });
    // Only `title` (required) gets a repair call. `subtitle` is best-effort.
    expect(calls).toBe(1);
  });
});
