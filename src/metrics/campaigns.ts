import type { Db } from "../db/types";
import { dealWhere, NO_CAMPAIGN, type Filters } from "./filters";

const COLUMNS = { campaign: "campaign_name", ad: "ad_name", form: "form_name" } as const;
export type CampaignLevel = keyof typeof COLUMNS;

/** Leads per campaign / ad / form with open, won and lost counts (FR-016..019). */
export async function getCampaigns(db: Db, f: Filters, level: CampaignLevel = "campaign") {
  const col = COLUMNS[level] ?? COLUMNS.campaign;
  const w = dealWhere(f, "d", { period: true, cross: true });
  const { results } = await db
    .prepare(
      `SELECT COALESCE(d.${col}, ?) AS key, COUNT(*) AS leads,
              SUM(d.status = 'OPEN') AS open, SUM(d.status = 'WON') AS won, SUM(d.status = 'LOST') AS lost
       FROM deals d WHERE ${w.sql}
       GROUP BY 1 ORDER BY leads DESC`,
    )
    .bind(NO_CAMPAIGN, ...w.params)
    .all<{ key: string; leads: number; open: number; won: number; lost: number }>();
  return { level, rows: results };
}
