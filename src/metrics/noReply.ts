import type { Db } from "../db/types";
import { clintUrl, type Config } from "../config";
import { businessMinutesBetween } from "../lib/time";
import { dealWhere, type Filters } from "./filters";

const METRIC_MSG = "COALESCE(content_type, '') <> 'REACTION'";

/**
 * Recomputes chat_reply_state for every chat (research R4):
 * awaiting_since = first lead message after the last seller message (events and reactions ignored);
 * chats without stored messages fall back to last_message_at vs last_response_at.
 */
export async function recomputeReplyState(db: Db): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chat_reply_state (chat_id, awaiting_since, has_open_deal, responsible_user_id)
       SELECT c.id,
         CASE WHEN EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.type IN ('USER','CUSTOMER') AND ${METRIC_MSG})
           THEN (SELECT MIN(m.created_at) FROM messages m
                 WHERE m.chat_id = c.id AND m.type = 'CUSTOMER' AND ${METRIC_MSG}
                   AND m.created_at > COALESCE((SELECT MAX(u.created_at) FROM messages u
                                                WHERE u.chat_id = c.id AND u.type = 'USER' AND COALESCE(u.content_type, '') <> 'REACTION'), ''))
           ELSE CASE WHEN c.last_message_at IS NOT NULL AND (c.last_response_at IS NULL OR c.last_message_at > c.last_response_at)
                     THEN c.last_message_at END
         END,
         CASE WHEN EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.contact_id AND d.status = 'OPEN' AND d.deleted = 0) THEN 1 ELSE 0 END,
         COALESCE(c.user_id, (SELECT d.user_id FROM deals d WHERE d.contact_id = c.contact_id AND d.status = 'OPEN' AND d.deleted = 0
                              ORDER BY d.updated_at DESC LIMIT 1))
       FROM chats c
       WHERE true
       ON CONFLICT(chat_id) DO UPDATE SET awaiting_since = excluded.awaiting_since, has_open_deal = excluded.has_open_deal,
         responsible_user_id = excluded.responsible_user_id`,
    )
    .run();
}

export interface NoReplyItem {
  contact_id: string;
  contact_name: string | null;
  phone: string | null;
  origin: string | null;
  responsible: string | null;
  awaiting_since: string;
  business_minutes_waiting: number;
  deal_id: string | null;
  chat_id: string;
  clint_url: string | null;
}

/** People awaiting a seller reply beyond the threshold, only contacts with an open deal (FR-008..010). */
export async function getNoReply(db: Db, cfg: Config, f: Filters, now: Date = new Date()) {
  // Origin/group filters apply to the contact's open deals; the seller filter applies to the responsible person.
  const dw = dealWhere({ ...f, userIds: [], statuses: [] }, "d");
  const where = [`d.status = 'OPEN'`, dw.sql];
  const params = dw.params;
  const userFilter: string[] = [];
  const userParams: unknown[] = [];
  if (f.userIds.length) {
    const ids = f.userIds.filter((u) => u !== "none");
    if (ids.length) {
      userFilter.push(`s.responsible_user_id IN (${ids.map(() => "?").join(",")})`);
      userParams.push(...ids);
    }
    if (f.userIds.includes("none")) userFilter.push("s.responsible_user_id IS NULL");
  }

  const { results } = await db
    .prepare(
      `SELECT c.id AS chat_id, c.contact_id, ct.name AS contact_name, ct.phone, s.awaiting_since,
              u.name AS responsible,
              (SELECT d.id FROM deals d WHERE d.contact_id = c.contact_id AND ${where.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 1) AS deal_id,
              (SELECT o.name FROM deals d JOIN origins o ON o.id = d.origin_id WHERE d.contact_id = c.contact_id AND ${where.join(" AND ")}
                 ORDER BY d.updated_at DESC LIMIT 1) AS origin
       FROM chat_reply_state s
       JOIN chats c ON c.id = s.chat_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN users u ON u.id = s.responsible_user_id
       WHERE s.awaiting_since IS NOT NULL AND s.has_open_deal = 1
         AND EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.contact_id AND ${where.join(" AND ")})
         ${userFilter.length ? `AND (${userFilter.join(" OR ")})` : ""}`,
    )
    .bind(...params, ...params, ...params, ...userParams)
    .all<Omit<NoReplyItem, "business_minutes_waiting" | "clint_url">>();

  const items: NoReplyItem[] = [];
  for (const r of results) {
    const minutes = businessMinutesBetween(r.awaiting_since, now.getTime(), cfg.businessHours);
    if (minutes <= cfg.noReplyMinutes) continue;
    items.push({ ...r, business_minutes_waiting: minutes, clint_url: clintUrl(cfg, { deal_id: r.deal_id, contact_id: r.contact_id, chat_id: r.chat_id }) });
  }
  items.sort((a, b) => b.business_minutes_waiting - a.business_minutes_waiting);
  return {
    total: items.length,
    threshold_minutes: cfg.noReplyMinutes,
    business_hours: { days: cfg.businessHours.days, start: cfg.businessHours.start, end: cfg.businessHours.end },
    items,
  };
}
