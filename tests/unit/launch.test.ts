import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFilters } from "../../src/metrics/filters";
import { getIntake } from "../../src/metrics/intake";
import { getLaunch, phaseOf } from "../../src/metrics/launch";
import { getSales } from "../../src/metrics/sales";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

const now = new Date("2026-10-11T15:00:00Z");
const period = "from=2026-09-01&to=2026-10-11";
let mock: ReturnType<typeof mockClint>;

beforeEach(async () => {
  await resetDb();
  mock = mockClint();
  await runIncremental({ ...env, META_API_TOKEN: "meta-token" }, { now });
});
afterEach(() => mock.restore());

describe("launch view", () => {
  it("counts every lead of the period (status filter ignored), split into traffic and organic", async () => {
    const f = parseFilters(new URLSearchParams(`${period}&status=OPEN`), now);
    const all = await getIntake(env.DB, parseFilters(new URLSearchParams(period), now));
    const l = await getLaunch(env.DB, f);
    expect(l.totals.leads).toBe(all.total);
    expect(l.totals.traffic + l.totals.organic).toBe(l.totals.leads);
    expect(l.days.reduce((s, d) => s + d.leads, 0)).toBe(l.totals.leads);
    expect(l.sources.reduce((s, x) => s + x.n, 0)).toBe(l.totals.leads);
    for (const k of Object.keys(l.utm)) expect(l.utm[k].reduce((s, x) => s + x.n, 0)).toBe(l.totals.leads);
    // Funnel: the stage bars never include lost deals.
    expect(l.funnel.stages.reduce((s, x) => s + x.count, 0)).toBe(l.funnel.total - l.funnel.lost);
  });

  it("ranks creatives by CPL with spend from Meta", async () => {
    const l = await getLaunch(env.DB, parseFilters(new URLSearchParams(period), now));
    expect(l.totals.spend).toBeGreaterThan(0);
    const cpls = l.creatives.filter((c) => c.cpl !== null).map((c) => c.cpl!);
    expect(cpls).toEqual([...cpls].sort((a, b) => a - b));
  });

  it("reads the campaign phase from the name", () => {
    expect(phaseOf("🇧🇷 [LEAD][FORM] - SAO PAULO")).toBe("captacao");
    expect(phaseOf("🎨 [VENDA][ACP#01] - AREOLA COLORS")).toBe("vendas");
    expect(phaseOf("🚀 [TRAFEGO] [PEFIL_IG] AREOLA")).toBe("trafego");
    expect(phaseOf("Post do Instagram")).toBe("outras");
  });
});

describe("sales view", () => {
  it("counts won deals by the day they were won", async () => {
    const s = await getSales(env.DB, parseFilters(new URLSearchParams(period), now));
    expect(s.days.reduce((a, d) => a + d.sales, 0)).toBe(s.totals.sales);
    expect(s.by_origin.reduce((a, g) => a + g.sales, 0)).toBe(s.totals.sales);
  });
});
