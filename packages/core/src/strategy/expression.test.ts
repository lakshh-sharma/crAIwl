import { describe, it, expect } from 'vitest';
import { compileExpression, validateExpression, ExpressionError } from './expression.js';

const test = (expr: string, value: unknown) => compileExpression(expr).test(value);

describe('expression evaluator: numeric ranges', () => {
  it('value>=0 && value<100000 accepts valid prices', () => {
    expect(test('value>=0 && value<100000', 99)).toBe(true);
    expect(test('value>=0 && value<100000', 0)).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(test('value>=0 && value<100000', -1)).toBe(false);
    expect(test('value>=0 && value<100000', 100000)).toBe(false);
  });

  it('handles negative literals and decimals', () => {
    expect(test('value>=-1.5 && value<=1.5', 0)).toBe(true);
    expect(test('value>=-1.5 && value<=1.5', 2)).toBe(false);
  });
});

describe('expression evaluator: string length', () => {
  it('len>0 && len<60 enforces non-empty/short strings', () => {
    expect(test('len>0 && len<60', 'hello')).toBe(true);
    expect(test('len>0 && len<60', '')).toBe(false);
    expect(test('len>0 && len<60', 'x'.repeat(60))).toBe(false);
  });

  it('len is undefined for non-string/non-array values, so comparisons fail closed', () => {
    expect(test('len>0', 5)).toBe(false);
    expect(test('len>0', null)).toBe(false);
  });

  it('len works on arrays too', () => {
    expect(test('len==3', [1, 2, 3])).toBe(true);
  });
});

describe('expression evaluator: regex matching', () => {
  it('matches /pattern/ against string values', () => {
    expect(test('value matches /^[a-z]+$/', 'hello')).toBe(true);
    expect(test('value matches /^[a-z]+$/', 'Hello')).toBe(false);
  });

  it('regex with flags', () => {
    expect(test('value matches /^hello$/i', 'HELLO')).toBe(true);
  });

  it('non-string values cannot match', () => {
    expect(test('value matches /\\d+/', 12345)).toBe(false);
  });
});

describe('expression evaluator: boolean composition', () => {
  it('respects && / || / ! precedence', () => {
    expect(test('!(value<0) && value<10', 5)).toBe(true);
    expect(test('value<0 || value>5', 7)).toBe(true);
    expect(test('value<0 || value>5', 3)).toBe(false);
  });

  it('parentheses group correctly', () => {
    expect(test('(value>=0 && value<10) || value==42', 42)).toBe(true);
  });
});

describe('expression evaluator: equality', () => {
  it('compares with == and !=', () => {
    expect(test('value=="hello"', 'hello')).toBe(true);
    expect(test('value!=null', 'hello')).toBe(true);
    expect(test('value==null', null)).toBe(true);
  });
});

describe('expression evaluator: type-mismatch fails closed', () => {
  it('numeric comparison on a string returns false', () => {
    expect(test('value>=0', 'not-a-number')).toBe(false);
  });
});

describe('expression evaluator: parser errors', () => {
  it('throws ExpressionError on garbage', () => {
    expect(() => compileExpression('value !! foo')).toThrow(ExpressionError);
  });

  it('throws on unknown identifiers (no global access)', () => {
    expect(() => compileExpression('process.exit==0')).toThrow(ExpressionError);
    expect(() => compileExpression('globalThis>1')).toThrow(ExpressionError);
    expect(() => compileExpression('constructor==null')).toThrow(ExpressionError);
  });

  it('throws on unterminated strings', () => {
    expect(() => compileExpression('value=="hi')).toThrow(ExpressionError);
  });

  it('throws on unterminated regex', () => {
    expect(() => compileExpression('value matches /abc')).toThrow(ExpressionError);
  });

  it('throws on trailing input', () => {
    expect(() => compileExpression('value>0 extra')).toThrow(ExpressionError);
  });
});

describe('validateExpression', () => {
  it('returns valid for legal expressions', () => {
    expect(validateExpression('value>=0 && value<100000')).toEqual({ valid: true });
  });

  it('returns invalid with a message for malformed expressions', () => {
    const result = validateExpression('value &&&& 0');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBeTypeOf('string');
  });
});

describe('expression evaluator: sandboxing', () => {
  it('cannot access prototypes via the identifier "constructor"', () => {
    expect(() => compileExpression('constructor.constructor("return process")()')).toThrow();
  });

  it('cannot reach global names', () => {
    for (const name of ['process', 'global', 'globalThis', 'require', 'eval', '__proto__']) {
      expect(() => compileExpression(`${name}==1`)).toThrow(ExpressionError);
    }
  });
});
