import { describe, it, expect } from 'vitest';
import {
  REGISTERED_TRANSFORMS,
  UnknownTransformError,
  compileTransformPipeline,
  getTransform,
  isRegisteredTransform,
  validateTransformPipeline,
} from './transforms.js';

describe('individual transforms', () => {
  it('trim removes surrounding whitespace', () => {
    expect(getTransform('trim')('  hi  ')).toBe('hi');
  });

  it('normalizeWhitespace collapses runs', () => {
    expect(getTransform('normalizeWhitespace')('a   b\tc\n  d')).toBe('a b c d');
  });

  it('lower / upper', () => {
    expect(getTransform('lower')('HELLO')).toBe('hello');
    expect(getTransform('upper')('hi')).toBe('HI');
  });

  it('stripCurrency strips symbols and separators', () => {
    expect(getTransform('stripCurrency')('$1,234.56')).toBe('1234.56');
    expect(getTransform('stripCurrency')('€ 999')).toBe('999');
  });

  it('stripCurrency turns parenthesized negatives into a minus', () => {
    expect(getTransform('stripCurrency')('($42.00)')).toBe('-42.00');
  });

  it('toFloat / toInt', () => {
    expect(getTransform('toFloat')('3.14')).toBe(3.14);
    expect(getTransform('toFloat')('not a number')).toBeUndefined();
    expect(getTransform('toInt')('42.9')).toBe(42);
  });

  it('parseDate returns ISO string or undefined', () => {
    expect(getTransform('parseDate')('2026-05-25')).toMatch(/2026-05-25T/);
    expect(getTransform('parseDate')('not a date')).toBeUndefined();
  });

  it('absoluteUrl passes through absolute URLs', () => {
    expect(getTransform('absoluteUrl')('https://example.com/x')).toBe('https://example.com/x');
    expect(getTransform('absoluteUrl')('/relative')).toBeUndefined();
  });

  it('toBool handles common truthy/falsy strings', () => {
    expect(getTransform('toBool')('Yes')).toBe(true);
    expect(getTransform('toBool')('NO')).toBe(false);
    expect(getTransform('toBool')('1')).toBe(true);
    expect(getTransform('toBool')('maybe')).toBeUndefined();
  });

  it('nullIfEmpty', () => {
    expect(getTransform('nullIfEmpty')('')).toBeNull();
    expect(getTransform('nullIfEmpty')('   ')).toBeNull();
    expect(getTransform('nullIfEmpty')('hi')).toBe('hi');
  });
});

describe('pipeline composition', () => {
  it('compiles a multi-step pipeline left to right', () => {
    const fn = compileTransformPipeline('stripCurrency|toFloat');
    expect(fn('$ 1,234.56')).toBe(1234.56);
  });

  it('trim|nullIfEmpty: clean then nullify', () => {
    const fn = compileTransformPipeline('trim|nullIfEmpty');
    expect(fn('  ')).toBeNull();
    expect(fn('  ok  ')).toBe('ok');
  });

  it('empty pipeline is identity', () => {
    expect(compileTransformPipeline('')('hi')).toBe('hi');
    expect(compileTransformPipeline('  |  ')('hi')).toBe('hi');
  });

  it('unknown transform name throws at compile time', () => {
    expect(() => compileTransformPipeline('trim|frobnicate')).toThrow(UnknownTransformError);
  });
});

describe('registry surface', () => {
  it('REGISTERED_TRANSFORMS contains the documented names', () => {
    for (const name of [
      'trim',
      'normalizeWhitespace',
      'stripCurrency',
      'toFloat',
      'toInt',
      'parseDate',
      'absoluteUrl',
      'toBool',
      'nullIfEmpty',
      'lower',
      'upper',
    ]) {
      expect(REGISTERED_TRANSFORMS).toContain(name);
    }
  });

  it('isRegisteredTransform', () => {
    expect(isRegisteredTransform('trim')).toBe(true);
    expect(isRegisteredTransform('frobnicate')).toBe(false);
  });

  it('validateTransformPipeline reports clearly on unknown names', () => {
    expect(validateTransformPipeline('trim|toFloat')).toEqual({ valid: true });
    const bad = validateTransformPipeline('trim|frobnicate');
    expect(bad.valid).toBe(false);
    if (!bad.valid) expect(bad.error).toContain('frobnicate');
  });
});
