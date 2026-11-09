import type { Db } from "../db/types";
import type { Config } from "../config";
import { addDays, dayRange, dayStartUtc, todaySP } from "../lib/time";
import { dealWhere, type Filters } from "./filters";

const SELLER_MSG = "m.type = 'USER' AND COALESCE(m.content_type, '') <> 'REACTION'";

/** Messages sent per seller per day and deals worked per seller (FR-005..007, FR-029). */
export async function getSellers(db: Db, cfg: Config, f: Filters, now: Date = new Date()) {
  const windowStart = addDays(todaySP(now), -cfg.messageWindowDays);
  const from = f.from < windowStart ? windowStart : f.from;
  const days = from <= f.to ? dayRange(from, f.to) : [];

  // Origin/group filters reach messages through the deals of the chat's contact.
  const dw = dealWhere({ ...f, userIds: [] }, "d");
  const hasOriginFilter = f.originIds.length > 0 || f.groupIds.length > 0;
  const originClause = hasOriginFilter ? `AND EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.contact_id AND ${dw.sql})` : "";
  const originParams = hasOriginFilter ? dw.params : [];

  const perDay = await db
    .prepare(
      `SELECT m.attributed_user_id AS uid, m.created_day_sp AS day, COUNT(*) AS n
       FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE ${SELLER_MSG} AND m.created_day_sp BETWEEN ? AND ? ${originClause}
       GROUP BY 1, 2`,
    )
    .bind(from, f.to, ...originParams)
    .all<{ uid: string | null; day: string; n: number }>();

  const inferred = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE ${SELLER_MSG} AND m.created_day_sp BETWEEN ? AND ? AND m.attribution <> 'direct' ${originClause}`,
    )
    .bind(from, f.to, ...originParams)
    .first<{ n: number }>();

  // Deals worked: (a) a seller message in a chat of the deal's contact, or (b) a stage change of a deal the seller owns.
  const startUtc = dayStartUtc(f.from);
  const endUtc = dayStartUtc(addDays(f.to, 1));
  const worked = await db
    .prepare(
      `SELECT uid, COUNT(DISTINCT deal_id) AS n FROM (
         SELECT m.attributed_user_id AS uid, d.id AS deal_id
         FROM messages m JOIN chats c ON c.id = m.chat_id JOIN deals d ON d.contact_id = c.contact_id
         WHERE ${SELLER_MSG} AND m.created_day_sp BETWEEN ? AND ? AND ${dw.sql}
         UNION
         SELECT d.user_id AS uid, d.id AS deal_id FROM deals d
         WHERE d.updated_stage_at >= ? AND d.updated_stage_at < ? AND ${dw.sql}
       ) GROUP BY uid`,
    )
    .bind(from, f.to, ...dw.params, startUtc, endUtc, ...dw.params)
    .all<{ uid: string | null; n: number }>();

  const users = await db.prepare("SELECT id, name, active FROM users ORDER BY name").all<{ id: string; name: string; active: number }>();
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const series = new Map<string | null, { messages_per_day: number[]; messages_total: number; deals_worked: number }>();
  const entry = (uid: string | null) => {
    let s = series.get(uid);
    if (!s) {
      s = { messages_per_day: days.map(() => 0), messages_total: 0, deals_worked: 0 };
      series.set(uid, s);
    }
    return s;
  };
  for (const u of users.results) if (u.active) entry(u.id);
  for (const r of perDay.results) {
    const i = dayIndex.get(r.day);
    if (i === undefined) continue;
    const s = entry(r.uid);
    s.messages_per_day[i] += r.n;
    s.messages_total += r.n;
  }
  for (const r of worked.results) entry(r.uid).deals_worked = r.n;

  const names = new Map(users.results.map((u) => [u.id, u.name]));
  const selected = (uid: string) => f.userIds.length === 0 || f.userIds.includes(uid);
  const out = [...series.entries()]
    .filter(([uid]) => uid !== null && selected(uid))
    .map(([uid, s]) => ({ user_id: uid as string, name: names.get(uid as string) ?? "Usuário removido", ...s }))
    .sort((a, b) => b.messages_total - a.messages_total);
  const none = series.get(null);
  return {
    days,
    series: out,
    unattributed: f.userIds.length === 0 || f.userIds.includes("none") ? (none ?? entry(null)) : null,
    inferred_attribution_count: inferred?.n ?? 0,
  };
}
