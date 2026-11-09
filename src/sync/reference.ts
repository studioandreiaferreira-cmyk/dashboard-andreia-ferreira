import type { Db, Stmt } from "../db/types";
import type { ClintClient } from "../clint/client";
import { batchRun } from "./state";

/** Full refresh of the small reference tables (research R3 step 1). */
export async function syncReference(client: ClintClient, db: Db): Promise<void> {
  const [groups, origins, users, accounts, lostStatuses] = await Promise.all([
    client.listGroups(),
    client.listOrigins(),
    client.listUsers(),
    client.listChannelAccounts(),
    client.listLostStatuses(),
  ]);

  const stmts: Stmt[] = [];
  for (const g of groups) {
    stmts.push(db.prepare("INSERT INTO groups (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(g.id, g.name));
  }
  for (const o of origins) {
    if (o.group) {
      stmts.push(
        db.prepare("INSERT INTO groups (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(o.group.id, o.group.name),
      );
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO origins (id, name, group_id, archived_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, group_id = excluded.group_id, archived_at = excluded.archived_at`,
        )
        .bind(o.id, o.name, o.group?.id ?? null, o.archived_at ?? null),
    );
    for (const s of o.stages ?? []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO stages (id, origin_id, label, "order", type) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET origin_id = excluded.origin_id, label = excluded.label, "order" = excluded."order", type = excluded.type`,
          )
          .bind(s.id, o.id, s.label, s.order ?? null, s.type ?? null),
      );
    }
  }
  stmts.push(db.prepare("UPDATE users SET active = 0"));
  for (const u of users) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || u.email || u.id;
    stmts.push(
      db
        .prepare(
          `INSERT INTO users (id, name, email, active) VALUES (?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, active = 1`,
        )
        .bind(u.id, name, u.email ?? null),
    );
  }
  for (const l of lostStatuses) {
    stmts.push(db.prepare("INSERT INTO lost_statuses (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(l.id, l.name));
  }
  for (const a of accounts) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO channel_accounts (id, name, type, status) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, status = excluded.status`,
        )
        .bind(a.id, a.name, a.type, a.status),
    );
  }
  await batchRun(db, stmts);
}
