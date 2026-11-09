import type { Db, Stmt } from "../db/types";
import type { ClintClient } from "../clint/client";
import type { ClintContact } from "../clint/types";
import { batchRun } from "./state";

const PER_ID_LIMIT = 50;

function upsertContact(db: Db, c: ClintContact): Stmt {
  const phone = [c.ddi, c.phone].filter(Boolean).join("") || null;
  return db
    .prepare(
      `INSERT INTO contacts (id, name, phone, email, fields_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, email = excluded.email,
         fields_json = excluded.fields_json, updated_at = excluded.updated_at`,
    )
    .bind(c.id, c.name ?? null, phone, c.email ?? null, JSON.stringify(c.fields ?? {}), c.updated_at ?? null);
}

async function syncAllContacts(client: ClintClient, db: Db, fromPage = 1, onPage?: (nextPage: number) => Promise<void>): Promise<void> {
  let page = fromPage;
  for await (const rows of client.listContacts(fromPage)) {
    await batchRun(db, rows.map((c) => upsertContact(db, c)));
    page++;
    await onPage?.(page);
  }
}

/**
 * Keeps contact custom fields (e.g. profession `role`) up to date.
 * Full mode pages every contact; incremental mode fetches the few contacts still missing fields,
 * falling back to a full pass when too many are missing (first sync).
 */
export async function syncContacts(
  client: ClintClient,
  db: Db,
  opts: { full: boolean; fromPage?: number; onPage?: (nextPage: number) => Promise<void> },
): Promise<void> {
  if (opts.full) return syncAllContacts(client, db, opts.fromPage, opts.onPage);
  const { results } = await db.prepare("SELECT id FROM contacts WHERE fields_json IS NULL LIMIT ?").bind(PER_ID_LIMIT + 1).all<{ id: string }>();
  if (results.length > PER_ID_LIMIT) return syncAllContacts(client, db);
  const fetched: ClintContact[] = [];
  for (const { id } of results) {
    try {
      fetched.push(await client.getContact(id));
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        await db.prepare("UPDATE contacts SET fields_json = '{}' WHERE id = ?").bind(id).run();
        continue;
      }
      throw e;
    }
  }
  await batchRun(db, fetched.map((c) => upsertContact(db, c)));
}
