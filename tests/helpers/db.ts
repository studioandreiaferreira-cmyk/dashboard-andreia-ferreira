import { env } from "cloudflare:test";

const TABLES = ["meta_ads", "meta_insights", "chat_reply_state", "messages", "chats", "deals", "lost_statuses", "contacts", "stages", "origins", "groups", "users", "channel_accounts", "sync_state", "login_attempts"];

/** Empties every table (children first, D1 enforces foreign keys) so each test starts from a clean mirror. */
export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}
