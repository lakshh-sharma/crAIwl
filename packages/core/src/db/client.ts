import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export type DbClientOptions = {
  url: string;
  /** Drop the connection pool to a single connection — useful for migrations. */
  max?: number;
};

export function createDbClient(opts: DbClientOptions): {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
} {
  const sql = postgres(opts.url, { max: opts.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
