import type { Db, Stmt } from "../db/types";
export async function getState(db: Db, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM sync_state WHERE key = ?").bind(key).first<{ value: string | null }>();
  return row?.value ?? null;
}

export async function setState(db: Db, key: string, value: string | null): Promise<void> {
  await db
    .prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

/** Runs prepared statements in D1 batches of `size`. */
export async function batchRun(db: Db, stmts: Stmt[], size = 100): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}

/** ISO timestamp `minutes` before the given ISO timestamp (overlap for incremental cursors). */
export function minusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() - minutes * 60_000).toISOString();
}
