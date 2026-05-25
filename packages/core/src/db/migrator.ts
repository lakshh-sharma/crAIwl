import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../migrations');

type MigrationFile = { name: string; absPath: string };

async function listMigrations(direction: 'up' | 'down'): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const suffix = direction === 'up' ? '.sql' : '.down.sql';
  const filtered = entries
    .filter((e) => e.endsWith(suffix) && (direction === 'down' || !e.endsWith('.down.sql')))
    .sort();
  if (direction === 'down') filtered.reverse();
  return filtered.map((name) => ({ name, absPath: path.join(MIGRATIONS_DIR, name) }));
}

/**
 * Splits a Drizzle-generated migration body on its `--> statement-breakpoint`
 * marker. Plain handwritten down migrations are split on bare semicolons at
 * statement end. Both are safe to feed through `sql.unsafe` one statement at
 * a time.
 */
function splitStatements(body: string): string[] {
  if (body.includes('--> statement-breakpoint')) {
    return body
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return body
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function runMigrations(sql: Sql, direction: 'up' | 'down'): Promise<string[]> {
  const files = await listMigrations(direction);
  const applied: string[] = [];
  for (const file of files) {
    const body = await readFile(file.absPath, 'utf8');
    const statements = splitStatements(body);
    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }
    applied.push(file.name);
  }
  return applied;
}

export function applyUp(sql: Sql): Promise<string[]> {
  return runMigrations(sql, 'up');
}

export function applyDown(sql: Sql): Promise<string[]> {
  return runMigrations(sql, 'down');
}
