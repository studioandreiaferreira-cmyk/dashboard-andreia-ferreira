import type { Db } from "./db/types";
import type { ProfileField } from "./config";

/**
 * Dashboard snapshot: the subset of the mirror the browser needs to run src/metrics locally
 * (web/src/db.ts loads it into an in-memory SQLite). Column-oriented rows; columns whose values
 * repeat a lot are dictionary-encoded to keep the file small.
 */
export interface SnapshotTable {
  cols: string[];
  /** col → distinct values; the row holds the index (or null) */
  dicts: Record<string, unknown[]>;
  /** decoding hints (see TableSpec): timestamp columns and columns referencing another table's rows */
  ts?: string[];
  ref?: Record<string, string>;
  rows: unknown[][];
}

/** Env-like settings the browser needs to rebuild the Config (src/config.ts getConfig). */
export interface SnapshotConfig {
  BUSINESS_HOURS: string;
  NO_REPLY_MINUTES: string;
  MESSAGE_WINDOW_DAYS: string;
  PROFILE_FIELDS: string;
  CLINT_DEAL_URL_TEMPLATE?: string;
  CLINT_CHAT_URL_TEMPLATE?: string;
}

export interface Snapshot {
  version: 1;
  generated_at: string;
  config: SnapshotConfig;
  tables: Record<string, SnapshotTable>;
}

interface TableSpec {
  sql: string;
  /** repeated values → index into dicts[col] */
  dict?: string[];
  /** ISO timestamps → epoch seconds */
  ts?: string[];
  /** id of a row of another (earlier) table → that row's index; ids not found stay as strings */
  ref?: Record<string, string>;
}

/**
 * Tables and columns shipped to the browser, in dependency order (refs point to earlier tables).
 * Deal ids are replaced by short synthetic ids unless a Clint deal URL template needs them.
 */
const TABLES: Record<string, TableSpec> = {
  groups: { sql: "SELECT id, name FROM groups" },
  origins: { sql: "SELECT id, name, group_id, archived_at FROM origins" },
  stages: { sql: `SELECT id, origin_id, label, "order", type FROM stages`, dict: ["origin_id", "type"] },
  users: { sql: "SELECT id, name, active FROM users" },
  lost_statuses: { sql: "SELECT id, name FROM lost_statuses" },
  channel_accounts: { sql: "SELECT id, name, type, status FROM channel_accounts" },
  contacts: {
    sql: `SELECT id, name, phone, email, fields_json FROM contacts c
          WHERE EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.deleted = 0) OR EXISTS (SELECT 1 FROM chats h WHERE h.contact_id = c.id)`,
    dict: ["fields_json"],
  },
  deals: {
    sql: `SELECT id, origin_id, stage_id, user_id, contact_id, status, value, created_at, created_day_sp, updated_at,
            updated_stage_at, won_at, lost_at, campaign_name, campaign_id, ad_name, ad_id, form_name, form_id,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term, fields_json, lost_status_id, deleted
          FROM deals WHERE deleted = 0`,
    dict: ["origin_id", "stage_id", "user_id", "status", "created_day_sp", "campaign_name", "campaign_id", "ad_name", "ad_id",
      "form_name", "form_id", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "lost_status_id", "fields_json"],
    ts: ["created_at", "updated_at", "updated_stage_at", "won_at", "lost_at"],
    ref: { contact_id: "contacts" },
  },
  chats: {
    sql: "SELECT id, contact_id, channel_account_id, user_id, status, last_message_at, last_response_at FROM chats",
    dict: ["channel_account_id", "user_id", "status"],
    ts: ["last_message_at", "last_response_at"],
    ref: { contact_id: "contacts" },
  },
  messages: {
    sql: `SELECT chat_id, type, content_type, sender_user_id, attributed_user_id, attribution, created_at, created_day_sp FROM messages`,
    dict: ["type", "content_type", "sender_user_id", "attributed_user_id", "attribution", "created_day_sp"],
    ts: ["created_at"],
    ref: { chat_id: "chats" },
  },
  chat_reply_state: {
    sql: "SELECT chat_id, awaiting_since, has_open_deal, responsible_user_id FROM chat_reply_state WHERE awaiting_since IS NOT NULL",
    dict: ["responsible_user_id"],
    ts: ["awaiting_since"],
    ref: { chat_id: "chats" },
  },
  meta_insights: {
    sql: `SELECT ad_id, date, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name, spend, impressions, clicks, leads,
            link_clicks, landing_page_views, video_3s, purchases, purchase_value FROM meta_insights`,
    dict: ["date", "account_id", "campaign_id", "campaign_name", "adset_id", "adset_name"],
  },
  meta_ads: {
    sql: `SELECT ad_id, account_id, name, adset_id, campaign_id, status, thumbnail_url, preview_url FROM meta_ads a
          WHERE EXISTS (SELECT 1 FROM meta_insights i WHERE i.ad_id = a.ad_id)`,
    dict: ["account_id", "adset_id", "campaign_id", "status"],
  },
  sync_state: {
    sql: `SELECT key, value FROM sync_state WHERE key IN ('last_success_at', 'last_error', 'meta_last_sync', 'meta_last_error')`,
  },
};

const ident = (c: string) => `"${c.replaceAll('"', '""')}"`;
const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;

/** Column names of a spec's SELECT list (the specs use plain `col` / `"col"` items). */
function columnsOf(sql: string): string[] {
  const list = sql.slice(sql.indexOf("SELECT") + 6, sql.search(/\sFROM\s/)).split(",");
  return list.map((c) => c.trim().replaceAll('"', ""));
}

/**
 * SQL (Postgres) that returns one table of the snapshot as JSON text. The encoding runs in the
 * database so the Edge Function stays far below its CPU limit:
 * dict → dense_rank over the sorted distinct values, ts → epoch seconds, ref → row index of the
 * referenced table (same base query and order), profile fields_json → only the configured keys.
 */
function tableSql(name: string, spec: TableSpec, opts: { keepDealIds: boolean; fieldKeys: Record<string, string[]> }): string {
  const cols = columnsOf(spec.sql);
  const dict = new Set(spec.dict ?? []);
  const ts = new Set(spec.ts ?? []);
  const refs = spec.ref ?? {};
  const keys = opts.fieldKeys[name];
  const hasId = cols.includes("id");

  const baseCols = cols.map((c) => {
    if (c === "fields_json" && keys) {
      const obj = keys.length ? `jsonb_strip_nulls(jsonb_build_object(${keys.map((k) => `${lit(k)}, NULLIF(fields_json::jsonb -> ${lit(k)}, '""'::jsonb)`).join(", ")}))` : "NULL::jsonb";
      return `NULLIF((${obj})::text, '{}') AS fields_json`;
    }
    return ident(c);
  });
  const joins: string[] = [];
  const outCols = cols.map((c) => {
    const col = `b.${ident(c)}`;
    if (c === "id" && name === "deals" && !opts.keepDealIds) return "to_json(b._rn::text)";
    if (ts.has(c)) return `to_json(public.try_epoch(${col}))`;
    if (refs[c]) {
      const alias = `r_${c}`;
      joins.push(`LEFT JOIN (SELECT id, (row_number() OVER (ORDER BY id) - 1) AS ix FROM (${TABLES[refs[c]].sql}) t) ${alias} ON ${alias}.id = ${col}`);
      return `COALESCE(to_json(${alias}.ix), to_json(${col}))`;
    }
    if (dict.has(c)) return `to_json(b.${ident(`${c}__d`)})`;
    return `to_json(${col})`;
  });
  const dictCols = [...dict].filter((c) => cols.includes(c));
  const ranks = dictCols.map((c) => `CASE WHEN ${ident(c)} IS NULL THEN NULL ELSE dense_rank() OVER (ORDER BY ${ident(c)}) - 1 END AS ${ident(`${c}__d`)}`);
  const order = hasId ? "ORDER BY id" : `ORDER BY ${cols.map(ident).join(", ")}`;
  const dicts = dictCols.map(
    (c) => `${lit(c)}, COALESCE((SELECT json_agg(v ORDER BY v) FROM (SELECT DISTINCT ${ident(c)} AS v FROM base WHERE ${ident(c)} IS NOT NULL) x), '[]'::json)`,
  );
  return `WITH base AS (SELECT ${baseCols.join(", ")} FROM (${spec.sql}) src),
    b AS (SELECT base.*, (row_number() OVER (${order}) - 1) AS _rn${ranks.length ? `, ${ranks.join(", ")}` : ""} FROM base)
  SELECT json_build_object(
    'cols', json_build_array(${cols.map(lit).join(", ")}),
    'dicts', json_build_object(${dicts.join(", ")}),
    'rows', COALESCE((SELECT json_agg(json_build_array(${outCols.join(", ")}) ORDER BY b._rn) FROM b ${joins.join(" ")}), '[]'::json),
    'ts', json_build_array(${[...ts].map(lit).join(", ")}),
    'ref', json_build_object(${Object.entries(refs).map(([c, t]) => `${lit(c)}, ${lit(t)}`).join(", ")})
  )::text AS j`;
}

/**
 * Builds the snapshot JSON text in Postgres (see tableSql). Returns the text ready to upload.
 * Contacts/chats must keep the same row order as the ref joins: both order by id.
 */
export async function buildSnapshotText(db: Db, config: SnapshotConfig, profileFields: ProfileField[], now: Date = new Date()): Promise<string> {
  const fieldKeys = {
    deals: profileFields.filter((p) => p.entity === "deal").map((p) => p.key),
    contacts: profileFields.filter((p) => p.entity === "contact").map((p) => p.key),
  };
  const keepDealIds = Boolean(config.CLINT_DEAL_URL_TEMPLATE);
  const parts: string[] = [];
  for (const [name, spec] of Object.entries(TABLES)) {
    const row = await db.prepare(tableSql(name, spec, { keepDealIds, fieldKeys })).first<{ j: string }>();
    parts.push(`${JSON.stringify(name)}:${row!.j}`);
  }
  return `{"version":1,"generated_at":${JSON.stringify(now.toISOString())},"config":${JSON.stringify(config)},"tables":{${parts.join(",")}}}`;
}
