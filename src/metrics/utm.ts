import type { Db } from "../db/types";
import { clintUrl, type Config } from "../config";
import { addDays, sqliteTzModifier, todaySP } from "../lib/time";
import { dealWhere, NO_CAMPAIGN, type Filters } from "./filters";
import { NO_REASON } from "./status";

/** Dimensions a deal can be grouped by: Meta Lead Ads fields and utm_* parameters. */
export const UTM_DIMENSIONS = {
  campaign: "campaign_name",
  ad: "ad_name",
  form: "form_name",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  utm_content: "utm_content",
  utm_term: "utm_term",
} as const;
export type UtmDimension = keyof typeof UTM_DIMENSIONS;

const STALLED_DAYS = 7;

interface DealRow {
  key: string;
  status: string;
  created_at: string;
  created_day_sp: string;
  first_seller_at: string | null;
  lead_replied: number;
  days_inactive: number;
  lost_reason: string | null;
}

export interface UtmRow {
  key: string;
  leads: number;
  contacted: number;
  replied: number;
  open: number;
  won: number;
  lost: number;
  stalled: number;
  median_first_contact_hours: number | null;
  top_lost_reason: string | null;
  /** Meta Ads columns (only for campaign / ad); null when there is no ads data for the row. */
  ads: AdsMetrics | null;
}

export interface AdsMetrics {
  spend: number;
  meta_leads: number;
  impressions: number;
  clicks: number;
  /** CRM leads and sales of the row regardless of the status filter, used for costs. */
  crm_leads: number;
  crm_won: number;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Campaign performance inside the CRM (deals created in the period, grouped by `dim`):
 * leads → contacted by a seller → lead replied → open / won / lost, time to first contact,
 * stalled open deals and the most common loss reason.
 * Contact/reply data only exists for the message window (90 days).
 */
export async function getUtm(db: Db, cfg: Config, f: Filters, dim: UtmDimension = "campaign", now: Date = new Date()) {
  const col = UTM_DIMENSIONS[dim] ?? UTM_DIMENSIONS.campaign;
  const w = dealWhere(f, "d", { period: true, cross: true });
  const today = todaySP(now);
  const tz = sqliteTzModifier(now);
  const { results } = await db
    .prepare(
      `SELECT COALESCE(d.${col}, ?) AS key, d.status, d.created_at, d.created_day_sp,
         (SELECT MIN(m.created_at) FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE c.contact_id = d.contact_id AND m.type = 'USER' AND COALESCE(m.content_type, '') <> 'REACTION' AND m.created_at >= d.created_at) AS first_seller_at,
         EXISTS (SELECT 1 FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE c.contact_id = d.contact_id AND m.type = 'CUSTOMER' AND COALESCE(m.content_type, '') <> 'REACTION' AND m.created_at >= d.created_at) AS lead_replied,
         MAX(0, CAST(julianday('${today}') - julianday(date(
           MAX(d.updated_stage_at, COALESCE((SELECT MAX(c.last_message_at) FROM chats c WHERE c.contact_id = d.contact_id), d.updated_stage_at)), '${tz}')) AS INTEGER)) AS days_inactive,
         CASE WHEN d.status = 'LOST' THEN COALESCE(l.name, ?) END AS lost_reason
       FROM deals d LEFT JOIN lost_statuses l ON l.id = d.lost_status_id
       WHERE ${w.sql}`,
    )
    .bind(NO_CAMPAIGN, NO_REASON, ...w.params)
    .all<DealRow>();

  const groups = new Map<string, DealRow[]>();
  for (const r of results) {
    if (!groups.has(r.key)) groups.set(r.key, []);
    groups.get(r.key)!.push(r);
  }

  const rows: UtmRow[] = [...groups.entries()].map(([key, deals]) => {
    const reasons = new Map<string, number>();
    for (const d of deals) if (d.lost_reason) reasons.set(d.lost_reason, (reasons.get(d.lost_reason) ?? 0) + 1);
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    const hours = deals
      .filter((d) => d.first_seller_at)
      .map((d) => (new Date(d.first_seller_at!).getTime() - new Date(d.created_at).getTime()) / 3_600_000);
    return {
      key,
      leads: deals.length,
      contacted: deals.filter((d) => d.first_seller_at).length,
      replied: deals.filter((d) => d.lead_replied).length,
      open: deals.filter((d) => d.status === "OPEN").length,
      won: deals.filter((d) => d.status === "WON").length,
      lost: deals.filter((d) => d.status === "LOST").length,
      stalled: deals.filter((d) => d.status === "OPEN" && d.days_inactive > STALLED_DAYS).length,
      median_first_contact_hours: median(hours),
      top_lost_reason: top ? top[0] : null,
      ads: null,
    };
  });
  const adsAvailable = await attachAds(db, f, dim, rows);
  rows.sort((a, b) => b.leads - a.leads || (b.ads?.spend ?? 0) - (a.ads?.spend ?? 0));

  // Leads per day for the five biggest groups.
  const days: string[] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) days.push(d);
  const idx = new Map(days.map((d, i) => [d, i]));
  const series = rows.slice(0, 5).map((r) => {
    const per_day = days.map(() => 0);
    for (const d of groups.get(r.key) ?? []) {
      const i = idx.get(d.created_day_sp);
      if (i !== undefined) per_day[i]++;
    }
    return { key: r.key, per_day };
  });

  const windowStart = addDays(today, -cfg.messageWindowDays);
  return { dim, rows, days, series, stalled_days: STALLED_DAYS, contact_data_partial: f.from < windowStart, ads_available: adsAvailable };
}

const ADS_DIMS: Partial<Record<UtmDimension, { metaId: string; metaName: string; dealId: string; dealName: string }>> = {
  campaign: { metaId: "campaign_id", metaName: "campaign_name", dealId: "campaign_id", dealName: "campaign_name" },
  ad: { metaId: "ad_id", metaName: "ad_name", dealId: "ad_id", dealName: "ad_name" },
};

/**
 * Joins Meta Ads spend/leads to the UTM rows by campaign or ad id (the ids Meta Lead Ads writes on
 * each Clint deal). Rows with spend but no CRM lead in the period are added with zero leads.
 * Returns false when the dimension has no ads data (form / utm_*) or nothing was synced yet.
 */
async function attachAds(db: Db, f: Filters, dim: UtmDimension, rows: UtmRow[]): Promise<boolean> {
  const m = ADS_DIMS[dim];
  if (!m) return false;
  const meta = await db
    .prepare(
      `SELECT ${m.metaId} AS id, MAX(${m.metaName}) AS name, SUM(spend) AS spend, SUM(leads) AS leads,
              SUM(impressions) AS impressions, SUM(clicks) AS clicks
       FROM meta_insights WHERE date BETWEEN ? AND ? AND ${m.metaId} IS NOT NULL GROUP BY 1`,
    )
    .bind(f.from, f.to)
    .all<{ id: string; name: string | null; spend: number; leads: number; impressions: number; clicks: number }>();
  if (!meta.results.length) return false;

  // Meta id → the name the CRM uses for it (names are what the UTM rows are keyed by).
  const names = new Map(
    (
      await db
        .prepare(`SELECT ${m.dealId} AS id, MAX(${m.dealName}) AS name FROM deals WHERE ${m.dealId} IS NOT NULL GROUP BY 1`)
        .all<{ id: string; name: string }>()
    ).results.map((r) => [r.id, r.name]),
  );
  // CRM leads and sales per row ignoring the status filter, so costs use every lead of the campaign.
  const w = dealWhere({ ...f, statuses: [] }, "d", { period: true, cross: true });
  const crm = new Map(
    (
      await db
        .prepare(
          `SELECT COALESCE(d.${m.dealName}, ?) AS key, COUNT(*) AS leads, SUM(d.status = 'WON') AS won FROM deals d WHERE ${w.sql} GROUP BY 1`,
        )
        .bind(NO_CAMPAIGN, ...w.params)
        .all<{ key: string; leads: number; won: number }>()
    ).results.map((r) => [r.key, r]),
  );

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const onlyCampaigns = dim === "campaign" && f.campaigns.length ? new Set(f.campaigns) : null;
  for (const a of meta.results) {
    const key = names.get(a.id) ?? a.name ?? a.id;
    if (onlyCampaigns && !onlyCampaigns.has(key)) continue;
    let row = byKey.get(key);
    if (!row) {
      if (!a.spend) continue;
      row = { key, leads: 0, contacted: 0, replied: 0, open: 0, won: 0, lost: 0, stalled: 0, median_first_contact_hours: null, top_lost_reason: null, ads: null };
      rows.push(row);
      byKey.set(key, row);
    }
    const prev = row.ads;
    row.ads = {
      spend: (prev?.spend ?? 0) + a.spend,
      meta_leads: (prev?.meta_leads ?? 0) + a.leads,
      impressions: (prev?.impressions ?? 0) + a.impressions,
      clicks: (prev?.clicks ?? 0) + a.clicks,
      crm_leads: crm.get(key)?.leads ?? 0,
      crm_won: crm.get(key)?.won ?? 0,
    };
  }
  return true;
}

export const LEAD_KINDS = ["all", "contacted", "not_contacted", "replied", "not_replied", "stalled"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export interface UtmLead {
  deal_id: string;
  contact_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  group: string;
  status: string;
  origin: string | null;
  stage: string | null;
  responsible: string | null;
  created_at: string;
  first_contact_hours: number | null;
  replied: boolean;
  days_inactive: number;
  clint_url: string | null;
}

/**
 * The leads behind the UTM numbers (same filters and rules as getUtm), optionally for one group
 * (`key`), with counts per kind so the list can switch between them:
 * all · contacted / not contacted · replied / not replied · stalled (open, > STALLED_DAYS without activity).
 */
export async function getUtmLeads(
  db: Db,
  cfg: Config,
  f: Filters,
  dim: UtmDimension,
  key: string | null,
  kind: LeadKind = "all",
  now: Date = new Date(),
) {
  const col = UTM_DIMENSIONS[dim] ?? UTM_DIMENSIONS.campaign;
  const w = dealWhere(f, "d", { period: true, cross: true });
  const today = todaySP(now);
  const tz = sqliteTzModifier(now);
  const keyClause = key === null ? "" : key === NO_CAMPAIGN ? `AND d.${col} IS NULL` : `AND d.${col} = ?`;
  const { results } = await db
    .prepare(
      `SELECT d.id AS deal_id, d.contact_id, ct.name, ct.email, ct.phone, COALESCE(d.${col}, ?) AS grp, d.status, d.created_at,
         o.name AS origin, s.label AS stage, u.name AS responsible,
         (SELECT MIN(m.created_at) FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE c.contact_id = d.contact_id AND m.type = 'USER' AND COALESCE(m.content_type, '') <> 'REACTION' AND m.created_at >= d.created_at) AS first_seller_at,
         EXISTS (SELECT 1 FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE c.contact_id = d.contact_id AND m.type = 'CUSTOMER' AND COALESCE(m.content_type, '') <> 'REACTION' AND m.created_at >= d.created_at) AS replied,
         MAX(0, CAST(julianday('${today}') - julianday(date(
           MAX(d.updated_stage_at, COALESCE((SELECT MAX(c.last_message_at) FROM chats c WHERE c.contact_id = d.contact_id), d.updated_stage_at)), '${tz}')) AS INTEGER)) AS days_inactive
       FROM deals d
       LEFT JOIN contacts ct ON ct.id = d.contact_id
       LEFT JOIN origins o ON o.id = d.origin_id
       LEFT JOIN stages s ON s.id = d.stage_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE ${w.sql} ${keyClause}`,
    )
    .bind(NO_CAMPAIGN, ...w.params, ...(key === null || key === NO_CAMPAIGN ? [] : [key]))
    .all<{
      deal_id: string;
      contact_id: string | null;
      name: string | null;
      email: string | null;
      phone: string | null;
      grp: string;
      status: string;
      created_at: string;
      origin: string | null;
      stage: string | null;
      responsible: string | null;
      first_seller_at: string | null;
      replied: number;
      days_inactive: number;
    }>();

  const all: UtmLead[] = results.map((r) => ({
    deal_id: r.deal_id,
    contact_id: r.contact_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    group: r.grp,
    status: r.status,
    origin: r.origin,
    stage: r.stage,
    responsible: r.responsible,
    created_at: r.created_at,
    first_contact_hours: r.first_seller_at ? (new Date(r.first_seller_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000 : null,
    replied: Boolean(r.replied),
    days_inactive: r.days_inactive,
    clint_url: clintUrl(cfg, { deal_id: r.deal_id, contact_id: r.contact_id }),
  }));
  const is: Record<LeadKind, (l: UtmLead) => boolean> = {
    all: () => true,
    contacted: (l) => l.first_contact_hours !== null,
    not_contacted: (l) => l.first_contact_hours === null,
    replied: (l) => l.replied,
    not_replied: (l) => !l.replied,
    stalled: (l) => l.status === "OPEN" && l.days_inactive > STALLED_DAYS,
  };
  const counts = Object.fromEntries(LEAD_KINDS.map((k) => [k, all.filter(is[k]).length])) as Record<LeadKind, number>;
  const items = all
    .filter(is[kind] ?? is.all)
    .sort((a, b) => (kind === "stalled" ? b.days_inactive - a.days_inactive : b.created_at.localeCompare(a.created_at)));
  return { key, kind, stalled_days: STALLED_DAYS, counts, items };
}
