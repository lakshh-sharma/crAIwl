import { describe, it, expect } from 'vitest';
import { diffStrategyConfigs, formatConfigDiff } from './diff.js';
import { parseStrategyConfig } from './schema.js';
import type { StrategyConfigInput } from './types.js';

const base: StrategyConfigInput = {
  createdBy: 'claude-opus-4-7',
  createdAt: '2026-05-25T00:00:00Z',
  reason: 'compile',
  target: { entryUrl: 'https://example.com', scope: 'single' },
  goal: 'pull the title',
  pageTemplates: [
    {
      id: 'doc',
      fields: {
        title: {
          locators: ['h1', 'h1.title'],
          semanticAnchor: 'main heading',
          type: 'string',
          required: true,
        },
      },
    },
  ],
  fetchProfile: 'static',
};

const clone = <T>(v: T): T => structuredClone(v);

describe('diffStrategyConfigs', () => {
  it('reports identical when configs match', () => {
    const a = parseStrategyConfig(base);
    const b = parseStrategyConfig(base);
    const d = diffStrategyConfigs(a, b);
    expect(d.identical).toBe(true);
    expect(d.changes).toHaveLength(0);
    expect(formatConfigDiff(d)).toBe('(no changes)');
  });

  it('flags a changed primitive leaf', () => {
    const a = parseStrategyConfig(base);
    const after = clone(base);
    after.confidenceFloor = 0.5;
    const b = parseStrategyConfig(after);
    const d = diffStrategyConfigs(a, b);
    expect(d.changes).toContainEqual({
      path: 'confidenceFloor',
      op: 'changed',
      before: 0.8,
      after: 0.5,
    });
  });

  it('flags a new locator inserted into a ranked list', () => {
    const a = parseStrategyConfig(base);
    const after = clone(base);
    after.pageTemplates[0]!.fields['title']!.locators = ['h1', 'h1.title', '.new-title'];
    const b = parseStrategyConfig(after);
    const d = diffStrategyConfigs(a, b);
    const added = d.changes.find((c) => c.path.endsWith('locators[2]'));
    expect(added).toBeDefined();
    expect(added?.op).toBe('added');
    expect(added?.after).toBe('.new-title');
  });

  it('flags a removed required-field flag flip', () => {
    const a = parseStrategyConfig(base);
    const after = clone(base);
    after.pageTemplates[0]!.fields['title']!.required = false;
    const b = parseStrategyConfig(after);
    const d = diffStrategyConfigs(a, b);
    expect(
      d.changes.some((c) => c.path.endsWith('required') && c.before === true && c.after === false),
    ).toBe(true);
  });

  it('handles a discriminant change in pagination', () => {
    const a = parseStrategyConfig(base);
    const after = clone(base);
    after.pagination = { type: 'next-link', locator: 'a.next' };
    const b = parseStrategyConfig(after);
    const d = diffStrategyConfigs(a, b);
    expect(d.changes.some((c) => c.path === 'pagination.type')).toBe(true);
    expect(d.changes.some((c) => c.path === 'pagination.locator' && c.op === 'added')).toBe(true);
  });

  it('formatConfigDiff renders human-readable lines', () => {
    const a = parseStrategyConfig(base);
    const after = clone(base);
    after.confidenceFloor = 0.6;
    after.pageTemplates[0]!.fields['title']!.locators = ['h1'];
    const b = parseStrategyConfig(after);
    const rendered = formatConfigDiff(diffStrategyConfigs(a, b));
    expect(rendered).toMatch(/~ confidenceFloor: 0.8 → 0.6/);
    expect(rendered).toMatch(/- pageTemplates\[0\]\.fields\.title\.locators\[1\]: "h1\.title"/);
  });
});
