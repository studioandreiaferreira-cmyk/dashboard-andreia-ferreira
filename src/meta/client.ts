// Read-only Meta Marketing API client (token with ads_read only).
const GRAPH = "https://graph.facebook.com/v24.0";

export interface MetaAdAccount {
  id: string;
  name: string;
  account_status: number;
}

export interface MetaInsightRow {
  date_start: string;
  account_id: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

export interface MetaAd {
  id: string;
  name?: string;
  adset_id?: string;
  campaign_id?: string;
  effective_status?: string;
  creative?: { thumbnail_url?: string };
  preview_shareable_link?: string;
}

export class MetaApiError extends Error {
  constructor(public code: number | undefined, message: string) {
    super(`Meta API: ${message}`);
  }
}

/** Leads = the "lead" action only; Meta repeats the same leads under several other action types. */
export function leadsOf(row: Pick<MetaInsightRow, "actions">): number {
  const a = row.actions?.find((x) => x.action_type === "lead") ?? row.actions?.find((x) => x.action_type === "onsite_conversion.lead_grouped");
  return a ? Math.round(Number(a.value)) : 0;
}

/** Value of the first action type found (Meta reports some actions under several names). */
export function actionOf(list: { action_type: string; value: string }[] | undefined, ...types: string[]): number {
  for (const t of types) {
    const a = list?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

/** Pixel purchases and their value (website purchase first, then the generic "purchase"). */
export function purchasesOf(row: Pick<MetaInsightRow, "actions" | "action_values">): { count: number; value: number } {
  const types = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
  return { count: Math.round(actionOf(row.actions, ...types)), value: actionOf(row.action_values, ...types) };
}

export class MetaClient {
  constructor(
    private token: string,
    private onCall: () => void = () => {},
  ) {}

  private async get<T>(url: string): Promise<T> {
    this.onCall();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = (await res.json()) as T & { error?: { code?: number; message?: string } };
    if (!res.ok || body.error) throw new MetaApiError(body.error?.code, body.error?.message ?? `HTTP ${res.status}`);
    return body;
  }

  private async all<T>(first: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = first;
    while (next) {
      const page: { data: T[]; paging?: { next?: string } } = await this.get(next);
      out.push(...(page.data ?? []));
      next = page.paging?.next;
    }
    return out;
  }

  adAccounts(): Promise<MetaAdAccount[]> {
    return this.all(`${GRAPH}/me/adaccounts?fields=id,name,account_status&limit=100`);
  }

  /** Daily ad-level insights between two account-timezone days (inclusive). */
  insights(accountId: string, since: string, until: string): Promise<MetaInsightRow[]> {
    const fields =
      "date_start,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions,action_values";
    const range = encodeURIComponent(JSON.stringify({ since, until }));
    return this.all(`${GRAPH}/${accountId}/insights?level=ad&time_increment=1&time_range=${range}&fields=${fields}&limit=500`);
  }

  /** Ads by id (40 per call) with a 128px thumbnail and the shareable preview link. */
  async adsByIds(ids: string[]): Promise<MetaAd[]> {
    const fields = "id,name,adset_id,campaign_id,effective_status,creative.thumbnail_width(128).thumbnail_height(128){thumbnail_url},preview_shareable_link";
    const out: MetaAd[] = [];
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40).map(encodeURIComponent).join(",");
      const res = await this.get<Record<string, MetaAd>>(`${GRAPH}/?ids=${chunk}&fields=${encodeURIComponent(fields)}`);
      out.push(...Object.values(res));
    }
    return out;
  }
}
