import { describe, it, expect } from 'vitest';
import {
  parseStrategyConfig,
  safeParseStrategyConfig,
  strategyConfig,
  STRATEGY_CONFIG_JSON_SCHEMA,
  STRATEGY_CONFIG_VERSION,
  isStrategyVersionCompatible,
  parseSemver,
  type StrategyConfigInput,
} from './index.js';

/**
 * The canonical example from `crAIwl-technical-design.md` §2.2, lightly
 * adapted (template-id slug, `multiRecord` made explicit, ISO timestamps
 * with offsets) so it survives strict validation. This fixture is what
 * compile-phase prompts are graded against.
 */
const designDocExample: StrategyConfigInput = {
  strategyVersion: STRATEGY_CONFIG_VERSION,
  createdBy: 'claude-opus-4-7',
  createdAt: '2026-05-25T00:00:00Z',
  lastValidated: '2026-05-25T00:00:00Z',
  reason: 'compile',
  target: { entryUrl: 'https://example.com/pricing', scope: 'section' },
  goal: 'Extract all pricing tiers with price, billing period, and features',
  pageTemplates: [
    {
      id: 'pricing-card',
      matchHeuristic: "div[data-testid='tier'] | section.pricing .card",
      multiRecord: true,
      fields: {
        'tier-name': {
          locators: ['h3.tier-name', '[data-tier] h3', 'xpath://h3[1]'],
          semanticAnchor: 'heading of the pricing card',
          type: 'string',
          validate: 'len>0 && len<60',
          required: true,
        },
        'price-monthly': {
          locators: ['.price .amount', "span[itemprop='price']"],
          semanticAnchor: 'the dollar figure shown largest in the card',
          type: 'number',
          transform: 'stripCurrency|toFloat',
          validate: 'value>=0 && value<100000',
          required: true,
        },
      },
    },
  ],
  pagination: { type: 'none' },
  fetchProfile: 'static',
  confidenceFloor: 0.8,
};

describe('strategyConfig schema', () => {
  it('accepts the design-doc canonical example', () => {
    const parsed = parseStrategyConfig(designDocExample);
    expect(parsed.target.entryUrl).toBe('https://example.com/pricing');
    expect(parsed.pageTemplates[0]!.fields['tier-name']!.locators).toHaveLength(3);
  });

  it('round-trips: parse → serialize → parse is stable', () => {
    const first = parseStrategyConfig(designDocExample);
    const serialized = JSON.stringify(first);
    const second = parseStrategyConfig(JSON.parse(serialized));
    expect(second).toEqual(first);
  });

  it('rejects unknown top-level fields', () => {
    const result = safeParseStrategyConfig({ ...designDocExample, surpriseField: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields inside a fieldSpec', () => {
    const cloned = structuredClone(designDocExample);
    (cloned.pageTemplates[0]!.fields['tier-name'] as Record<string, unknown>).extra = 1;
    expect(safeParseStrategyConfig(cloned).success).toBe(false);
  });

  it('requires at least one locator per field', () => {
    const cloned = structuredClone(designDocExample);
    cloned.pageTemplates[0]!.fields['tier-name']!.locators = [];
    expect(safeParseStrategyConfig(cloned).success).toBe(false);
  });

  it('requires at least one page template', () => {
    const cloned = structuredClone(designDocExample);
    cloned.pageTemplates = [];
    expect(safeParseStrategyConfig(cloned).success).toBe(false);
  });

  it('requires at least one field per page template', () => {
    const cloned = structuredClone(designDocExample);
    cloned.pageTemplates[0]!.fields = {};
    expect(safeParseStrategyConfig(cloned).success).toBe(false);
  });

  it('applies defaults: required=true, confidenceFloor=0.8, pagination=none, lastValidated=null', () => {
    const minimal: StrategyConfigInput = {
      createdBy: 'user:tester',
      createdAt: '2026-05-25T00:00:00Z',
      reason: 'manual-edit',
      target: { entryUrl: 'https://example.com', scope: 'single' },
      goal: 'pull the title',
      pageTemplates: [
        {
          id: 'doc',
          fields: {
            title: {
              locators: ['h1'],
              semanticAnchor: 'main heading',
              type: 'string',
            },
          },
        },
      ],
      fetchProfile: 'static',
    };
    const parsed = parseStrategyConfig(minimal);
    expect(parsed.confidenceFloor).toBe(0.8);
    expect(parsed.pagination).toEqual({ type: 'none' });
    expect(parsed.lastValidated).toBeNull();
    expect(parsed.pageTemplates[0]!.fields['title']!.required).toBe(true);
    expect(parsed.strategyVersion).toBe(STRATEGY_CONFIG_VERSION);
  });

  it('discriminates pagination variants', () => {
    const next = strategyConfig.shape.pagination.safeParse({
      type: 'next-link',
      locator: 'a.next',
    });
    expect(next.success).toBe(true);

    const malformed = strategyConfig.shape.pagination.safeParse({
      type: 'next-link',
      // missing required locator
    });
    expect(malformed.success).toBe(false);

    const wrongShape = strategyConfig.shape.pagination.safeParse({
      type: 'cursor',
      paramName: 'after',
      locator: 'a[data-cursor]',
    });
    expect(wrongShape.success).toBe(true);
  });

  it('rejects invalid entryUrl', () => {
    const cloned = structuredClone(designDocExample);
    cloned.target.entryUrl = 'not a url';
    expect(safeParseStrategyConfig(cloned).success).toBe(false);
  });

  it('rejects confidenceFloor outside [0,1]', () => {
    const cloned = structuredClone(designDocExample);
    cloned.confidenceFloor = 1.5;
    expect(safeParseStrategyConfig(cloned).success).toBe(false);
  });
});

describe('STRATEGY_CONFIG_JSON_SCHEMA', () => {
  it('is a valid JSON Schema document with the expected dialect', () => {
    const schema = STRATEGY_CONFIG_JSON_SCHEMA as Record<string, unknown>;
    expect(schema.$schema).toContain('json-schema.org');
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeTypeOf('object');
  });

  it('exposes the top-level fields the design doc names', () => {
    const props = (STRATEGY_CONFIG_JSON_SCHEMA as { properties: Record<string, unknown> })
      .properties;
    for (const key of [
      'strategyVersion',
      'createdBy',
      'createdAt',
      'reason',
      'target',
      'goal',
      'pageTemplates',
      'pagination',
      'fetchProfile',
      'confidenceFloor',
    ]) {
      expect(props).toHaveProperty(key);
    }
  });
});

describe('STRATEGY_CONFIG_VERSION + isStrategyVersionCompatible', () => {
  it('current version parses', () => {
    expect(parseSemver(STRATEGY_CONFIG_VERSION)).toBeDefined();
  });

  it('accepts same-major, same-or-lower minor', () => {
    expect(isStrategyVersionCompatible(STRATEGY_CONFIG_VERSION)).toBe(true);
    expect(isStrategyVersionCompatible('1.0.0')).toBe(true);
  });

  it('rejects future major versions', () => {
    expect(isStrategyVersionCompatible('2.0.0')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isStrategyVersionCompatible('not-a-version')).toBe(false);
  });
});
