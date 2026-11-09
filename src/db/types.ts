/**
 * The subset of the Cloudflare D1 API the code uses. Implemented by D1 itself (tests), Postgres
 * (Supabase sync, src/db/postgres.ts) and sql.js (the browser, web/src/db.ts).
 * SQL written against it must run on both SQLite and Postgres when it is used by the sync.
 */
export interface Stmt {
  bind(...values: unknown[]): Stmt;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface Db {
  prepare(sql: string): Stmt;
  /** Runs the statements in order inside one transaction. */
  batch(stmts: Stmt[]): Promise<unknown>;
}
