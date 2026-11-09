import type { Db } from "../db/types";
import type { Config } from "../config";
import { addDays, todaySP } from "../lib/time";
import { getState } from "../sync/state";

export interface Filters {
  from: string;
  to: string;
  originIds: string[];
  groupIds: string[];
  /** seller ids; "none" = Sem responsável */
  userIds: string[];
  /** deal statuses to include (OPEN / WON / LOST); empty = all */
  statuses: string[];
  /** global campaign filter (campaign names; NO_CAMPAIGN = deals without campaign) */
  campaigns: string[];
  campaign: string | null;
  ad: string | null;
  form: string | null;
}

export const NO_CAMPAIGN = "Sem campanha / Orgânico";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const STATUSES = ["OPEN", "WON", "LOST"];

function csv(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseFilters(q: URLSearchParams, now: Date = new Date()): Filters {
  const today = todaySP(now);
  const from = q.get("from");
  const to = q.get("to");
  return {
    from: from && DAY_RE.test(from) ? from : addDays(today, -29),
    to: to && DAY_RE.test(to) ? to : today,
    originIds: csv(q.get("origin_ids")),
    groupIds: csv(q.get("group_ids")),
    userIds: csv(q.get("user_ids")),
    campaigns: q.getAll("campaigns").flatMap((v) => v.split("\n")).map((s) => s.trim()).filter(Boolean),
    statuses: csv(q.get("status")).map((s) => s.toUpperCase()).filter((s) => STATUSES.includes(s)),
    campaign: q.get("campaign") || null,
    ad: q.get("ad") || null,
    form: q.get("form") || null,
  };
}

export interface Where {
  sql: string;
  params: unknown[];
}

const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

/**
 * WHERE clause over deals (alias `a`) for the global filters. `period` adds the created-day range;
 * `cross` adds the campaign/ad/form cross-filters. Group ids expand to every origin of the group.
 */
export function dealWhere(f: Filters, a = "d", opts: { period?: boolean; cross?: boolean } = {}): Where {
  const sql: string[] = [`${a}.deleted = 0`];
  const params: unknown[] = [];
  const originParts: string[] = [];
  if (f.originIds.length) {
    originParts.push(`${a}.origin_id IN (${ph(f.originIds.length)})`);
    params.push(...f.originIds);
  }
  if (f.groupIds.length) {
    originParts.push(`${a}.origin_id IN (SELECT id FROM origins WHERE group_id IN (${ph(f.groupIds.length)}))`);
    params.push(...f.groupIds);
  }
  if (originParts.length) sql.push(`(${originParts.join(" OR ")})`);
  if (f.userIds.length) {
    const ids = f.userIds.filter((u) => u !== "none");
    const parts: string[] = [];
    if (ids.length) {
      parts.push(`${a}.user_id IN (${ph(ids.length)})`);
      params.push(...ids);
    }
    if (f.userIds.includes("none")) parts.push(`${a}.user_id IS NULL`);
    sql.push(`(${parts.join(" OR ")})`);
  }
  if (f.statuses.length && f.statuses.length < STATUSES.length) {
    sql.push(`${a}.status IN (${ph(f.statuses.length)})`);
    params.push(...f.statuses);
  }
  if (f.campaigns.length) {
    const named = f.campaigns.filter((c) => c !== NO_CAMPAIGN);
    const parts: string[] = [];
    if (named.length) {
      parts.push(`${a}.campaign_name IN (${ph(named.length)})`);
      params.push(...named);
    }
    if (f.campaigns.includes(NO_CAMPAIGN)) parts.push(`${a}.campaign_name IS NULL`);
    sql.push(`(${parts.join(" OR ")})`);
  }
  if (opts.period) {
    sql.push(`${a}.created_day_sp BETWEEN ? AND ?`);
    params.push(f.from, f.to);
  }
  if (opts.cross) {
    for (const [col, val] of [
      ["campaign_name", f.campaign],
      ["ad_name", f.ad],
      ["form_name", f.form],
    ] as const) {
      if (!val) continue;
      if (val === NO_CAMPAIGN) sql.push(`${a}.${col} IS NULL`);
      else {
        sql.push(`${a}.${col} = ?`);
        params.push(val);
      }
    }
  }
  return { sql: sql.join(" AND "), params };
}

export interface Meta {
  last_sync_at: string | null;
  sync_ok: boolean;
  last_error: string | null;
  message_window_start: string;
  message_window_truncated: boolean;
}

export async function buildMeta(db: Db, cfg: Config, f: Filters | null, now: Date = new Date()): Promise<Meta> {
  const lastSuccess = await getState(db, "last_success_at");
  const lastErrorRaw = await getState(db, "last_error");
  let lastError: { at: string; message: string } | null = null;
  try {
    lastError = lastErrorRaw ? JSON.parse(lastErrorRaw) : null;
  } catch {
    lastError = null;
  }
  // Sync runs every 30 min (Supabase pg_cron): stale after a missed run plus margin.
  const stale = !lastSuccess || now.getTime() - new Date(lastSuccess).getTime() > 75 * 60_000;
  const errorNewer = Boolean(lastError && (!lastSuccess || lastError.at > lastSuccess));
  const windowStart = addDays(todaySP(now), -cfg.messageWindowDays);
  return {
    last_sync_at: lastSuccess,
    sync_ok: !stale && !errorNewer,
    last_error: errorNewer ? lastError!.message : null,
    message_window_start: windowStart,
    message_window_truncated: f ? f.from < windowStart : false,
  };
}
