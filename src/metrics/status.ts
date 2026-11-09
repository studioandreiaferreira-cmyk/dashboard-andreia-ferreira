import type { Db } from "../db/types";
import { dealWhere, type Filters } from "./filters";

export const NO_REASON = "Sem motivo informado";

/**
 * Deals created in the period by current status, and the loss reasons of the lost ones.
 * Ignores the status filter so all three numbers are always shown.
 */
export async function getStatusSummary(db: Db, f: Filters) {
  const w = dealWhere({ ...f, statuses: [] }, "d", { period: true, cross: true });
  const counts = await db
    .prepare(`SELECT d.status, COUNT(*) AS n FROM deals d WHERE ${w.sql} GROUP BY 1`)
    .bind(...w.params)
    .all<{ status: string; n: number }>();
  const reasons = await db
    .prepare(
      `SELECT COALESCE(l.name, ?) AS reason, COUNT(*) AS count
       FROM deals d LEFT JOIN lost_statuses l ON l.id = d.lost_status_id
       WHERE d.status = 'LOST' AND ${w.sql}
       GROUP BY 1 ORDER BY count DESC`,
    )
    .bind(NO_REASON, ...w.params)
    .all<{ reason: string; count: number }>();
  const by = Object.fromEntries(counts.results.map((r) => [r.status, r.n]));
  return { open: by.OPEN ?? 0, won: by.WON ?? 0, lost: by.LOST ?? 0, lost_reasons: reasons.results };
}
