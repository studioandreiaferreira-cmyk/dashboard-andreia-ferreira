import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";
import { getConversations } from "../../src/metrics/conversations";
import { parseFilters } from "../../src/metrics/filters";
import { getStalled } from "../../src/metrics/stalled";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

const now = new Date("2026-10-11T15:00:00Z");
const cfg = getConfig(env);
let mock: ReturnType<typeof mockClint>;

beforeEach(async () => {
  await resetDb();
  mock = mockClint();
  await runIncremental(env, { now });
});
afterEach(() => mock.restore());

describe("getConversations", () => {
  it("counts distinct chats per day with seller and lead messages, ignoring reactions", async () => {
    const r = await getConversations(env.DB, cfg, parseFilters(new URLSearchParams("from=2026-10-07&to=2026-10-09"), now), now);
    expect(r.days).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    // Oct 7: ch3 (seller + lead); Oct 8: ch2 (seller + lead); Oct 9: ch1 (seller + lead).
    expect(r.seller_per_day).toEqual([1, 1, 1]);
    expect(r.lead_per_day).toEqual([1, 1, 1]);
    expect(r.total_seller_chats).toBe(3);
  });

  it("applies the origin filter through the contact's deals", async () => {
    const r = await getConversations(env.DB, cfg, parseFilters(new URLSearchParams("from=2026-10-07&to=2026-10-09&origin_ids=o2"), now), now);
    expect(r.seller_per_day).toEqual([0, 1, 0]); // only c2 has deals in o2
  });
});

describe("stalled histogram", () => {
  it("counts open deals per exact days without activity", async () => {
    const r = await getStalled(env.DB, cfg, parseFilters(new URLSearchParams(), now), now);
    // d1: 2 days (message Oct 9); d2 and d5: 3 days (message Oct 8).
    expect(r.histogram).toEqual([
      { days: 2, count: 1 },
      { days: 3, count: 2 },
    ]);
  });
});
