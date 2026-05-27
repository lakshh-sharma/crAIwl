import { describe, expect, it } from 'vitest';
import { parseStrategyConfig } from '@craiwl/core';
import { ConfigImportError, exportConfig, importConfig } from './config-io.js';

const cfg = parseStrategyConfig({
  strategyVersion: '1.0.0',
  createdBy: 'test',
  createdAt: '2026-01-15T12:00:00.000Z',
  lastValidated: null,
  reason: 'compile',
  target: { entryUrl: 'https://example.com/', scope: 'single' },
  goal: 'test',
  pageTemplates: [
    {
      id: 'page',
      multiRecord: false,
      fields: {
        title: {
          locators: ['h1'],
          semanticAnchor: 'title',
          type: 'string',
          required: true,
        },
      },
    },
  ],
  pagination: { type: 'none' },
  fetchProfile: 'static',
  confidenceFloor: 0.8,
});

describe('export/import config round-trip', () => {
  it('reproduces an identical config through export → import', () => {
    const serialized = exportConfig(cfg, () => new Date('2026-01-15T12:00:00.000Z'));
    const reimported = importConfig(serialized);
    expect(reimported).toEqual(cfg);
  });

  it('accepts a bare (un-enveloped) config for ergonomics', () => {
    const bare = JSON.stringify(cfg);
    const reimported = importConfig(bare);
    expect(reimported).toEqual(cfg);
  });

  it('throws ConfigImportError on invalid JSON', () => {
    expect(() => importConfig('{ not json')).toThrowError(ConfigImportError);
  });

  it('throws ConfigImportError when the payload is neither envelope nor config', () => {
    expect(() => importConfig('{"unrelated": "object"}')).toThrowError(ConfigImportError);
  });

  it('throws ConfigImportError when strategyVersion is incompatible', () => {
    const bad = exportConfig({ ...cfg, strategyVersion: '99.0.0' } as typeof cfg);
    expect(() => importConfig(bad)).toThrowError(/strategyVersion 99.0.0/);
  });
});
