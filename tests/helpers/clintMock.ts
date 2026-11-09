import { vi } from "vitest";
import channelAccounts from "../fixtures/clint/channel-accounts.json";
import chats from "../fixtures/clint/chats.json";
import contacts from "../fixtures/clint/contacts.json";
import deals from "../fixtures/clint/deals.json";
import groups from "../fixtures/clint/groups.json";
import lostStatus from "../fixtures/clint/lost-status.json";
import metaAccounts from "../fixtures/clint/meta-adaccounts.json";
import metaInsightsP1 from "../fixtures/clint/meta-insights-p1.json";
import metaInsightsP2 from "../fixtures/clint/meta-insights-p2.json";
import messages from "../fixtures/clint/messages.json";
import origins from "../fixtures/clint/origins.json";
import users from "../fixtures/clint/users.json";

export const fixtures = { channelAccounts, chats, contacts, deals, groups, messages, origins, users };

export interface MockOptions {
  /** Number of initial calls answered with 429 before normal responses. */
  rateLimitFirst?: number;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Replaces global fetch with a fake Clint API backed by the fixtures. Returns the list of requested URLs. */
export function mockClint(opts: MockOptions = {}) {
  const calls: string[] = [];
  let limited = opts.rateLimitFirst ?? 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname + url.search);
    if (limited > 0) {
      limited--;
      return json({ status: 429 }, 429, { "x-ratelimit-reset": "0" });
    }
    const p = url.pathname;
    if (url.hostname === "graph.facebook.com") {
      if (p.endsWith("/me/adaccounts")) return json(metaAccounts);
      if (p.endsWith("/act_1/insights")) return json(url.searchParams.get("page") === "2" ? metaInsightsP2 : metaInsightsP1);
      if (p === "/v24.0/" && url.searchParams.get("ids"))
        return json(Object.fromEntries(url.searchParams.get("ids")!.split(",").map((id) => [id, { id, name: `Anúncio ${id}`, creative: { thumbnail_url: "https://example.com/t.jpg" } }])));
      if (p.endsWith("/act_1/ads"))
        return json({ data: [{ id: "ad1", name: "Anúncio 1", adset_id: "as1", campaign_id: "c1", creative: { thumbnail_url: "https://example.com/t.jpg" }, preview_shareable_link: "https://fb.me/x" }] });
      return json({ error: { code: 100, message: `no fixture for ${p}` } }, 400);
    }
    if (p === "/v1/groups") return json(groups);
    if (p === "/v1/origins") return json(origins);
    if (p === "/v1/users") return json(users);
    if (p === "/v1/lost-status") return json(lostStatus);
    if (p === "/v1/deals") return json(deals);
    if (p === "/v1/contacts") return json(contacts);
    if (p.startsWith("/v1/contacts/")) {
      const c = contacts.data.find((x) => x.id === p.split("/")[3]);
      return c ? json({ status: 200, data: c }) : json({ status: 404 }, 404);
    }
    if (p === "/v2/channel-accounts") return json(channelAccounts);
    if (p.startsWith("/v2/chats/channel-account/")) return json(chats);
    if (p.startsWith("/v2/chats/contact/")) {
      const id = p.split("/")[4];
      const data = chats.data.filter((c) => c.contact_id === id);
      return json({ ...chats, data, total_count: data.length });
    }
    if (p.startsWith("/v2/messages/chat/")) {
      const id = p.split("/")[4] as keyof typeof messages;
      return json(messages[id] ?? { status: 200, data: [], total_count: 0, page: 1, total_pages: 1, has_next: false });
    }
    return json({ status: 404, message: `no fixture for ${p}` }, 404);
  });
  return { calls, restore: () => spy.mockRestore() };
}
