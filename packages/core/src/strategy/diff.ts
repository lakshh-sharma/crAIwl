import type { StrategyConfig } from './types.js';

/**
 * A single change between two StrategyConfig versions. Paths use a
 * dot/bracket notation similar to JSONPath ('pageTemplates[0].fields.title')
 * so they read naturally in a CLI diff or a UI list. Values are kept as the
 * original JSON-compatible payload — the renderer decides how to format.
 */
export type ConfigChange = {
  path: string;
  op: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
};

export type ConfigDiff = {
  changes: ConfigChange[];
  /** Convenience flag — true iff no fields differ. */
  identical: boolean;
};

/**
 * Pure structural diff between two configs. Walks both trees and emits one
 * entry per leaf that differs. Arrays are compared by index; reordering a
 * locator list will show as paired add/remove entries, which is the
 * intended behaviour — locator rank is meaningful.
 */
export function diffStrategyConfigs(before: StrategyConfig, after: StrategyConfig): ConfigDiff {
  const changes: ConfigChange[] = [];
  walk('', before as unknown, after as unknown, changes);
  return { changes, identical: changes.length === 0 };
}

function walk(path: string, before: unknown, after: unknown, out: ConfigChange[]): void {
  if (Object.is(before, after)) return;

  if (before === undefined && after !== undefined) {
    out.push({ path: path || '<root>', op: 'added', after });
    return;
  }
  if (after === undefined && before !== undefined) {
    out.push({ path: path || '<root>', op: 'removed', before });
    return;
  }

  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);
  if (beforeIsObject && afterIsObject) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      walk(childPath, before[key], after[key], out);
    }
    return;
  }

  const beforeIsArray = Array.isArray(before);
  const afterIsArray = Array.isArray(after);
  if (beforeIsArray && afterIsArray) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      walk(`${path}[${i}]`, before[i], after[i], out);
    }
    return;
  }

  if (!shallowEqual(before, after)) {
    out.push({ path: path || '<root>', op: 'changed', before, after });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  // Primitives only at this point — strings/numbers/booleans/null.
  return false;
}

/**
 * Human-friendly one-line-per-change rendering, suitable for CLI/log output.
 * Renders values inline for primitives, summarized for objects/arrays.
 */
export function formatConfigDiff(diff: ConfigDiff): string {
  if (diff.identical) return '(no changes)';
  return diff.changes
    .map((c) => {
      switch (c.op) {
        case 'added':
          return `+ ${c.path}: ${preview(c.after)}`;
        case 'removed':
          return `- ${c.path}: ${preview(c.before)}`;
        case 'changed':
          return `~ ${c.path}: ${preview(c.before)} → ${preview(c.after)}`;
      }
    })
    .join('\n');
}

function preview(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}
