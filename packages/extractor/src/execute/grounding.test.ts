import { describe, expect, it } from 'vitest';
import { checkGrounding, normalizeForGrounding } from './grounding.js';

describe('checkGrounding', () => {
  it('flags grounded when rawText is a substring of sourceText', () => {
    expect(checkGrounding('Hello world', 'The site says: Hello world today.')).toEqual({
      grounded: true,
    });
  });

  it('collapses whitespace before comparing (cosmetic noise is not a fail)', () => {
    expect(checkGrounding('Hello\n   world', 'Hello world appears here.')).toEqual({
      grounded: true,
    });
    expect(checkGrounding('Hello world', '   Hello\nworld\t  trails')).toEqual({ grounded: true });
  });

  it('flags not-grounded with reason="not-in-source" when text is absent', () => {
    expect(checkGrounding('Goodbye', 'Hello world')).toEqual({
      grounded: false,
      reason: 'not-in-source',
    });
  });

  it('catches fabricated content that the page never contained', () => {
    expect(checkGrounding('$99', 'The plan costs $9 a month.')).toEqual({
      grounded: false,
      reason: 'not-in-source',
    });
  });

  it('flags empty-source when the page has no text', () => {
    expect(checkGrounding('anything', '')).toEqual({ grounded: false, reason: 'empty-source' });
  });

  it('flags empty-text when the rawText is empty', () => {
    expect(checkGrounding('   ', 'a page')).toEqual({ grounded: false, reason: 'empty-text' });
  });
});

describe('normalizeForGrounding', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeForGrounding('  Hello\n\tworld  ')).toBe('Hello world');
  });
});
