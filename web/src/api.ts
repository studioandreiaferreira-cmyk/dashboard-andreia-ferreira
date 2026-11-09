import type { ClintClient } from "../../src/clint/client";
import type { Env } from "../../src/config";
import { route } from "../../src/routes";
import type { Snapshot } from "../../src/snapshot";
import { openSnapshot } from "./db";

export interface Meta {
  last_sync_at: string | null;
  sync_ok: boolean;
  last_error: string | null;
  message_window_start: string;
  message_window_truncated: boolean;
}

// Build-time settings (.env.production / scripts/deploy-page.mjs): where the data file and the
// live chat proxy are. The key is the secret part of the link, the same for both.
const SNAPSHOT_URL = import.meta.env.VITE_SNAPSHOT_URL as string;
const CHAT_URL = import.meta.env.VITE_CHAT_URL as string;
const DASH_KEY = import.meta.env.VITE_DASH_KEY as string;

interface Loaded {
  env: Env;
  clint: ClintClient;
  generatedAt: string;
}

async function chatProxy<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch(`${CHAT_URL}?${new URLSearchParams(params)}`, { headers: { "x-dash-key": DASH_KEY } });
  if (!res.ok) throw new Error(`Erro ${res.status} ao ler a conversa na Clint`);
  return res.json() as Promise<T>;
}

/** Only the two live calls the chat viewer makes go to the network (Edge Function `chat`). */
const clint = {
  listChatsByContact: (contactId: string) => chatProxy({ contact: contactId }),
  getMessagesPage: (chatId: string, page: number) => chatProxy({ chat: chatId, page: String(page) }),
} as unknown as ClintClient;

async function load(): Promise<Loaded> {
  // Supabase's CDN keeps serving an overwritten file for a while, so the URL changes every minute.
  const res = await fetch(`${SNAPSHOT_URL}?t=${Math.floor(Date.now() / 60_000)}`);
  if (!res.ok) throw new Error(`Erro ${res.status} ao baixar os dados do dash`);
  const snapshot = (await res.json()) as Snapshot;
  const DB = await openSnapshot(snapshot);
  return { env: { DB, CLINT_API_TOKEN: "", ...snapshot.config }, clint, generatedAt: snapshot.generated_at };
}

let current: Promise<Loaded> = load();

/** Downloads the data file again (button "Atualizar" and every 10 minutes); views refetch after it. */
export function reloadData() {
  const next = load();
  next.then(
    () => {
      current = next;
      window.dispatchEvent(new Event("af:refresh"));
    },
    () => {},
  );
  return next;
}

export async function dataInfo(): Promise<{ generatedAt: string }> {
  return current;
}

export async function api<T>(path: string, params?: URLSearchParams | Record<string, string>): Promise<T> {
  const { env, clint: c } = await current;
  const q = params instanceof URLSearchParams ? params : new URLSearchParams(params ?? {});
  return (await route(env, c, path, q)) as T;
}
