import type { Db } from "../db/types";
import { clintUrl, type Config } from "../config";
import { sqliteTzModifier, todaySP } from "../lib/time";
import { dealWhere, type Filters } from "./filters";

export const BUCKETS = [
  { label: "0–3", min: 0, max: 3 },
  { label: "4–7", min: 4, max: 7 },
  { label: "8–15", min: 8, max: 15 },
  { label: "16–30", min: 16, max: 30 },
  { label: "30+", min: 31, max: Number.MAX_SAFE_INTEGER },
];

export interface StalledOptions {
  sort?: "inactive" | "stage";
  page?: number;
  pageSize?: number;
}

/**
 * Open deals with "dias sem atividade" (stage change or last message, whichever is newer) and
 * "dias sem mudar de etapa" (FR-013..015). Days are São Paulo calendar days.
 */
export async function getStalled(db: Db, cfg: Config, f: Filters, now: Date = new Date(), opts: StalledOptions = {}) {
  // Always open deals: the status filter does not apply here.
  const w = dealWhere({ ...f, statuses: [] }, "d");
  const today = todaySP(now);
  const tz = sqliteTzModifier(now);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const order = opts.sort === "stage" ? "days_in_stage DESC, days_inactive DESC" : "days_inactive DESC, days_in_stage DESC";

  const cte = `
    WITH base AS (
      SELECT d.id, d.contact_id, d.origin_id, d.stage_id, d.user_id, d.updated_stage_at,
             MAX(d.updated_stage_at, COALESCE((SELECT MAX(c.last_message_at) FROM chats c WHERE c.contact_id = d.contact_id), d.updated_stage_at)) AS last_activity
      FROM deals d WHERE d.status = 'OPEN' AND ${w.sql}
    ),
    calc AS (
      SELECT *, MAX(0, CAST(julianday('${today}') - julianday(date(updated_stage_at, '${tz}')) AS INTEGER)) AS days_in_stage,
                MAX(0, CAST(julianday('${today}') - julianday(date(last_activity, '${tz}')) AS INTEGER)) AS days_inactive
      FROM base
    )`;
  // `today` (YYYY-MM-DD) and `tz` ("-180 minutes") are generated here, never user input, so they are inlined.
  const params = w.params;

  const bucketSql = BUCKETS.map((b, i) => `SUM(CASE WHEN days_inactive BETWEEN ${b.min} AND ${b.max} THEN 1 ELSE 0 END) AS b${i}`).join(", ");
  const buckets = await db
    .prepare(`${cte} SELECT COUNT(*) AS total, ${bucketSql} FROM calc`)
    .bind(...params)
    .first<Record<string, number>>();

  const items = await db
    .prepare(
      `${cte}
      SELECT calc.id AS deal_id, calc.contact_id, ct.name AS contact_name, o.name AS origin, s.label AS stage, u.name AS responsible,
             calc.days_inactive, calc.days_in_stage
      FROM calc
      LEFT JOIN contacts ct ON ct.id = calc.contact_id
      LEFT JOIN origins o ON o.id = calc.origin_id
      LEFT JOIN stages s ON s.id = calc.stage_id
      LEFT JOIN users u ON u.id = calc.user_id
      ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    )
    .bind(...params)
    .all<{ deal_id: string; contact_id: string | null; contact_name: string | null; origin: string | null; stage: string | null; responsible: string | null; days_inactive: number; days_in_stage: number }>();

  // Count of open deals per exact number of days without activity (histogram for the CRM view).
  const histogram = await db
    .prepare(`${cte} SELECT days_inactive AS days, COUNT(*) AS count FROM calc GROUP BY 1 ORDER BY 1`)
    .bind(...params)
    .all<{ days: number; count: number }>();

  return {
    buckets: BUCKETS.map((b, i) => ({ label: b.label, count: buckets?.[`b${i}`] ?? 0 })),
    histogram: histogram.results,
    total: buckets?.total ?? 0,
    page,
    page_size: pageSize,
    items: items.results.map((r) => ({ ...r, clint_url: clintUrl(cfg, { deal_id: r.deal_id, contact_id: r.contact_id }) })),
  };
}
