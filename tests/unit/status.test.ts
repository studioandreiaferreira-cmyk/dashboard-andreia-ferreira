import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCampaigns } from "../../src/metrics/campaigns";
import { parseFilters } from "../../src/metrics/filters";
import { getIntake } from "../../src/metrics/intake";
import { getStatusSummary } from "../../src/metrics/status";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

const now = new Date("2026-10-11T15:00:00Z");
const period = "from=2026-09-01&to=2026-10-11";
let mock: ReturnType<typeof mockClint>;

beforeEach(async () => {
  await resetDb();
  mock = mockClint();
  await runIncremental(env, { now });
});
afterEach(() => mock.restore());

describe("status filter", () => {
  it("keeps only the checked statuses", async () => {
    const open = await getIntake(env.DB, parseFilters(new URLSearchParams(`${period}&status=OPEN`), now));
    expect(open.total).toBe(3);
    const closed = await getIntake(env.DB, parseFilters(new URLSearchParams(`${period}&status=WON,LOST`), now));
    expect(closed.total).toBe(2);
    const camp = await getCampaigns(env.DB, parseFilters(new URLSearchParams(`${period}&status=LOST`), now));
    expect(camp.rows.reduce((s, r) => s + r.leads, 0)).toBe(1);
  });

  it("ignores unknown statuses", () => {
    expect(parseFilters(new URLSearchParams("status=open,foo"), now).statuses).toEqual(["OPEN"]);
  });
});

describe("getStatusSummary", () => {
  it("counts deals by status with the loss reasons", async () => {
    const r = await getStatusSummary(env.DB, parseFilters(new URLSearchParams(`${period}&status=OPEN`), now));
    expect(r).toEqual({ open: 3, won: 1, lost: 1, lost_reasons: [{ reason: "Sem dinheiro", count: 1 }] });
  });
});
