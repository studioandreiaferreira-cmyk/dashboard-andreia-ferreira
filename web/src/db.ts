import initSqlJs, { type Database, type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import type { Db, Stmt } from "../../src/db/types";
import type { Snapshot, SnapshotTable } from "../../src/snapshot";

// Same schema as the D1 mirror the metrics were written for.
const MIGRATIONS = import.meta.glob("../../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const toSql = (v: unknown): SqlValue => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as SqlValue));

class SqlJsStmt implements Stmt {
  constructor(
    private db: Database,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...values: unknown[]): Stmt {
    return new SqlJsStmt(this.db, this.sql, values);
  }
  async run() {
    this.db.run(this.sql, this.params.map(toSql));
    return {};
  }
  async all<T>() {
    const st = this.db.prepare(this.sql);
    try {
      st.bind(this.params.map(toSql));
      const results: T[] = [];
      while (st.step()) results.push(st.getAsObject() as T);
      return { results };
    } finally {
      st.free();
    }
  }
  async first<T>() {
    return (await this.all<T>()).results[0] ?? null;
  }
}

/** Decodes one snapshot table (dicts, epoch timestamps, row references) and inserts it. */
function load(db: Database, name: string, t: SnapshotTable, ids: Map<string, unknown[]>) {
  const ts = new Set(t.ts ?? []);
  const decoders = t.cols.map((c) => {
    const dict = t.dicts[c];
    if (dict) return (v: unknown) => (v === null ? null : dict[v as number]);
    if (ts.has(c)) return (v: unknown) => (typeof v === "number" ? new Date(v * 1000).toISOString() : v);
    const ref = t.ref?.[c];
    if (ref) {
      const target = ids.get(ref) ?? [];
      return (v: unknown) => (typeof v === "number" ? target[v] : v);
    }
    return (v: unknown) => v;
  });
  const decoded = t.rows.map((r) => r.map((v, i) => decoders[i](v)));
  const idCol = t.cols.indexOf("id");
  if (idCol >= 0) ids.set(name, decoded.map((r) => r[idCol]));
  if (!decoded.length) return;
  const st = db.prepare(`INSERT INTO ${name} (${t.cols.map((c) => `"${c}"`).join(", ")}) VALUES (${t.cols.map(() => "?").join(", ")})`);
  try {
    for (const r of decoded) st.run(r.map(toSql));
  } finally {
    st.free();
  }
}

/** Builds the in-memory database from a snapshot. */
export async function openSnapshot(snapshot: Snapshot): Promise<Db> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  for (const key of Object.keys(MIGRATIONS).sort()) db.exec(MIGRATIONS[key]);
  const ids = new Map<string, unknown[]>();
  db.exec("BEGIN");
  for (const [name, t] of Object.entries(snapshot.tables)) load(db, name, t, ids);
  db.exec("COMMIT");
  return {
    prepare: (sql) => new SqlJsStmt(db, sql),
    async batch(stmts) {
      for (const s of stmts) await s.run();
      return [];
    },
  };
}
