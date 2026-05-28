import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@craiwl/core';
import { repairField } from './repair.js';

const redesignedHtml = `<!doctype html>
<html><body>
  <article>
    <h1 class="article-title">New Title</h1>
    <p class="article-body">Page body.</p>
  </article>
</body></html>`;

describe('repairField', () => {
  it('returns the first proposed locator that resolves on the cleaned DOM', async () => {
    const llm = new MockLLMProvider(() => ({
      newLocators: ['.article-title', 'h1'],
    }));
    const result = await repairField({
      fieldName: 'title',
      semanticAnchor: 'main article heading',
      type: 'string',
      brokenLocators: ['h1#old-id', '.old-class'],
      cleanedHtml: redesignedHtml,
      llm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newLocator).toBe('.article-title');
  });

  it('falls back to the second candidate when the first does not resolve', async () => {
    const llm = new MockLLMProvider(() => ({
      newLocators: ['.does-not-exist', 'h1.article-title'],
    }));
    const result = await repairField({
      fieldName: 'title',
      semanticAnchor: 'heading',
      type: 'string',
      brokenLocators: ['#old'],
      cleanedHtml: redesignedHtml,
      llm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newLocator).toBe('h1.article-title');
  });

  it('returns all-candidates-invalid when no proposed locator resolves', async () => {
    const llm = new MockLLMProvider(() => ({
      newLocators: ['.no-match-1', '.no-match-2'],
    }));
    const result = await repairField({
      fieldName: 'title',
      semanticAnchor: 'heading',
      type: 'string',
      brokenLocators: ['#old'],
      cleanedHtml: redesignedHtml,
      llm,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('all-candidates-invalid');
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('returns llm-error when the provider call fails', async () => {
    const llm = new MockLLMProvider(() => {
      throw new Error('429 rate-limited');
    });
    const result = await repairField({
      fieldName: 'title',
      semanticAnchor: 'heading',
      type: 'string',
      brokenLocators: ['#old'],
      cleanedHtml: redesignedHtml,
      llm,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('llm-error');
  });

  it('mentions the broken locators in the prompt so the model knows what failed', async () => {
    let userText = '';
    const llm = new MockLLMProvider((_, opts) => {
      userText = opts.messages[0]!.content;
      return { newLocators: ['.article-title', 'h1'] };
    });
    await repairField({
      fieldName: 'title',
      semanticAnchor: 'heading',
      type: 'string',
      brokenLocators: ['h1#legacy-id', '.legacy-class'],
      cleanedHtml: redesignedHtml,
      llm,
    });
    expect(userText).toContain('h1#legacy-id');
    expect(userText).toContain('.legacy-class');
    expect(userText).toContain('Semantic description: heading');
  });

  it('truncates very large pages so the prompt stays bounded', async () => {
    let userText = '';
    const llm = new MockLLMProvider((_, opts) => {
      userText = opts.messages[0]!.content;
      return { newLocators: ['h1', 'h2'] };
    });
    const huge = '<html><body><h1>x</h1>' + 'y'.repeat(50_000) + '</body></html>';
    await repairField({
      fieldName: 'title',
      semanticAnchor: 'heading',
      type: 'string',
      brokenLocators: ['#nope'],
      cleanedHtml: huge,
      llm,
      maxHtmlChars: 5_000,
    });
    expect(userText.length).toBeLessThan(8_000);
  });
});
