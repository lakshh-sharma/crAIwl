import { describe, it, expect } from 'vitest';
import { safeParseStrategyConfig } from './schema.js';
import type { StrategyConfigInput } from './types.js';

const validConfig = (validate: string): StrategyConfigInput => ({
  createdBy: 'claude-opus-4-7',
  createdAt: '2026-05-25T00:00:00Z',
  reason: 'compile',
  target: { entryUrl: 'https://example.com', scope: 'single' },
  goal: 'test',
  pageTemplates: [
    {
      id: 'doc',
      fields: {
        title: {
          locators: ['h1'],
          semanticAnchor: 'main heading',
          type: 'string',
          validate,
        },
      },
    },
  ],
  fetchProfile: 'static',
});

describe('FieldSpec.validate is checked at config-load time', () => {
  it('accepts a well-formed expression', () => {
    const result = safeParseStrategyConfig(validConfig('len>0 && len<60'));
    expect(result.success).toBe(true);
  });

  it('rejects a malformed expression with a clear message', () => {
    const result = safeParseStrategyConfig(validConfig('value &&&& 0'));
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toContain('invalid validate expression');
    }
  });

  it('rejects expressions that reference disallowed identifiers', () => {
    const result = safeParseStrategyConfig(validConfig('process.exit==0'));
    expect(result.success).toBe(false);
  });
});
