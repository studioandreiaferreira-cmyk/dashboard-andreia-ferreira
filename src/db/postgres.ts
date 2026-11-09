import postgres from "postgres";
import type { Db, Stmt } from "./types";

/** Rewrites SQLite-style `?` placeholders to Postgres `$1, $2…`, leaving quoted text alone. */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") {
      out += `$${++n}`;
    } else out += ch;
  }
  return out;
}

/** SQL literal for a bound value (batches are sent as one simple-protocol script). */
export function pgLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Cannot inline number ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  // standard_conforming_strings is on: only the quote needs escaping. Postgres text cannot hold NUL.
  return `'${String(v).replaceAll("\0", "").replaceAll("'", "''")}'`;
}

/** Replaces `?` placeholders (outside quotes) with inlined literals. */
export function inlineParams(sql: string, params: unknown[]): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") {
      if (n >= params.length) throw new Error("Missing bound parameter");
      out += pgLiteral(params[n++]);
    } else out += ch;
  }
  if (n !== params.length) throw new Error(`Expected ${n} parameters, got ${params.length}`);
  return out;
}

type Sql = ReturnType<typeof postgres>;

class PgStmt implements Stmt {
  readonly text: string;
  constructor(
    private sql: Sql,
    /** original SQLite-style text with `?` placeholders */
    readonly raw: string,
    readonly params: unknown[] = [],
  ) {
    this.text = toPgPlaceholders(raw);
  }
  bind(...values: unknown[]): Stmt {
    return new PgStmt(this.sql, this.raw, values);
  }
  run() {
    return this.sql.unsafe(this.text, this.params as never[]);
  }
  async all<T>() {
    return { results: [...(await this.sql.unsafe(this.text, this.params as never[]))] as T[] };
  }
  async first<T>() {
    const rows = await this.sql.unsafe(this.text, this.params as never[]);
    return (rows[0] as T) ?? null;
  }
}

/** Db over Postgres (Supabase). Counts and sums come back as JS numbers, like in SQLite. */
export function pgDb(url: string): { db: Db; end: () => Promise<void> } {
  const asNumber = (x: string) => Number(x);
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    types: {
      int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: asNumber },
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: asNumber },
    },
  });
  const db: Db = {
    prepare: (text) => new PgStmt(sql, text),
    async batch(stmts) {
      if (!stmts.length) return [];
      // One round trip: the statements go as a single script (simple protocol) inside a transaction.
      // Parameterised statements would cost a describe round trip each.
      const script = (stmts as PgStmt[]).map((s) => inlineParams(s.raw, s.params)).join(";\n");
      return sql.unsafe(`BEGIN;\n${script};\nCOMMIT;`);
    },
  };
  return { db, end: () => sql.end({ timeout: 5 }) };
}
