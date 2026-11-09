import type { Db } from "./db/types";

export interface Env {
  DB: Db;
  ASSETS?: Fetcher;
  CLINT_API_TOKEN: string;
  /** Meta Marketing API token (ads_read only); optional — without it the ads data is skipped */
  META_API_TOKEN?: string;
  BUSINESS_HOURS: string;
  NO_REPLY_MINUTES: string;
  MESSAGE_WINDOW_DAYS: string;
  PROFILE_FIELDS: string;
  CLINT_DEAL_URL_TEMPLATE?: string;
  CLINT_CHAT_URL_TEMPLATE?: string;
}

export interface BusinessHours {
  /** ISO weekdays: 1 = Monday … 7 = Sunday */
  days: number[];
  start: string;
  end: string;
  tz: string;
}

export interface ProfileField {
  key: string;
  label: string;
  entity: "deal" | "contact";
}

export interface Config {
  businessHours: BusinessHours;
  noReplyMinutes: number;
  messageWindowDays: number;
  profileFields: ProfileField[];
  dealUrlTemplate: string;
  chatUrlTemplate: string;
}

function parseJson<T>(name: string, raw: string | undefined, fallback: T): T {
  if (raw === undefined || raw.trim() === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON in variable ${name}`);
  }
}

function parseNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number in variable ${name}`);
  return n;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
  tz: "America/Sao_Paulo",
};

export function getConfig(env: Env): Config {
  return {
    businessHours: { ...DEFAULT_BUSINESS_HOURS, ...parseJson("BUSINESS_HOURS", env.BUSINESS_HOURS, {}) },
    noReplyMinutes: parseNumber("NO_REPLY_MINUTES", env.NO_REPLY_MINUTES, 60),
    messageWindowDays: parseNumber("MESSAGE_WINDOW_DAYS", env.MESSAGE_WINDOW_DAYS, 90),
    profileFields: parseJson<ProfileField[]>("PROFILE_FIELDS", env.PROFILE_FIELDS, []),
    dealUrlTemplate: env.CLINT_DEAL_URL_TEMPLATE ?? "",
    chatUrlTemplate: env.CLINT_CHAT_URL_TEMPLATE ?? "",
  };
}

/** Fills {deal_id}, {contact_id}, {chat_id}; returns null when no template is configured. */
export function clintUrl(cfg: Config, ids: { deal_id?: string | null; contact_id?: string | null; chat_id?: string | null }): string | null {
  const tpl = ids.chat_id && cfg.chatUrlTemplate ? cfg.chatUrlTemplate : cfg.dealUrlTemplate;
  if (!tpl) return null;
  return tpl
    .replaceAll("{deal_id}", ids.deal_id ?? "")
    .replaceAll("{contact_id}", ids.contact_id ?? "")
    .replaceAll("{chat_id}", ids.chat_id ?? "");
}
