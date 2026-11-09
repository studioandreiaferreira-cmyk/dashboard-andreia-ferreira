import type { Db } from "../db/types";
import type { ClintClient } from "../clint/client";
import type { ClintMessage } from "../clint/types";
import { clintUrl, type Config } from "../config";

// Read-only chat viewer (research R12): content is read live from Clint and never stored.

const MEDIA_TYPES = new Set(["IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "STICKER"]);

export interface ViewerMessage {
  id: string;
  created_at: string;
  side: "lead" | "seller" | "system";
  seller_name: string | null;
  content_type: string;
  text: string | null;
  media: { url: string | null; name: string | null; seconds: number | null } | null;
  reactions: string[];
}

/** Maps raw Clint messages to viewer bubbles; reactions are folded into the message they point to. */
export function mapMessages(raw: ClintMessage[], usersById: Map<string, string>, chatUserId: string | null): ViewerMessage[] {
  const out: ViewerMessage[] = [];
  const byId = new Map<string, ViewerMessage>();
  const reactions: { target: string; value: string }[] = [];
  for (const m of raw) {
    if (m.content_type === "REACTION") {
      const r = m.content_action?.reaction;
      if (r?.message_id && r.value) reactions.push({ target: r.message_id, value: r.value });
      continue;
    }
    const side = m.type === "CUSTOMER" ? "lead" : m.type === "USER" ? "seller" : "system";
    const v: ViewerMessage = {
      id: m.id,
      created_at: m.created_at,
      side,
      seller_name:
        side === "seller" ? (m.user_id && usersById.get(m.user_id)) || (chatUserId && usersById.get(chatUserId)) || "Vendedor" : null,
      content_type: m.content_type,
      text: m.content ?? null,
      media: MEDIA_TYPES.has(m.content_type)
        ? { url: m.content_url ?? null, name: m.content_object?.name ?? null, seconds: m.content_object?.seconds ?? null }
        : null,
      reactions: [],
    };
    out.push(v);
    byId.set(v.id, v);
  }
  for (const r of reactions) byId.get(r.target)?.reactions.push(r.value);
  return out;
}

async function usersMap(db: Db): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT id, name FROM users").all<{ id: string; name: string }>();
  return new Map(results.map((u) => [u.id, u.name]));
}

/** Header data (contact + deals from the mirror) and the contact's chats (live). */
export async function getContactChats(client: ClintClient, db: Db, cfg: Config, contactId: string) {
  const contact = await db.prepare("SELECT id, name, phone FROM contacts WHERE id = ?").bind(contactId).first<{ id: string; name: string | null; phone: string | null }>();
  const { results: deals } = await db
    .prepare(
      `SELECT d.id, o.name AS origin, s.label AS stage, d.status, u.name AS responsible
       FROM deals d LEFT JOIN origins o ON o.id = d.origin_id LEFT JOIN stages s ON s.id = d.stage_id LEFT JOIN users u ON u.id = d.user_id
       WHERE d.contact_id = ? AND d.deleted = 0 ORDER BY (d.status = 'OPEN') DESC, d.updated_at DESC`,
    )
    .bind(contactId)
    .all<{ id: string; origin: string | null; stage: string | null; status: string; responsible: string | null }>();
  const accounts = new Map(
    (await db.prepare("SELECT id, name, type FROM channel_accounts").all<{ id: string; name: string; type: string }>()).results.map((a) => [a.id, a]),
  );
  const chats = (await client.listChatsByContact(contactId))
    .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))
    .map((c) => {
      const acc = accounts.get(c.channel_account_id);
      return {
        id: c.id,
        channel: acc ? `${acc.name} (${acc.type === "INSTAGRAM" ? "Instagram" : "WhatsApp"})` : "Canal",
        user_id: c.user_id,
        last_message_at: c.last_message_at,
        status: c.status,
      };
    });
  return {
    contact: contact ?? { id: contactId, name: null, phone: null },
    deals,
    chats,
    clint_url: clintUrl(cfg, { deal_id: deals[0]?.id ?? null, contact_id: contactId }),
  };
}

/** One page (newest first) of a chat's messages, mapped for the viewer. */
export async function getChatMessages(client: ClintClient, db: Db, chatId: string, page: number) {
  const res = await client.getMessagesPage(chatId, page, 50);
  const chat = await db.prepare("SELECT user_id FROM chats WHERE id = ?").bind(chatId).first<{ user_id: string | null }>();
  return { page, has_more: res.has_next, messages: mapMessages(res.data ?? [], await usersMap(db), chat?.user_id ?? null) };
}
