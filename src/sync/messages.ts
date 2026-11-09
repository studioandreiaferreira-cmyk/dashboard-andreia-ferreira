import type { Db, Stmt } from "../db/types";
import { BudgetExhausted, type ClintClient } from "../clint/client";
import { attributeMessage } from "../lib/attribution";
import { toDaySP } from "../lib/time";
import { batchRun } from "./state";

interface PendingChat {
  id: string;
  contact_id: string | null;
  user_id: string | null;
  last_message_at: string | null;
}

/**
 * Fetches message metadata (never content) for chats with new activity, newest first, stopping at a
 * message already stored or older than the window (research R3 step 5). Returns the chats it finished.
 */
export async function syncMessages(client: ClintClient, db: Db, windowStart: string): Promise<string[]> {
  const { results: pending } = await db
    .prepare(
      `SELECT id, contact_id, user_id, last_message_at FROM chats
       WHERE last_message_at >= ? AND (messages_synced_until IS NULL OR last_message_at > messages_synced_until)
       ORDER BY last_message_at ASC`,
    )
    .bind(windowStart)
    .all<PendingChat>();

  const done: string[] = [];
  for (const chat of pending) {
    try {
      await syncChatMessages(client, db, chat, windowStart);
      done.push(chat.id);
    } catch (e) {
      if (e instanceof BudgetExhausted) break; // the next run resumes with the remaining chats
      throw e;
    }
  }
  return done;
}

async function syncChatMessages(client: ClintClient, db: Db, chat: PendingChat, windowStart: string): Promise<void> {
  const owner = chat.contact_id
    ? await db
        .prepare("SELECT user_id FROM deals WHERE contact_id = ? AND status = 'OPEN' AND deleted = 0 ORDER BY updated_at DESC LIMIT 1")
        .bind(chat.contact_id)
        .first<{ user_id: string | null }>()
    : null;
  const known = new Set(
    (await db.prepare("SELECT id FROM messages WHERE chat_id = ?").bind(chat.id).all<{ id: string }>()).results.map((r) => r.id),
  );

  const stmts: Stmt[] = [];
  outer: for await (const page of client.listMessagesByChat(chat.id)) {
    for (const m of page) {
      if (known.has(m.id) || m.created_at < windowStart) break outer;
      const a = attributeMessage(m, chat, owner?.user_id ?? null);
      stmts.push(
        db
          .prepare(
            `INSERT INTO messages (id, chat_id, type, content_type, sender_user_id, attributed_user_id, attribution, created_at, created_day_sp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET attributed_user_id = excluded.attributed_user_id, attribution = excluded.attribution`,
          )
          .bind(m.id, chat.id, m.type, m.content_type ?? null, m.user_id ?? null, a.attributed_user_id, a.attribution, m.created_at, toDaySP(m.created_at)),
      );
    }
  }
  stmts.push(db.prepare("UPDATE chats SET messages_synced_until = ? WHERE id = ?").bind(chat.last_message_at, chat.id));
  await batchRun(db, stmts);
}
