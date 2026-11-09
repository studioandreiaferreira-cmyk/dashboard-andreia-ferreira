import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";
import { parseFilters } from "../../src/metrics/filters";
import { getNoReply, recomputeReplyState } from "../../src/metrics/noReply";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

// Fixtures: ch1 (c1, open deal) USER 13:00/13:05Z → CUSTOMER 13:10/13:12Z → EVENT → CUSTOMER reaction.
// ch2 (c2, open deals) CUSTOMER then USER. ch3 (c3, only WON/LOST deals) USER then CUSTOMER.
const syncNow = new Date("2026-10-11T15:00:00Z");
const cfg = getConfig(env);
const all = parseFilters(new URLSearchParams(), syncNow);
let mock: ReturnType<typeof mockClint>;

beforeEach(async () => {
  await resetDb();
  mock = mockClint();
  await runIncremental(env, { now: syncNow });
});
afterEach(() => mock.restore());

const state = async (chat: string) =>
  env.DB.prepare("SELECT awaiting_since, has_open_deal FROM chat_reply_state WHERE chat_id = ?").bind(chat).first<{ awaiting_since: string | null; has_open_deal: number }>();

describe("reply state", () => {
  it("waits since the first lead message after the last seller message, ignoring events and reactions", async () => {
    expect(await state("ch1")).toEqual({ awaiting_since: "2026-10-09T13:10:00Z", has_open_deal: 1 });
  });

  it("is not waiting when the seller spoke last", async () => {
    expect((await state("ch2"))?.awaiting_since).toBeNull();
  });

  it("ignores a lead reaction after a seller message", async () => {
    await env.DB.prepare(
      "INSERT INTO messages (id, chat_id, type, content_type, attribution, created_at, created_day_sp) VALUES ('r1','ch2','CUSTOMER','REACTION','none','2026-10-08T12:40:00Z','2026-10-08')",
    ).run();
    await recomputeReplyState(env.DB);
    expect((await state("ch2"))?.awaiting_since).toBeNull();
  });
});

describe("getNoReply", () => {
  it("lists only contacts with an open deal, beyond 1 business hour", async () => {
    // Fri 2026-10-09 10:20 São Paulo: ch1 waits only 10 min.
    expect((await getNoReply(env.DB, cfg, all, new Date("2026-10-09T13:20:00Z"))).total).toBe(0);

    // Mon 2026-10-12 12:00 SP: Fri 10:10→18:00 (470) + Mon 09:00→12:00 (180) = 650 business minutes.
    const r = await getNoReply(env.DB, cfg, all, new Date("2026-10-12T15:00:00Z"));
    expect(r.items.map((i) => i.chat_id)).toEqual(["ch1"]); // ch3's contact has only WON/LOST deals
    expect(r.items[0]).toMatchObject({ contact_name: "Maria Teste", responsible: "Carina Pimentel", origin: "Aréola Flowers", business_minutes_waiting: 650 });
  });

  it("includes a contact again when a deal is reopened, sorted by longest wait", async () => {
    await env.DB.prepare("UPDATE deals SET status = 'OPEN' WHERE id = 'd3'").run();
    await recomputeReplyState(env.DB);
    const r = await getNoReply(env.DB, cfg, all, new Date("2026-10-12T15:00:00Z"));
    expect(r.items.map((i) => i.chat_id)).toEqual(["ch3", "ch1"]);
  });

  it("respects origin and seller filters", async () => {
    const at = new Date("2026-10-12T15:00:00Z");
    expect((await getNoReply(env.DB, cfg, parseFilters(new URLSearchParams("origin_ids=o2"), at), at)).total).toBe(0);
    expect((await getNoReply(env.DB, cfg, parseFilters(new URLSearchParams("user_ids=u2"), at), at)).total).toBe(0);
    expect((await getNoReply(env.DB, cfg, parseFilters(new URLSearchParams("user_ids=u1"), at), at)).total).toBe(1);
  });
});
