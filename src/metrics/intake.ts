import type { Db } from "../db/types";
import { dayRange } from "../lib/time";
import { dealWhere, type Filters } from "./filters";

/** Deals created per day, split by origin (FR-011, FR-012). */
export async function getIntake(db: Db, f: Filters) {
  const w = dealWhere(f, "d", { period: true });
  const { results } = await db
    .prepare(
      `SELECT d.origin_id, o.name, g.name AS group_name, d.created_day_sp AS day, COUNT(*) AS n
       FROM deals d LEFT JOIN origins o ON o.id = d.origin_id LEFT JOIN groups g ON g.id = o.group_id
       WHERE ${w.sql} GROUP BY d.origin_id, d.created_day_sp`,
    )
    .bind(...w.params)
    .all<{ origin_id: string | null; name: string | null; group_name: string | null; day: string; n: number }>();

  const days = dayRange(f.from, f.to);
  const idx = new Map(days.map((d, i) => [d, i]));
  const byOrigin = new Map<string, { origin_id: string | null; name: string; group: string | null; per_day: number[]; total: number }>();
  for (const r of results) {
    const key = r.origin_id ?? "";
    let o = byOrigin.get(key);
    if (!o) {
      o = { origin_id: r.origin_id, name: r.name ?? "Sem origem", group: r.group_name, per_day: days.map(() => 0), total: 0 };
      byOrigin.set(key, o);
    }
    const i = idx.get(r.day);
    if (i !== undefined) o.per_day[i] += r.n;
    o.total += r.n;
  }
  const by_origin = [...byOrigin.values()].sort((a, b) => b.total - a.total);
  return { days, by_origin, total: by_origin.reduce((s, o) => s + o.total, 0) };
}
