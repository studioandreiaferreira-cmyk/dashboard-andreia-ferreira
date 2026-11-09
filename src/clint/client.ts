import type {
  ClintChannelAccount,
  ClintChat,
  ClintContact,
  ClintDeal,
  ClintGroup,
  ClintLostStatus,
  ClintMessage,
  ClintOrigin,
  ClintUser,
  PageV1,
  PageV2,
} from "./types";

const BASE_URL = "https://api.clint.digital";
// Cloudflare in front of the Clint API rejects requests without an explicit User-Agent (research R1).
const USER_AGENT = "af-crm-dashboard/1.0";

export class BudgetExhausted extends Error {
  constructor() {
    super("Subrequest budget exhausted");
  }
}

export class ClintApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    body: string,
  ) {
    super(`Clint API ${status} on ${path}: ${body.slice(0, 200)}`);
  }
}

/** Counts outbound calls and wall time so a sync run stays under the runtime limits. */
export class Budget {
  used = 0;
  /** `deadline`: epoch ms after which no new call is started. */
  constructor(
    public readonly limit = 800,
    public readonly deadline = Number.POSITIVE_INFINITY,
  ) {}
  take() {
    if (this.used >= this.limit || Date.now() > this.deadline) throw new BudgetExhausted();
    this.used++;
  }
}

type Query = Record<string, string | number | undefined | null>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ClintClient {
  constructor(
    private token: string,
    private budget: Budget = new Budget(Number.POSITIVE_INFINITY),
  ) {}

  async get<T>(path: string, query: Query = {}): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    let attempt = 0;
    for (;;) {
      this.budget.take();
      const res = await fetch(url.toString(), {
        headers: { "api-token": this.token, "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (res.ok) return (await res.json()) as T;
      const body = await res.text();
      if (attempt < 3 && res.status === 429) {
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? "5");
        await sleep(Math.min(60, Math.max(1, reset)) * 1000);
      } else if (attempt < 3 && res.status >= 500) {
        await sleep(500 * 2 ** attempt);
      } else {
        throw new ClintApiError(res.status, url.pathname, body);
      }
      attempt++;
    }
  }

  async *pagesV1<T>(path: string, query: Query = {}, limit = 1000, firstPage = 1): AsyncGenerator<T[]> {
    for (let page = firstPage; ; page++) {
      const res = await this.get<PageV1<T>>(path, { ...query, limit, page });
      yield res.data ?? [];
      if (!res.hasNext) return;
    }
  }

  async *pagesV2<T>(path: string, query: Query = {}, limit = 200): AsyncGenerator<T[]> {
    for (let page = 1; ; page++) {
      const res = await this.get<PageV2<T>>(path, { ...query, limit, page });
      yield res.data ?? [];
      if (!res.has_next) return;
    }
  }

  async all<T>(gen: AsyncGenerator<T[]>): Promise<T[]> {
    const out: T[] = [];
    for await (const page of gen) out.push(...page);
    return out;
  }

  listDeals(query: { updated_at_start?: string } = {}, firstPage = 1) {
    return this.pagesV1<ClintDeal>("/v1/deals", query, 1000, firstPage);
  }
  listOrigins() {
    return this.all(this.pagesV1<ClintOrigin>("/v1/origins", {}, 200));
  }
  listGroups() {
    return this.all(this.pagesV1<ClintGroup>("/v1/groups", {}, 200));
  }
  listLostStatuses() {
    return this.all(this.pagesV1<ClintLostStatus>("/v1/lost-status", {}, 200));
  }
  listUsers() {
    return this.all(this.pagesV1<ClintUser>("/v1/users", {}, 200));
  }
  listContacts(firstPage = 1) {
    return this.pagesV1<ClintContact>("/v1/contacts", {}, 1000, firstPage);
  }
  async getContact(id: string) {
    return (await this.get<{ data: ClintContact }>(`/v1/contacts/${id}`)).data;
  }
  listChannelAccounts() {
    return this.all(this.pagesV2<ClintChannelAccount>("/v2/channel-accounts"));
  }
  listChatsByChannel(channelAccountId: string, lastMessageAtStart?: string) {
    return this.pagesV2<ClintChat>(`/v2/chats/channel-account/${channelAccountId}`, { last_message_at_start: lastMessageAtStart });
  }
  listChatsByContact(contactId: string) {
    return this.all(this.pagesV2<ClintChat>(`/v2/chats/contact/${contactId}`));
  }
  listMessagesByChat(chatId: string, limit = 200) {
    return this.pagesV2<ClintMessage>(`/v2/messages/chat/${chatId}`, {}, limit);
  }
  getMessagesPage(chatId: string, page: number, limit = 50) {
    return this.get<PageV2<ClintMessage>>(`/v2/messages/chat/${chatId}`, { page, limit });
  }
}
