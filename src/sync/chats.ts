import type { Db } from "../db/types";
import type { ClintClient } from "../clint/client";
import { batchRun, getState, minusMinutes, setState } from "./state";

/** Pulls chats with recent activity per channel account, by last_message_at cursor (research R3 step 4). */
export async function syncChats(client: ClintClient, db: Db, windowStart: string): Promise<string[]> {
  const { results: accounts } = await db.prepare("SELECT id FROM channel_accounts").all<{ id: string }>();
  const touched: string[] = [];
  for (const { id } of accounts) {
    const key = `chats_cursor:${id}`;
    const cursor = (await getState(db, key)) ?? windowStart;
    let maxLast = cursor;
    for await (const page of client.listChatsByChannel(id, minusMinutes(cursor, 5))) {
      await batchRun(
        db,
        page.map((c) =>
          db
            .prepare(
              `INSERT INTO chats (id, contact_id, channel_account_id, user_id, status, last_message_at, last_response_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET contact_id = excluded.contact_id, channel_account_id = excluded.channel_account_id,
                 user_id = excluded.user_id, status = excluded.status, last_message_at = excluded.last_message_at,
                 last_response_at = excluded.last_response_at`,
            )
            .bind(c.id, c.contact_id, c.channel_account_id ?? id, c.user_id ?? null, c.status, c.last_message_at ?? null, c.last_response_at ?? null),
        ),
      );
      for (const c of page) {
        touched.push(c.id);
        if (c.last_message_at && c.last_message_at > maxLast) maxLast = c.last_message_at;
      }
    }
    await setState(db, key, maxLast);
  }
  return touched;
}
