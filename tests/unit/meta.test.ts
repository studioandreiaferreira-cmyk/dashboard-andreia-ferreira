import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, type Env } from "../../src/config";
import { leadsOf } from "../../src/meta/client";
import { parseFilters } from "../../src/metrics/filters";
import { getUtm } from "../../src/metrics/utm";
import { syncMeta } from "../../src/sync/meta";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

const now = new Date("2026-10-11T15:00:00Z");
const withMeta: Env = { ...env, META_API_TOKEN: "test-meta-token" };
let mock: ReturnType<typeof mockClint>;

beforeEach(async () => {
  await resetDb();
  mock = mockClint();
});
afterEach(() => mock.restore());

describe("Meta Ads sync", () => {
  it("counts only the lead action (Meta repeats it under other types)", () => {
    expect(leadsOf({ actions: [{ action_type: "lead", value: "270" }, { action_type: "onsite_conversion.lead_grouped", value: "270" }] })).toBe(270);
    expect(leadsOf({ actions: [{ action_type: "onsite_conversion.lead_grouped", value: "5" }] })).toBe(5);
    expect(leadsOf({})).toBe(0);
  });

  it("stores daily ad insights of active accounts, following pagination, at most hourly", async () => {
    expect(await syncMeta(withMeta, now)).toBe("ok");
    const rows = await env.DB.prepare("SELECT ad_id, date, spend, leads FROM meta_insights ORDER BY date, ad_id").all();
    expect(rows.results).toEqual([
      { ad_id: "ad1", date: "2026-10-05", spend: 100.5, leads: 3 },
      { ad_id: "ad1", date: "2026-10-06", spend: 49.5, leads: 1 },
      { ad_id: "ad9", date: "2026-10-06", spend: 30, leads: 0 },
    ]);
    expect(mock.calls.some((c) => c.includes("act_2"))).toBe(false); // inactive account skipped
    expect(await syncMeta(withMeta, new Date(now.getTime() + 10 * 60_000))).toBe("skipped");
    expect(await syncMeta(withMeta, new Date(now.getTime() + 61 * 60_000))).toBe("ok");
  });

  it("is skipped without a token and records errors without throwing", async () => {
    expect(await syncMeta({ ...env, META_API_TOKEN: "" }, now)).toBe("skipped");
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 190, message: "Invalid token" } }), { status: 400 })) as typeof fetch;
    expect(await syncMeta(withMeta, now)).toBe("error");
    const err = await env.DB.prepare("SELECT value FROM sync_state WHERE key = 'meta_last_error'").first<{ value: string }>();
    expect(JSON.parse(err!.value).message).toContain("Invalid token");
  });
});

describe("UTM with Meta Ads", () => {
  it("joins spend and Meta leads to campaigns by id and keeps campaigns without CRM leads", async () => {
    await runIncremental(env, { now });
    await syncMeta(withMeta, now);
    const r = await getUtm(env.DB, getConfig(env), parseFilters(new URLSearchParams("from=2026-09-01&to=2026-10-11&status=OPEN"), now), "campaign", now);
    expect(r.ads_available).toBe(true);
    const sp = r.rows.find((x) => x.key === "🇧🇷 [LEAD][FORM] - SAO PAULO")!;
    // Status filter OPEN keeps 1 lead in the table, but costs use both CRM leads (d1 open + d3 won).
    expect(sp.leads).toBe(1);
    expect(sp.ads).toEqual({ spend: 150, meta_leads: 4, impressions: 7000, clicks: 160, crm_leads: 2, crm_won: 1 });
    const traffic = r.rows.find((x) => x.key === "Tráfego perfil")!;
    expect(traffic).toMatchObject({ leads: 0, ads: { spend: 30, meta_leads: 0 } });
  });

  it("has no ads columns for form and utm dimensions", async () => {
    await runIncremental(env, { now });
    await syncMeta(withMeta, now);
    const r = await getUtm(env.DB, getConfig(env), parseFilters(new URLSearchParams("from=2026-09-01"), now), "form", now);
    expect(r.ads_available).toBe(false);
  });
});
