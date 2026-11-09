import type { Db } from "../db/types";
import { dayRange, toDaySP } from "../lib/time";
import { dealWhere, type Filters } from "./filters";

/**
 * "Vendas" view: deals won in the period (by the day of won_at, São Paulo) with their value in the
 * Clint, next to the Meta spend and pixel purchases of the same days. Global filters apply except
 * the status filter (a sale is always a won deal).
 */
export async function getSales(db: Db, f: Filters) {
  const w = dealWhere({ ...f, statuses: [] }, "d");
  const rows = (
    await db
      .prepare(
        `SELECT d.won_at, COALESCE(d.value, 0) AS value, o.name AS origin, d.ad_name, d.campaign_name, d.campaign_id
         FROM deals d LEFT JOIN origins o ON o.id = d.origin_id
         WHERE d.status = 'WON' AND d.won_at IS NOT NULL AND ${w.sql}`,
      )
      .bind(...w.params)
      .all<{ won_at: string; value: number; origin: string | null; ad_name: string | null; campaign_name: string | null; campaign_id: string | null }>()
  ).results
    .map((r) => ({ ...r, day: toDaySP(r.won_at) }))
    .filter((r) => r.day >= f.from && r.day <= f.to);

  const named = f.campaigns.filter(Boolean);
  const meta = (
    await db
      .prepare(
        `SELECT i.date AS day, SUM(i.spend) AS spend, SUM(i.purchases) AS purchases, SUM(i.purchase_value) AS purchase_value
         FROM meta_insights i WHERE i.date BETWEEN ? AND ?${named.length ? ` AND i.campaign_name IN (${named.map(() => "?").join(",")})` : ""} GROUP BY 1`,
      )
      .bind(f.from, f.to, ...named)
      .all<{ day: string; spend: number; purchases: number; purchase_value: number }>()
  ).results;
  const metaByDay = new Map(meta.map((m) => [m.day, m]));

  const days = dayRange(f.from, f.to).map((date) => {
    const of = rows.filter((r) => r.day === date);
    return { date, sales: of.length, revenue: of.reduce((s, r) => s + r.value, 0), spend: metaByDay.get(date)?.spend ?? 0 };
  });
  const groupBy = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { name: string; sales: number; revenue: number }>();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) ?? { name: k, sales: 0, revenue: 0 };
      g.sales++;
      g.revenue += r.value;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);
  };
  const viaMeta = rows.filter((r) => r.campaign_id);
  return {
    totals: {
      sales: rows.length,
      revenue: rows.reduce((s, r) => s + r.value, 0),
      spend: meta.reduce((s, m) => s + m.spend, 0),
      meta_sales: viaMeta.length,
      meta_revenue: viaMeta.reduce((s, r) => s + r.value, 0),
      pixel_purchases: meta.reduce((s, m) => s + m.purchases, 0),
      pixel_value: meta.reduce((s, m) => s + m.purchase_value, 0),
    },
    days,
    by_origin: groupBy((r) => r.origin ?? "Sem origem"),
    by_ad: groupBy((r) => r.ad_name ?? "").filter((g) => g.name),
    by_campaign: groupBy((r) => r.campaign_name ?? "Sem campanha / orgânico"),
  };
}
