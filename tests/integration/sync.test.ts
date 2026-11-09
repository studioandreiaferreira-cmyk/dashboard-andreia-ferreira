import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/config";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

const now = new Date("2026-10-11T15:00:00Z");
const e: Env = env;
let mock: ReturnType<typeof mockClint>;
beforeEach(resetDb);
afterEach(() => mock?.restore());

describe("sync", () => {
  it("mirrors deals, contacts, chats and message metadata", async () => {
    mock = mockClint();
    const r = await runIncremental(e, { now });
    expect(r.complete).toBe(true);

    const d1 = await e.DB.prepare("SELECT * FROM deals WHERE id = 'd1'").first<Record<string, string>>();
    expect(d1?.campaign_name).toBe("🇧🇷 [LEAD][FORM] - SAO PAULO");
    expect(d1?.form_name).toBe("AREOLA FLOWER | PT");
    expect(d1?.utm_source).toBe("facebook");
    expect(d1?.created_day_sp).toBe("2026-10-04"); // 02:30 UTC is still the previous day in São Paulo

    const c1 = await e.DB.prepare("SELECT fields_json FROM contacts WHERE id = 'c1'").first<{ fields_json: string }>();
    expect(JSON.parse(c1!.fields_json).role).toBe("Esteticista");

    const att = await e.DB.prepare("SELECT id, attribution, attributed_user_id FROM messages WHERE type = 'USER' ORDER BY id").all();
    expect(att.results).toEqual([
      { id: "m1", attribution: "direct", attributed_user_id: "u1" },
      { id: "m2", attribution: "chat", attributed_user_id: "u1" },
      { id: "n2", attribution: "deal", attributed_user_id: "u2" },
      { id: "p0", attribution: "none", attributed_user_id: null },
    ]);
    const reaction = await e.DB.prepare("SELECT content_type FROM messages WHERE id = 'm6'").first<{ content_type: string }>();
    expect(reaction?.content_type).toBe("REACTION");

    const last = await e.DB.prepare("SELECT value FROM sync_state WHERE key = 'last_success_at'").first<{ value: string }>();
    expect(last?.value).toBe(now.toISOString());
  });

  it("is idempotent", async () => {
    mock = mockClint();
    await runIncremental(e, { now });
    await runIncremental(e, { now });
    const n = await e.DB.prepare("SELECT (SELECT COUNT(*) FROM deals) AS deals, (SELECT COUNT(*) FROM messages) AS msgs").first();
    expect(n).toEqual({ deals: 5, msgs: 10 });
  });

  it("retries after a 429", async () => {
    mock = mockClint({ rateLimitFirst: 1 });
    const r = await runIncremental(e, { now });
    expect(r.complete).toBe(true);
    expect(mock.calls.length).toBeGreaterThan(1);
  });

  it("stops at the subrequest budget and resumes on the next run", async () => {
    mock = mockClint();
    const first = await runIncremental(e, { now, budget: 9 });
    expect(first.complete).toBe(false);
    const second = await runIncremental(e, { now });
    expect(second.complete).toBe(true);
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM messages").first<{ n: number }>();
    expect(n?.n).toBe(10);
  });
});
