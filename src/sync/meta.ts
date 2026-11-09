import type { Env } from "../config";
import { actionOf, leadsOf, MetaClient, purchasesOf } from "../meta/client";
import { addDays, todaySP } from "../lib/time";
import { batchRun, getState, setState } from "./state";

const EVERY_MINUTES = 60;
const BACKFILL_DAYS = 90;
// Meta keeps adjusting the last days (late conversions), so they are re-read on every pass.
const REFRESH_DAYS = 3;

/**
 * Pulls Meta Ads daily insights per ad into meta_insights, at most once per hour.
 * Skipped when META_API_TOKEN is not set. Failures are recorded in meta_last_error and never
 * break the Clint sync.
 */
export async function syncMeta(env: Env, now: Date, onCall?: () => void): Promise<"skipped" | "ok" | "error"> {
  if (!env.META_API_TOKEN) return "skipped";
  const db = env.DB;
  const last = await getState(db, "meta_last_sync");
  if (last && now.getTime() - new Date(last).getTime() < EVERY_MINUTES * 60_000) return "skipped";

  const client = new MetaClient(env.META_API_TOKEN, onCall);
  const today = todaySP(now);
  const since = last ? addDays(today, -REFRESH_DAYS) : addDays(today, -BACKFILL_DAYS);
  try {
    const accounts = (await client.adAccounts()).filter((a) => a.account_status === 1);
    for (const acc of accounts) {
      const rows = await client.insights(acc.id, since, today);
      await batchRun(
        db,
        rows.map((r) =>
          db
            .prepare(
              `INSERT INTO meta_insights (ad_id, date, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name, spend, impressions, clicks, leads,
                 link_clicks, landing_page_views, video_3s, purchases, purchase_value)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ad_id, date) DO UPDATE SET campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name,
                 adset_id = excluded.adset_id, adset_name = excluded.adset_name, ad_name = excluded.ad_name, spend = excluded.spend,
                 impressions = excluded.impressions, clicks = excluded.clicks, leads = excluded.leads, link_clicks = excluded.link_clicks,
                 landing_page_views = excluded.landing_page_views, video_3s = excluded.video_3s, purchases = excluded.purchases,
                 purchase_value = excluded.purchase_value`,
            )
            .bind(
              r.ad_id,
              r.date_start,
              acc.id,
              r.campaign_id ?? null,
              r.campaign_name ?? null,
              r.adset_id ?? null,
              r.adset_name ?? null,
              r.ad_name ?? null,
              Number(r.spend ?? 0),
              Number(r.impressions ?? 0),
              Number(r.clicks ?? 0),
              leadsOf(r),
              Number(r.inline_link_clicks ?? 0),
              Math.round(actionOf(r.actions, "landing_page_view", "omni_landing_page_view")),
              Math.round(actionOf(r.actions, "video_view")),
              purchasesOf(r).count,
              purchasesOf(r).value,
            ),
        ),
      );
      // Only the ads that delivered in this window (thumbnail links expire, so they are refreshed with it).
      const ads = await client.adsByIds([...new Set(rows.map((r) => r.ad_id))]);
      await batchRun(
        db,
        ads.map((a) =>
          db
            .prepare(
              `INSERT INTO meta_ads (ad_id, account_id, name, adset_id, campaign_id, status, thumbnail_url, preview_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ad_id) DO UPDATE SET name = excluded.name, adset_id = excluded.adset_id, campaign_id = excluded.campaign_id,
                 status = excluded.status, thumbnail_url = excluded.thumbnail_url, preview_url = excluded.preview_url`,
            )
            .bind(a.id, acc.id, a.name ?? null, a.adset_id ?? null, a.campaign_id ?? null, a.effective_status ?? null, a.creative?.thumbnail_url ?? null, a.preview_shareable_link ?? null),
        ),
      );
    }
    await setState(db, "meta_last_sync", now.toISOString());
    await setState(db, "meta_last_error", null);
    return "ok";
  } catch (e) {
    await setState(db, "meta_last_error", JSON.stringify({ at: now.toISOString(), message: e instanceof Error ? e.message : String(e) }));
    return "error";
  }
}
