import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";
import { getIntake } from "../../src/metrics/intake";
import { NO_CAMPAIGN, parseFilters } from "../../src/metrics/filters";
import { getUtm, getUtmLeads } from "../../src/metrics/utm";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

const now = new Date("2026-10-11T15:00:00Z");
const cfg = getConfig(env);
const SP = "🇧🇷 [LEAD][FORM] - SAO PAULO";
let mock: ReturnType<typeof mockClint>;

beforeEach(async () => {
  await resetDb();
  mock = mockClint();
  await runIncremental(env, { now });
});
afterEach(() => mock.restore());

describe("campaign filter", () => {
  it("keeps only the selected campaigns, including deals without campaign", async () => {
    const q = (s: string) => parseFilters(new URLSearchParams(s), now);
    expect((await getIntake(env.DB, q(`from=2026-09-01&campaigns=${encodeURIComponent(SP)}`))).total).toBe(2);
    expect((await getIntake(env.DB, q(`from=2026-09-01&campaigns=${encodeURIComponent(NO_CAMPAIGN)}`))).total).toBe(3);
    expect((await getIntake(env.DB, q(`from=2026-09-01&campaigns=${encodeURIComponent(`${SP}\n${NO_CAMPAIGN}`)}`))).total).toBe(5);
  });
});

describe("getUtm", () => {
  it("reports CRM performance per campaign", async () => {
    const r = await getUtm(env.DB, cfg, parseFilters(new URLSearchParams("from=2026-09-01"), now), "campaign", now);
    const sp = r.rows.find((x) => x.key === SP)!;
    // d1 (open, c1: seller 13:00 Oct 9, created Oct 5) and d3 (won, c3: messages Oct 7 after Sep 20 creation).
    expect(sp).toMatchObject({ leads: 2, contacted: 2, replied: 2, open: 1, won: 1, lost: 0, stalled: 0 });
    const none = r.rows.find((x) => x.key === NO_CAMPAIGN)!;
    expect(none).toMatchObject({ leads: 3, open: 2, lost: 1, top_lost_reason: "Sem dinheiro" });
    expect(r.series[0].per_day.reduce((a, b) => a + b, 0)).toBe(r.rows[0].leads);
  });

  it("groups by other dimensions", async () => {
    const r = await getUtm(env.DB, cfg, parseFilters(new URLSearchParams("from=2026-09-01"), now), "utm_source", now);
    expect(r.rows.map((x) => [x.key, x.leads])).toEqual([
      [NO_CAMPAIGN, 4],
      ["facebook", 1],
    ]);
  });
});

describe("getUtmLeads", () => {
  it("lists the stalled open deals of a group with contact details", async () => {
    const later = new Date("2026-10-30T15:00:00Z"); // every fixture deal is >7 days without activity by then
    const f = parseFilters(new URLSearchParams("from=2026-09-01&to=2026-10-30"), later);
    const r = await getUtmLeads(env.DB, cfg, f, "campaign", SP, "stalled", later);
    expect(r.items.map((i) => [i.deal_id, i.name, i.phone])).toEqual([["d1", "Maria Teste", "5511999990001"]]);
    expect(r.items[0].days_inactive).toBe(21);
    const none = await getUtmLeads(env.DB, cfg, f, "campaign", NO_CAMPAIGN, "stalled", later);
    expect(none.items.map((i) => i.deal_id).sort()).toEqual(["d2", "d5"]);
  });

  it("lists every lead of the period by kind, with counts", async () => {
    const f = parseFilters(new URLSearchParams("from=2026-09-01&to=2026-10-11"), now);
    const r = await getUtmLeads(env.DB, cfg, f, "campaign", null, "contacted", now);
    // d1, d3 (c1/c3 seller messages after creation); d2/d5 (c2) got a seller message on Oct 8 after creation on Oct 5/6; d4 (c3) too.
    expect(r.counts.all).toBe(5);
    expect(r.counts.contacted + r.counts.not_contacted).toBe(5);
    expect(r.items.every((i) => i.first_contact_hours !== null)).toBe(true);
    expect(r.items.map((i) => i.group)).toContain(SP);
  });
});
