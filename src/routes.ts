import { getChatMessages, getContactChats } from "./chat/viewer";
import type { ClintClient } from "./clint/client";
import { getConfig, type Env } from "./config";
import type { Db } from "./db/types";
import { getCampaigns, type CampaignLevel } from "./metrics/campaigns";
import { getConversations } from "./metrics/conversations";
import { buildMeta, NO_CAMPAIGN, parseFilters } from "./metrics/filters";
import { getIntake } from "./metrics/intake";
import { getLaunch } from "./metrics/launch";
import { getNoReply } from "./metrics/noReply";
import { getProfile } from "./metrics/profile";
import { getSales } from "./metrics/sales";
import { getSellers } from "./metrics/sellers";
import { getStalled } from "./metrics/stalled";
import { getStatusSummary } from "./metrics/status";
import { getUtm, getUtmLeads, LEAD_KINDS, type LeadKind, type UtmDimension } from "./metrics/utm";

export class NotFound extends Error {}

/**
 * The dashboard "API", answered in the browser over the snapshot database (same paths and payloads
 * the Worker used to serve). `clint` reaches the live conversation endpoints (Edge Function `chat`).
 */
export async function route(env: Env, clint: ClintClient, path: string, q: URLSearchParams): Promise<unknown> {
  const db: Db = env.DB;
  const cfg = getConfig(env);
  if (path === "/filters") {
    const f = parseFilters(q);
    const [groups, origins, users, campaigns] = await Promise.all([
      db.prepare("SELECT id, name FROM groups ORDER BY name").all(),
      db
        .prepare(
          `SELECT o.id, o.name, o.group_id, o.archived_at IS NOT NULL AS archived,
                  (SELECT COUNT(*) FROM deals d WHERE d.origin_id = o.id AND d.deleted = 0 AND d.created_day_sp BETWEEN ? AND ?) AS deals,
                  (SELECT COUNT(*) FROM deals d WHERE d.origin_id = o.id AND d.deleted = 0 AND d.status = 'OPEN') AS open
           FROM origins o ORDER BY deals DESC, o.name`,
        )
        .bind(f.from, f.to)
        .all<{ archived: number }>(),
      db.prepare("SELECT id, name, active FROM users ORDER BY name").all<{ active: number }>(),
      db
        .prepare(
          `SELECT COALESCE(campaign_name, ?) AS name, COUNT(*) AS deals FROM deals
           WHERE deleted = 0 AND created_day_sp BETWEEN ? AND ? GROUP BY 1 ORDER BY deals DESC`,
        )
        .bind(NO_CAMPAIGN, f.from, f.to)
        .all<{ name: string; deals: number }>(),
    ]);
    return {
      groups: groups.results,
      origins: origins.results.map((o) => ({ ...o, archived: Boolean(o.archived) })),
      users: users.results.map((u) => ({ ...u, active: Boolean(u.active) })),
      campaigns: campaigns.results,
      meta: await buildMeta(db, cfg, null),
    };
  }

  const metric = path.match(/^\/metrics\/([\w-]+)$/)?.[1];
  if (metric) {
    const f = parseFilters(q);
    let data: unknown;
    switch (metric) {
      case "sellers":
        data = await getSellers(db, cfg, f);
        break;
      case "utm":
        data = await getUtm(db, cfg, f, (q.get("dim") as UtmDimension) ?? "campaign");
        break;
      case "utm-leads": {
        const kind = (LEAD_KINDS as readonly string[]).includes(q.get("kind") ?? "") ? (q.get("kind") as LeadKind) : "all";
        data = await getUtmLeads(db, cfg, f, (q.get("dim") as UtmDimension) ?? "campaign", q.has("key") ? q.get("key") : null, kind);
        break;
      }
      case "status":
        data = await getStatusSummary(db, f);
        break;
      case "conversations":
        data = await getConversations(db, cfg, f);
        break;
      case "no-reply":
        data = await getNoReply(db, cfg, f);
        break;
      case "intake":
        data = await getIntake(db, f);
        break;
      case "stalled":
        data = await getStalled(db, cfg, f, new Date(), {
          sort: q.get("sort") === "stage" ? "stage" : "inactive",
          page: Number(q.get("page") ?? 1) || 1,
          pageSize: Number(q.get("page_size") ?? 50) || 50,
        });
        break;
      case "campaigns":
        data = await getCampaigns(db, f, (q.get("level") as CampaignLevel) ?? "campaign");
        break;
      case "profile":
        data = await getProfile(db, cfg, f);
        break;
      case "launch":
        data = await getLaunch(db, f, { funnelOrigin: q.get("funnel_origin") });
        break;
      case "sales":
        data = await getSales(db, f);
        break;
      default:
        throw new NotFound(path);
    }
    return { ...(data as object), meta: await buildMeta(db, cfg, f) };
  }

  const contact = path.match(/^\/contacts\/([\w-]+)\/chats$/)?.[1];
  if (contact) return getContactChats(clint, db, cfg, contact);
  const chat = path.match(/^\/chats\/([\w-]+)\/messages$/)?.[1];
  if (chat) return getChatMessages(clint, db, chat, Math.max(1, Number(q.get("page") ?? 1) || 1));
  throw new NotFound(path);
}
