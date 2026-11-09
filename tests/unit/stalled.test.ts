import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";
import { parseFilters } from "../../src/metrics/filters";
import { getStalled } from "../../src/metrics/stalled";
import { runIncremental } from "../../src/sync/run";
import { mockClint } from "../helpers/clintMock";
import { resetDb } from "../helpers/db";

const now = new Date("2026-10-11T15:00:00Z");
const cfg = getConfig(env);
const f = parseFilters(new URLSearchParams(), now);
let mock: ReturnType<typeof mockClint>;

async function addOpenDeal(id: string, stageAt: string) {
  await env.DB.prepare(
    `INSERT INTO deals (id, origin_id, status, created_at, created_day_sp, updated_at, updated_stage_at, contact_id)
     VALUES (?, 'o1', 'OPEN', ?, '2026-09-01', ?, ?, ?)`,
  )
    .bind(id, stageAt, stageAt, stageAt, `no-chat-${id}`)
    .run();
}

beforeEach(async () => {
  await resetDb();
  mock = mockClint();
  await runIncremental(env, { now });
});
afterEach(() => mock.restore());

describe("getStalled", () => {
  it("reports days without activity and days in stage", async () => {
    const r = await getStalled(env.DB, cfg, f, now);
    const d1 = r.items.find((i) => i.deal_id === "d1");
    // 10 days in stage (Oct 1) but a message 2 days ago (Oct 9).
    expect(d1).toMatchObject({ days_in_stage: 10, days_inactive: 2, stage: "AGENDAMENTO", contact_name: "Maria Teste" });
  });

  it("excludes won and lost deals", async () => {
    const r = await getStalled(env.DB, cfg, f, now);
    expect(r.total).toBe(3);
    expect(r.items.map((i) => i.deal_id).sort()).toEqual(["d1", "d2", "d5"]);
  });

  it("uses the stage date when the contact has no chats, and buckets the boundaries", async () => {
    await addOpenDeal("x4", "2026-10-07T15:00:00Z");
    await addOpenDeal("x30", "2026-09-11T15:00:00Z");
    await addOpenDeal("x31", "2026-09-10T15:00:00Z");
    const r = await getStalled(env.DB, cfg, f, now);
    const days = Object.fromEntries(r.items.map((i) => [i.deal_id, [i.days_inactive, i.days_in_stage]]));
    expect(days.x4).toEqual([4, 4]);
    expect(days.x30).toEqual([30, 30]);
    expect(days.x31).toEqual([31, 31]);
    expect(r.buckets).toEqual([
      { label: "0–3", count: 3 },
      { label: "4–7", count: 1 },
      { label: "8–15", count: 0 },
      { label: "16–30", count: 1 },
      { label: "30+", count: 1 },
    ]);
    expect(r.items[0].deal_id).toBe("x31");
  });

  it("sorts by days in stage on request", async () => {
    const r = await getStalled(env.DB, cfg, f, now, { sort: "stage" });
    expect(r.items[0].deal_id).toBe("d1");
  });
});
