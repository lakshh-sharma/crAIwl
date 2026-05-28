import { describe, expect, it } from 'vitest';
import { parseStrategyConfig, type StrategyConfigInput } from '@craiwl/core';
import { applyRepairPatches } from './patch.js';

const baseConfig = parseStrategyConfig({
  strategyVersion: '1.0.0',
  createdBy: 'test',
  createdAt: '2026-05-01T00:00:00.000Z',
  lastValidated: null,
  reason: 'compile',
  target: { entryUrl: 'https://example.com/', scope: 'site' },
  goal: 'test',
  pageTemplates: [
    {
      id: 'page',
      multiRecord: false,
      fields: {
        title: {
          locators: ['h1#old-id', '.legacy-title'],
          semanticAnchor: 'heading',
          type: 'string',
          required: true,
        },
        body: {
          locators: ['.body'],
          semanticAnchor: 'body',
          type: 'string',
          required: false,
        },
      },
    },
  ],
  pagination: { type: 'none' },
  fetchProfile: 'static',
  confidenceFloor: 0.8,
} as StrategyConfigInput);

const fixedNow = () => new Date('2026-05-29T12:00:00.000Z');

describe('applyRepairPatches', () => {
  it('appends the new locator to the ranked list (old ones preserved)', () => {
    const patched = applyRepairPatches(
      baseConfig,
      [{ templateId: 'page', fieldName: 'title', newLocator: '.article-title' }],
      { now: fixedNow },
    );
    expect(patched.pageTemplates[0]!.fields['title']!.locators).toEqual([
      'h1#old-id',
      '.legacy-title',
      '.article-title',
    ]);
  });

  it('switches reason to self-heal and updates lastValidated', () => {
    const patched = applyRepairPatches(
      baseConfig,
      [{ templateId: 'page', fieldName: 'title', newLocator: '.t' }],
      { now: fixedNow },
    );
    expect(patched.reason).toBe('self-heal');
    expect(patched.lastValidated).toBe('2026-05-29T12:00:00.000Z');
  });

  it('does not mutate the input config', () => {
    const before = JSON.stringify(baseConfig);
    applyRepairPatches(baseConfig, [{ templateId: 'page', fieldName: 'title', newLocator: '.t' }], {
      now: fixedNow,
    });
    expect(JSON.stringify(baseConfig)).toBe(before);
  });

  it('returns the same reference when no patches are supplied', () => {
    expect(applyRepairPatches(baseConfig, [])).toBe(baseConfig);
  });

  it('silently ignores patches that target unknown templates or fields', () => {
    const patched = applyRepairPatches(
      baseConfig,
      [
        { templateId: 'unknown', fieldName: 'title', newLocator: '.x' },
        { templateId: 'page', fieldName: 'unknown', newLocator: '.x' },
      ],
      { now: fixedNow },
    );
    expect(patched.pageTemplates[0]!.fields['title']!.locators).toEqual([
      'h1#old-id',
      '.legacy-title',
    ]);
  });

  it('dedupes when the same locator gets proposed twice', () => {
    const patched = applyRepairPatches(
      baseConfig,
      [
        { templateId: 'page', fieldName: 'title', newLocator: '.new' },
        { templateId: 'page', fieldName: 'title', newLocator: '.new' },
      ],
      { now: fixedNow },
    );
    const locs = patched.pageTemplates[0]!.fields['title']!.locators;
    expect(locs.filter((l) => l === '.new')).toHaveLength(1);
  });
});
