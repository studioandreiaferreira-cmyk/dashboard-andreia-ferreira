import type { Db, Stmt } from "../db/types";
import type { ClintClient } from "../clint/client";
import type { ClintDeal } from "../clint/types";
import { toDaySP } from "../lib/time";
import { batchRun, getState, minusMinutes, setState } from "./state";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function upsertDeal(db: Db, d: ClintDeal, seenAt: string): Stmt[] {
  const f = d.fields ?? {};
  const out: Stmt[] = [];
  if (d.contact) {
    const phone = [d.contact.ddi, d.contact.phone].filter(Boolean).join("") || null;
    out.push(
      db
        .prepare(
          `INSERT INTO contacts (id, name, phone, email) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, email = excluded.email`,
        )
        .bind(d.contact.id, d.contact.name ?? null, phone, d.contact.email ?? null),
    );
  }
  out.push(
    db
      .prepare(
        `INSERT INTO deals (id, origin_id, stage_id, user_id, contact_id, status, value, created_at, created_day_sp, updated_at,
           updated_stage_at, won_at, lost_at, campaign_name, campaign_id, ad_name, ad_id, form_name, form_id,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term, fields_json, last_seen_at, lost_status_id, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET origin_id = excluded.origin_id, stage_id = excluded.stage_id, user_id = excluded.user_id,
           contact_id = excluded.contact_id, status = excluded.status, value = excluded.value, updated_at = excluded.updated_at,
           updated_stage_at = excluded.updated_stage_at, won_at = excluded.won_at, lost_at = excluded.lost_at,
           campaign_name = excluded.campaign_name, campaign_id = excluded.campaign_id, ad_name = excluded.ad_name, ad_id = excluded.ad_id,
           form_name = excluded.form_name, form_id = excluded.form_id, utm_source = excluded.utm_source, utm_medium = excluded.utm_medium,
           utm_campaign = excluded.utm_campaign, utm_content = excluded.utm_content, utm_term = excluded.utm_term,
           fields_json = excluded.fields_json, last_seen_at = excluded.last_seen_at,
           lost_status_id = excluded.lost_status_id, deleted = 0`,
      )
      .bind(
        d.id,
        d.origin_id ?? null,
        d.stage_id ?? null,
        d.user?.id ?? null,
        d.contact?.id ?? null,
        d.status,
        d.value ?? null,
        d.created_at,
        toDaySP(d.created_at),
        d.updated_at,
        d.updated_stage_at ?? d.created_at,
        d.won_at ?? null,
        d.lost_at ?? null,
        str(f.campaign_name),
        str(f.campaign_id),
        str(f.ad_name),
        str(f.ad_id),
        str(f.form_name),
        str(f.form_id),
        ...UTM_KEYS.map((k) => str(f[k])),
        JSON.stringify(f),
        seenAt,
        d.lost_status_id ?? null,
      ),
  );
  return out;
}

export interface DealSyncResult {
  changedDealIds: string[];
  changedContactIds: string[];
}

/** Incremental pull by updated_at with a 5-minute overlap (research R3 step 2). */
export async function syncDealsIncremental(client: ClintClient, db: Db): Promise<DealSyncResult> {
  const cursor = await getState(db, "deals_cursor");
  const result: DealSyncResult = { changedDealIds: [], changedContactIds: [] };
  const seenAt = new Date().toISOString();
  let maxUpdated = cursor;
  for await (const page of client.listDeals(cursor ? { updated_at_start: minusMinutes(cursor, 5) } : {})) {
    await batchRun(db, page.flatMap((d) => upsertDeal(db, d, seenAt)));
    for (const d of page) {
      result.changedDealIds.push(d.id);
      if (d.contact) result.changedContactIds.push(d.contact.id);
      if (!maxUpdated || d.updated_at > maxUpdated) maxUpdated = d.updated_at;
    }
  }
  // Pages aren't ordered by updated_at, so the cursor only advances after the whole pull succeeded.
  if (maxUpdated) await setState(db, "deals_cursor", maxUpdated);
  return result;
}

/**
 * Nightly full pass: refresh every deal and flag the ones no longer returned as deleted.
 * Resumable: `runStart` identifies the pass, `fromPage` is where the previous slice stopped, and the
 * returned page is where the next slice must continue (null = pass finished). A slice that runs out
 * of time throws BudgetExhausted after saving its progress through `onPage`.
 */
export async function reconcileDealsFull(
  client: ClintClient,
  db: Db,
  opts: { runStart?: string; fromPage?: number; onPage?: (nextPage: number) => Promise<void> } = {},
): Promise<void> {
  const runStart = opts.runStart ?? new Date().toISOString();
  let page = opts.fromPage ?? 1;
  for await (const rows of client.listDeals({}, page)) {
    await batchRun(db, rows.flatMap((d) => upsertDeal(db, d, runStart)));
    page++;
    await opts.onPage?.(page);
  }
  // Only reached when every page was read, so a partial pass never flags deals as deleted.
  await db.prepare("UPDATE deals SET deleted = 1 WHERE last_seen_at IS NULL OR last_seen_at < ?").bind(runStart).run();
}
