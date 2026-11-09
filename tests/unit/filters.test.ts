import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";
import { buildMeta, dealWhere, parseFilters } from "../../src/metrics/filters";

const now = new Date("2026-10-11T15:00:00Z");

describe("filters", () => {
  it("defaults to the last 30 days in São Paulo", () => {
    const f = parseFilters(new URLSearchParams(), now);
    expect(f.from).toBe("2026-09-12");
    expect(f.to).toBe("2026-10-11");
  });

  it("expands groups to their origins and ORs them with origins", () => {
    const f = parseFilters(new URLSearchParams("origin_ids=o1&group_ids=g1,g2"), now);
    const w = dealWhere(f);
    expect(w.sql).toContain("d.origin_id IN (?) OR d.origin_id IN (SELECT id FROM origins WHERE group_id IN (?,?))");
    expect(w.params).toEqual(["o1", "g1", "g2"]);
  });

  it("maps user_ids=none to deals without owner", () => {
    const w = dealWhere(parseFilters(new URLSearchParams("user_ids=u1,none"), now));
    expect(w.sql).toContain("(d.user_id IN (?) OR d.user_id IS NULL)");
    expect(w.params).toEqual(["u1"]);
  });

  it("flags periods older than the message window", async () => {
    const cfg = getConfig(env);
    const old = await buildMeta(env.DB, cfg, parseFilters(new URLSearchParams("from=2026-06-01"), now), now);
    expect(old.message_window_truncated).toBe(true);
    const recent = await buildMeta(env.DB, cfg, parseFilters(new URLSearchParams(), now), now);
    expect(recent.message_window_truncated).toBe(false);
    expect(recent.sync_ok).toBe(false); // never synced
  });
});
