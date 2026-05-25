/**
 * Tiny purpose-built expression evaluator for per-field `validate` rules.
 *
 * Grammar (recursive descent):
 *
 *   expression := orExpr
 *   orExpr     := andExpr ( '||' andExpr )*
 *   andExpr    := unaryExpr ( '&&' unaryExpr )*
 *   unaryExpr  := '!' unaryExpr | comparison
 *   comparison := primary ( compOp primary )?
 *   compOp     := '==' | '!=' | '>=' | '<=' | '>' | '<' | 'matches'
 *   primary    := number | string | regex | ident | '(' expression ')'
 *   ident      := 'value' | 'len' | 'true' | 'false' | 'null'
 *   number     := -? digits ( '.' digits )?
 *   string     := "…" | '…'    (no escapes — keep it tight)
 *   regex      := /…/[gimsu]*
 *
 * Two identifiers are exposed at evaluation time:
 *   - `value` — the extracted field value (any JSON type)
 *   - `len`   — length of `value` if string/array, else `undefined`
 *
 * Design notes:
 *   - There is **no `eval` and no `Function`**. The AST is walked by hand.
 *   - Comparisons between incompatible types return `false` rather than
 *     throwing. The contract is "did the value pass the rule?" — `false`
 *     is the correct answer for "value is not a number, so `value>=0` is
 *     not satisfied."
 *   - Parse errors fail closed: at config-load time `validateExpression`
 *     surfaces them; at runtime an unrecoverable parse error means the
 *     field is treated as invalid.
 */

export class ExpressionError extends Error {
  override readonly name = 'ExpressionError';
  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(message);
  }
}

export type EvaluationContext = {
  value: unknown;
};

export type CompiledExpression = {
  source: string;
  test(value: unknown): boolean;
};

// ── Lexer ───────────────────────────────────────────────────────────────

type Token =
  | { kind: 'number'; value: number; pos: number }
  | { kind: 'string'; value: string; pos: number }
  | { kind: 'regex'; value: RegExp; pos: number }
  | { kind: 'ident'; value: string; pos: number }
  | { kind: 'op'; value: string; pos: number }
  | { kind: 'lparen' | 'rparen'; pos: number }
  | { kind: 'eof'; pos: number };

const OPS = ['>=', '<=', '==', '!=', '&&', '||', '>', '<', '!'] as const;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = src.length;
  let lastSignificant: Token | undefined;

  const pushTok = (t: Token) => {
    out.push(t);
    if (t.kind !== 'eof') lastSignificant = t;
  };

  while (i < len) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(') {
      pushTok({ kind: 'lparen', pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      pushTok({ kind: 'rparen', pos: i });
      i++;
      continue;
    }

    // Multi-char ops first, then single-char.
    let matched = false;
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        pushTok({ kind: 'op', value: op, pos: i });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (c === '"' || c === "'") {
      const start = i;
      i++;
      let s = '';
      while (i < len && src[i] !== c) {
        s += src[i];
        i++;
      }
      if (i >= len) throw new ExpressionError(`unterminated string`, start);
      i++;
      pushTok({ kind: 'string', value: s, pos: start });
      continue;
    }

    if (c === '/' && canStartRegexAfter(lastSignificant)) {
      const start = i;
      i++;
      let pattern = '';
      while (i < len && src[i] !== '/') {
        if (src[i] === '\\' && i + 1 < len) {
          pattern += src[i]! + src[i + 1]!;
          i += 2;
          continue;
        }
        pattern += src[i];
        i++;
      }
      if (i >= len) throw new ExpressionError('unterminated regex', start);
      i++;
      let flags = '';
      while (i < len && /[gimsuy]/.test(src[i]!)) {
        flags += src[i];
        i++;
      }
      try {
        pushTok({ kind: 'regex', value: new RegExp(pattern, flags), pos: start });
      } catch (err) {
        throw new ExpressionError(`invalid regex: ${(err as Error).message}`, start);
      }
      continue;
    }

    if (c === '-' && /\d/.test(src[i + 1] ?? '')) {
      const numStartsHere = canStartNumberAfter(lastSignificant);
      if (numStartsHere) {
        const start = i;
        i++;
        const [num, consumed] = readNumber(src, i);
        i += consumed;
        pushTok({ kind: 'number', value: -num, pos: start });
        continue;
      }
    }

    if (/\d/.test(c)) {
      const start = i;
      const [num, consumed] = readNumber(src, i);
      i += consumed;
      pushTok({ kind: 'number', value: num, pos: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(c)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_]/.test(src[i]!)) i++;
      pushTok({ kind: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }

    throw new ExpressionError(`unexpected character '${c}'`, i);
  }
  out.push({ kind: 'eof', pos: len });
  return out;
}

function readNumber(src: string, start: number): [number, number] {
  let i = start;
  while (i < src.length && /\d/.test(src[i]!)) i++;
  if (src[i] === '.') {
    i++;
    while (i < src.length && /\d/.test(src[i]!)) i++;
  }
  const text = src.slice(start, i);
  const n = Number(text);
  if (Number.isNaN(n)) throw new ExpressionError(`bad number '${text}'`, start);
  return [n, i - start];
}

function canStartRegexAfter(t: Token | undefined): boolean {
  if (!t) return true;
  if (t.kind === 'op') return true;
  if (t.kind === 'lparen') return true;
  // `matches` is the only ident that can precede a regex literal.
  if (t.kind === 'ident' && t.value === 'matches') return true;
  return false;
}

function canStartNumberAfter(t: Token | undefined): boolean {
  if (!t) return true;
  if (t.kind === 'op') return true;
  if (t.kind === 'lparen') return true;
  return false;
}

// ── Parser ──────────────────────────────────────────────────────────────

type Node =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'regex'; value: RegExp }
  | { type: 'ident'; name: 'value' | 'len' | 'true' | 'false' | 'null' }
  | { type: 'unary'; op: '!'; expr: Node }
  | { type: 'binary'; op: string; left: Node; right: Node };

const ALLOWED_IDENTS = new Set(['value', 'len', 'true', 'false', 'null']);

function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos]!;
  const eat = () => tokens[pos++]!;
  const expect = (kind: Token['kind'], value?: string): Token => {
    const t = peek();
    if (t.kind !== kind || (value !== undefined && (t as { value?: string }).value !== value)) {
      throw new ExpressionError(`expected ${value ?? kind} at position ${t.pos}`, t.pos);
    }
    return eat();
  };

  const parsePrimary = (): Node => {
    const t = peek();
    if (t.kind === 'number') {
      eat();
      return { type: 'num', value: t.value };
    }
    if (t.kind === 'string') {
      eat();
      return { type: 'str', value: t.value };
    }
    if (t.kind === 'regex') {
      eat();
      return { type: 'regex', value: t.value };
    }
    if (t.kind === 'ident') {
      if (!ALLOWED_IDENTS.has(t.value)) {
        throw new ExpressionError(`unknown identifier '${t.value}'`, t.pos);
      }
      eat();
      return { type: 'ident', name: t.value as 'value' | 'len' | 'true' | 'false' | 'null' };
    }
    if (t.kind === 'lparen') {
      eat();
      const expr = parseOr();
      expect('rparen');
      return expr;
    }
    throw new ExpressionError(`unexpected token at position ${t.pos}`, t.pos);
  };

  const parseUnary = (): Node => {
    const t = peek();
    if (t.kind === 'op' && t.value === '!') {
      eat();
      return { type: 'unary', op: '!', expr: parseUnary() };
    }
    return parsePrimary();
  };

  const parseComparison = (): Node => {
    const left = parseUnary();
    const t = peek();
    if (t.kind === 'op' && ['>=', '<=', '==', '!=', '>', '<'].includes(t.value)) {
      eat();
      const right = parseUnary();
      return { type: 'binary', op: t.value, left, right };
    }
    if (t.kind === 'ident' && t.value === 'matches') {
      eat();
      const right = parseUnary();
      return { type: 'binary', op: 'matches', left, right };
    }
    return left;
  };

  const parseAnd = (): Node => {
    let left = parseComparison();
    while (peek().kind === 'op' && (peek() as { value: string }).value === '&&') {
      eat();
      left = { type: 'binary', op: '&&', left, right: parseComparison() };
    }
    return left;
  };

  const parseOr = (): Node => {
    let left = parseAnd();
    while (peek().kind === 'op' && (peek() as { value: string }).value === '||') {
      eat();
      left = { type: 'binary', op: '||', left, right: parseAnd() };
    }
    return left;
  };

  const root = parseOr();
  if (peek().kind !== 'eof') {
    throw new ExpressionError(`unexpected trailing input at position ${peek().pos}`, peek().pos);
  }
  return root;
}

// ── Evaluator ───────────────────────────────────────────────────────────

function evaluate(node: Node, ctx: EvaluationContext): unknown {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'str':
      return node.value;
    case 'regex':
      return node.value;
    case 'ident':
      if (node.name === 'value') return ctx.value;
      if (node.name === 'true') return true;
      if (node.name === 'false') return false;
      if (node.name === 'null') return null;
      if (node.name === 'len') {
        const v = ctx.value;
        if (typeof v === 'string' || Array.isArray(v)) return v.length;
        return undefined;
      }
      return undefined;
    case 'unary':
      return !truthy(evaluate(node.expr, ctx));
    case 'binary': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      return applyOp(node.op, l, r);
    }
  }
}

function truthy(v: unknown): boolean {
  return Boolean(v);
}

function applyOp(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case '&&':
      return truthy(l) && truthy(r);
    case '||':
      return truthy(l) || truthy(r);
    case '==':
      return l === r;
    case '!=':
      return l !== r;
    case '>':
    case '<':
    case '>=':
    case '<=': {
      if (typeof l !== 'number' || typeof r !== 'number') return false;
      if (op === '>') return l > r;
      if (op === '<') return l < r;
      if (op === '>=') return l >= r;
      return l <= r;
    }
    case 'matches': {
      if (typeof l !== 'string') return false;
      if (!(r instanceof RegExp)) return false;
      return r.test(l);
    }
    default:
      return false;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export function compileExpression(source: string): CompiledExpression {
  const ast = parse(tokenize(source));
  return {
    source,
    test(value) {
      try {
        return truthy(evaluate(ast, { value }));
      } catch {
        return false;
      }
    },
  };
}

export type ValidationResult = { valid: true } | { valid: false; error: string };

/** Used at config-load time to surface a clear error rather than throw at runtime. */
export function validateExpression(source: string): ValidationResult {
  try {
    compileExpression(source);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}
