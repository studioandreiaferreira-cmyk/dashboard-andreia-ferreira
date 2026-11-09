import type { Db } from "../db/types";
import type { Config } from "../config";
import { addDays, dayRange, todaySP } from "../lib/time";
import { dealWhere, type Filters } from "./filters";

const METRIC_MSG = "COALESCE(m.content_type, '') <> 'REACTION'";

/**
 * Conversations per day (message window only): distinct chats where a seller sent at least one
 * message, and distinct chats where the lead wrote. Origin/group/seller filters reach chats through
 * the deals of the chat's contact.
 */
export async function getConversations(db: Db, cfg: Config, f: Filters, now: Date = new Date()) {
  const windowStart = addDays(todaySP(now), -cfg.messageWindowDays);
  const from = f.from < windowStart ? windowStart : f.from;
  const days = from <= f.to ? dayRange(from, f.to) : [];
  const dw = dealWhere(f, "d");
  const filtered = f.originIds.length + f.groupIds.length + f.userIds.length + f.statuses.length + f.campaigns.length > 0;
  const clause = filtered ? `AND EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.contact_id AND ${dw.sql})` : "";
  const params = filtered ? dw.params : [];

  const { results } = await db
    .prepare(
      `SELECT m.created_day_sp AS day,
              COUNT(DISTINCT CASE WHEN m.type = 'USER' THEN m.chat_id END) AS seller,
              COUNT(DISTINCT CASE WHEN m.type = 'CUSTOMER' THEN m.chat_id END) AS lead
       FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE m.type IN ('USER', 'CUSTOMER') AND ${METRIC_MSG} AND m.created_day_sp BETWEEN ? AND ? ${clause}
       GROUP BY 1`,
    )
    .bind(from, f.to, ...params)
    .all<{ day: string; seller: number; lead: number }>();

  const totals = await db
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN m.type = 'USER' THEN m.chat_id END) AS seller,
              COUNT(DISTINCT CASE WHEN m.type = 'CUSTOMER' THEN m.chat_id END) AS lead
       FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE m.type IN ('USER', 'CUSTOMER') AND ${METRIC_MSG} AND m.created_day_sp BETWEEN ? AND ? ${clause}`,
    )
    .bind(from, f.to, ...params)
    .first<{ seller: number; lead: number }>();

  const byDay = new Map(results.map((r) => [r.day, r]));
  return {
    days,
    seller_per_day: days.map((d) => byDay.get(d)?.seller ?? 0),
    lead_per_day: days.map((d) => byDay.get(d)?.lead ?? 0),
    total_seller_chats: totals?.seller ?? 0,
    total_lead_chats: totals?.lead ?? 0,
  };
}
