import type { Db } from "../db/types";
import { dayRange, toDaySP } from "../lib/time";
import { dealWhere, type Filters } from "./filters";

/**
 * "Lançamento" view (layout of the Social Nudge launch dashboards): Meta Ads spend and creatives
 * next to the leads that reached the Clint. Leads = deals created in the period with the global
 * filters except status (a launch counts every lead). Meta numbers only follow the campaign filter.
 */

/** A lead counts as paid traffic when Meta wrote its campaign/ad/form or the UTM says paid. */
const PAID_SOURCES = ["pago", "paid", "facebook", "fb", "instagram", "ig", "meta", "metaads", "meta_ads", "facebook_ads", "fb_ads", "ads"];
const PAID_MEDIUMS = ["cpc", "paid", "pago", "paid_social", "ads", "cpm"];
const lit = (xs: string[]) => xs.map((x) => `'${x}'`).join(",");
export const IS_TRAFFIC = `(d.campaign_id IS NOT NULL OR d.ad_id IS NOT NULL OR d.form_id IS NOT NULL
  OR LOWER(COALESCE(d.utm_source, '')) IN (${lit(PAID_SOURCES)}) OR LOWER(COALESCE(d.utm_medium, '')) IN (${lit(PAID_MEDIUMS)}))`;
const SOURCE = `CASE
  WHEN d.form_id IS NOT NULL THEN 'Tráfego · formulário Meta'
  WHEN ${IS_TRAFFIC} THEN 'Tráfego · anúncio / UTM paga'
  WHEN d.utm_source IS NOT NULL THEN 'Orgânico · outras UTMs'
  ELSE 'Orgânico · sem UTM' END`;

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export const NO_VALUE = "(sem valor)";

/** Campaign phase from the naming convention: [LEAD]/[MSG] = captação, [VENDA] = vendas, [TRAFEGO] = tráfego. */
export function phaseOf(campaign: string | null): "captacao" | "vendas" | "trafego" | "outras" {
  const n = (campaign ?? "").toUpperCase();
  if (/\[(LEAD|MSG|CADASTRO|FORM)\]/.test(n)) return "captacao";
  if (/\[(VENDA|VENDAS|CONVERS[AÃ]O|CARRINHO)\]/.test(n)) return "vendas";
  if (/\[(TRAFEGO|TRÁFEGO|ALCANCE|ENGAJAMENTO)\]/.test(n)) return "trafego";
  return "outras";
}
export const PHASE_LABEL = { captacao: "Captação", vendas: "Vendas", trafego: "Tráfego / perfil", outras: "Outras" } as const;

export interface LaunchDay {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  meta_leads: number;
  purchases: number;
  leads: number;
  traffic: number;
  organic: number;
}

export interface CreativeRow {
  name: string;
  spend: number;
  meta_leads: number;
  clint_leads: number;
  impressions: number;
  clicks: number;
  video_3s: number;
  purchases: number;
  cpl: number | null;
  ctr: number;
  hook: number | null;
  thumb: string | null;
  preview: string | null;
  /** tercile of the CPL among the ranked rows: good (cheapest) / warn / bad */
  tier: "good" | "warn" | "bad" | null;
}

function tiers(rows: CreativeRow[]) {
  const withCpl = rows.filter((r) => r.cpl !== null).sort((a, b) => a.cpl! - b.cpl!);
  withCpl.forEach((r, i) => {
    r.tier = i < withCpl.length / 3 ? "good" : i < (2 * withCpl.length) / 3 ? "warn" : "bad";
  });
}

export async function getLaunch(db: Db, f: Filters, opts: { funnelOrigin?: string | null } = {}) {
  const w = dealWhere({ ...f, statuses: [] }, "d", { period: true });
  const days = dayRange(f.from, f.to);

  // Meta: the global campaign filter applies (by name); origin / seller cannot reach ad spend.
  const named = f.campaigns.filter(Boolean);
  const metaWhere = `i.date BETWEEN ? AND ?${named.length ? ` AND i.campaign_name IN (${named.map(() => "?").join(",")})` : ""}`;
  const metaParams = [f.from, f.to, ...named];

  const leadDays = (
    await db
      .prepare(
        `SELECT d.created_day_sp AS day, COUNT(*) AS leads, SUM(CASE WHEN ${IS_TRAFFIC} THEN 1 ELSE 0 END) AS traffic
         FROM deals d WHERE ${w.sql} GROUP BY 1`,
      )
      .bind(...w.params)
      .all<{ day: string; leads: number; traffic: number }>()
  ).results;
  const metaDays = (
    await db
      .prepare(
        `SELECT i.date AS day, SUM(i.spend) AS spend, SUM(i.impressions) AS impressions, SUM(i.clicks) AS clicks, SUM(i.link_clicks) AS link_clicks,
                SUM(i.leads) AS meta_leads, SUM(i.purchases) AS purchases
         FROM meta_insights i WHERE ${metaWhere} GROUP BY 1`,
      )
      .bind(...metaParams)
      .all<{ day: string; spend: number; impressions: number; clicks: number; link_clicks: number; meta_leads: number; purchases: number }>()
  ).results;
  const ld = new Map(leadDays.map((r) => [r.day, r]));
  const md = new Map(metaDays.map((r) => [r.day, r]));
  const perDay: LaunchDay[] = days.map((date) => {
    const l = ld.get(date);
    const m = md.get(date);
    return {
      date,
      spend: m?.spend ?? 0,
      impressions: m?.impressions ?? 0,
      clicks: m?.clicks ?? 0,
      link_clicks: m?.link_clicks ?? 0,
      meta_leads: m?.meta_leads ?? 0,
      purchases: m?.purchases ?? 0,
      leads: l?.leads ?? 0,
      traffic: l?.traffic ?? 0,
      organic: (l?.leads ?? 0) - (l?.traffic ?? 0),
    };
  });
  const sum = (k: keyof LaunchDay) => perDay.reduce((s, d) => s + (d[k] as number), 0);
  const totals = {
    spend: sum("spend"),
    impressions: sum("impressions"),
    clicks: sum("clicks"),
    link_clicks: sum("link_clicks"),
    meta_leads: sum("meta_leads"),
    purchases: sum("purchases"),
    leads: sum("leads"),
    traffic: sum("traffic"),
    organic: sum("organic"),
  };

  const sources = (
    await db.prepare(`SELECT ${SOURCE} AS label, COUNT(*) AS n FROM deals d WHERE ${w.sql} GROUP BY 1 ORDER BY 2 DESC`).bind(...w.params).all<{ label: string; n: number }>()
  ).results;

  const utm: Record<string, { value: string; n: number }[]> = {};
  for (const k of UTM_KEYS) {
    utm[k] = (
      await db
        .prepare(`SELECT COALESCE(NULLIF(TRIM(d.${k}), ''), ?) AS value, COUNT(*) AS n FROM deals d WHERE ${w.sql} GROUP BY 1 ORDER BY 2 DESC`)
        .bind(NO_VALUE, ...w.params)
        .all<{ value: string; n: number }>()
    ).results;
  }

  // Phases by campaign name.
  const byCampaign = (
    await db
      .prepare(
        `SELECT i.campaign_name AS name, SUM(i.spend) AS spend, SUM(i.leads) AS meta_leads, SUM(i.purchases) AS purchases, SUM(i.purchase_value) AS purchase_value
         FROM meta_insights i WHERE ${metaWhere} GROUP BY 1`,
      )
      .bind(...metaParams)
      .all<{ name: string | null; spend: number; meta_leads: number; purchases: number; purchase_value: number }>()
  ).results;
  const phases = (Object.keys(PHASE_LABEL) as (keyof typeof PHASE_LABEL)[]).map((key) => {
    const rows = byCampaign.filter((c) => phaseOf(c.name) === key);
    return {
      key,
      label: PHASE_LABEL[key],
      campaigns: rows.length,
      spend: rows.reduce((s, r) => s + r.spend, 0),
      meta_leads: rows.reduce((s, r) => s + r.meta_leads, 0),
      purchases: rows.reduce((s, r) => s + r.purchases, 0),
      purchase_value: rows.reduce((s, r) => s + r.purchase_value, 0),
    };
  });
  const captacaoSpend = phases.find((p) => p.key === "captacao")!.spend;

  // Creatives (grouped by ad name, like the reference) and audiences (ad sets).
  const clintByAd = new Map(
    (
      await db
        .prepare(`SELECT d.ad_id AS id, COUNT(*) AS n FROM deals d WHERE ${w.sql} AND d.ad_id IS NOT NULL GROUP BY 1`)
        .bind(...w.params)
        .all<{ id: string; n: number }>()
    ).results.map((r) => [r.id, r.n]),
  );
  const clintByAdset = new Map<string, number>();
  const adRows = (
    await db
      .prepare(
        `SELECT i.ad_id, COALESCE(i.ad_name, a.name, i.ad_id) AS name, COALESCE(i.adset_name, i.adset_id, '—') AS adset, a.thumbnail_url AS thumb, a.preview_url AS preview,
                SUM(i.spend) AS spend, SUM(i.leads) AS meta_leads, SUM(i.impressions) AS impressions, SUM(i.clicks) AS clicks, SUM(i.video_3s) AS video_3s,
                SUM(i.purchases) AS purchases
         FROM meta_insights i LEFT JOIN meta_ads a ON a.ad_id = i.ad_id
         WHERE ${metaWhere} GROUP BY i.ad_id, 2, 3, 4, 5`,
      )
      .bind(...metaParams)
      .all<{ ad_id: string; name: string; adset: string; thumb: string | null; preview: string | null; spend: number; meta_leads: number; impressions: number; clicks: number; video_3s: number; purchases: number }>()
  ).results;
  const group = (keyOf: (r: (typeof adRows)[number]) => string, clint: (r: (typeof adRows)[number]) => number) => {
    const m = new Map<string, CreativeRow & { _best: number }>();
    for (const r of adRows) {
      const k = keyOf(r);
      let g = m.get(k);
      if (!g) {
        g = { name: k, spend: 0, meta_leads: 0, clint_leads: 0, impressions: 0, clicks: 0, video_3s: 0, purchases: 0, cpl: null, ctr: 0, hook: null, thumb: null, preview: null, tier: null, _best: -1 };
        m.set(k, g);
      }
      g.spend += r.spend;
      g.meta_leads += r.meta_leads;
      g.clint_leads += clint(r);
      g.impressions += r.impressions;
      g.clicks += r.clicks;
      g.video_3s += r.video_3s;
      g.purchases += r.purchases;
      // Thumbnail / preview of the ad that spent the most in the group.
      if (r.spend > g._best && (r.thumb || r.preview)) {
        g._best = r.spend;
        g.thumb = r.thumb;
        g.preview = r.preview;
      }
    }
    const rows = [...m.values()]
      .filter((g) => g.spend > 0 || g.meta_leads > 0)
      .map(({ _best, ...g }) => ({
        ...g,
        cpl: g.meta_leads ? g.spend / g.meta_leads : null,
        ctr: g.impressions ? (g.clicks / g.impressions) * 100 : 0,
        hook: g.impressions && g.video_3s ? (g.video_3s / g.impressions) * 100 : null,
      }));
    rows.sort((a, b) => (a.cpl === null ? (b.cpl === null ? b.spend - a.spend : 1) : b.cpl === null ? -1 : a.cpl - b.cpl));
    tiers(rows);
    return rows;
  };
  const creatives = group((r) => r.name, (r) => clintByAd.get(r.ad_id) ?? 0);
  for (const r of adRows) clintByAdset.set(r.adset, (clintByAdset.get(r.adset) ?? 0) + (clintByAd.get(r.ad_id) ?? 0));
  const adsets = group((r) => r.adset, () => 0).map((a) => ({ ...a, clint_leads: clintByAdset.get(a.name) ?? 0 }));

  return {
    days: perDay,
    totals,
    captacao_spend: captacaoSpend,
    sources,
    utm,
    phases,
    creatives,
    adsets,
    funnel: await getFunnel(db, f, opts.funnelOrigin ?? null),
  };
}

/**
 * Commercial funnel of one origin (Clint pipeline): leads created in the period by the stage they
 * are in now (lost ones leave the bars), plus a day-by-day reconstruction of the origin:
 * deals created up to the day, won / lost up to the day (by won_at / lost_at).
 */
export async function getFunnel(db: Db, f: Filters, originId: string | null) {
  const w = dealWhere({ ...f, statuses: [], originIds: [], groupIds: [] }, "d", { period: true });
  const options = (
    await db
      .prepare(`SELECT d.origin_id AS id, o.name, COUNT(*) AS n FROM deals d JOIN origins o ON o.id = d.origin_id WHERE ${w.sql} GROUP BY 1, 2 ORDER BY 3 DESC`)
      .bind(...w.params)
      .all<{ id: string; name: string; n: number }>()
  ).results;
  // Default: the filtered origin, else the origin with the most leads in the period.
  const pick = originId ?? (f.originIds.length === 1 ? f.originIds[0] : null) ?? options[0]?.id ?? null;
  if (!pick) return { origin: null, options, stages: [], total: 0, won: 0, lost: 0, evolution: [] };
  const origin = options.find((o) => o.id === pick) ?? { id: pick, name: (await db.prepare("SELECT name FROM origins WHERE id = ?").bind(pick).first<{ name: string }>())?.name ?? "—", n: 0 };
  const stages = (
    await db.prepare(`SELECT id, label, type, "order" FROM stages WHERE origin_id = ? ORDER BY "order", label`).bind(pick).all<{ id: string; label: string; type: string | null; order: number | null }>()
  ).results;
  const counts = (
    await db
      .prepare(`SELECT d.stage_id AS id, d.status, COUNT(*) AS n FROM deals d WHERE ${w.sql} AND d.origin_id = ? GROUP BY 1, 2`)
      .bind(...w.params, pick)
      .all<{ id: string | null; status: string; n: number }>()
  ).results;
  const total = counts.reduce((s, c) => s + c.n, 0);
  const won = counts.filter((c) => c.status === "WON").reduce((s, c) => s + c.n, 0);
  const lost = counts.filter((c) => c.status === "LOST").reduce((s, c) => s + c.n, 0);
  const byStage = new Map<string, number>();
  for (const c of counts) if (c.status !== "LOST" && c.id) byStage.set(c.id, (byStage.get(c.id) ?? 0) + c.n);

  // Evolution of the whole origin (every deal ever created in it), one row per day of the period.
  const all = (
    await db
      .prepare(`SELECT d.created_day_sp AS c, d.won_at AS w, d.lost_at AS l, d.status AS s FROM deals d WHERE d.deleted = 0 AND d.origin_id = ?`)
      .bind(pick)
      .all<{ c: string; w: string | null; l: string | null; s: string }>()
  ).results.map((r) => ({ c: r.c, w: r.s === "WON" && r.w ? toDaySP(r.w) : null, l: r.s === "LOST" && r.l ? toDaySP(r.l) : null }));
  const evolution = dayRange(f.from, f.to).map((day) => {
    let t = 0;
    let wn = 0;
    let ls = 0;
    for (const r of all) {
      if (r.c > day) continue;
      t++;
      if (r.w && r.w <= day) wn++;
      else if (r.l && r.l <= day) ls++;
    }
    return { day, total: t, open: t - wn - ls, won: wn, lost: ls };
  });

  return {
    origin: { id: origin.id, name: origin.name },
    options,
    stages: stages.map((s) => ({ ...s, count: byStage.get(s.id) ?? 0 })),
    total,
    won,
    lost,
    evolution,
  };
}
