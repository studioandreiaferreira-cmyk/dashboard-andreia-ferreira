import { getConfig, type Env } from "./config";
import { buildSnapshotText, type SnapshotConfig } from "./snapshot";
import { runIncremental, runNightly } from "./sync/run";

export type JobMode = "incremental" | "nightly";

function snapshotConfig(env: Env): SnapshotConfig {
  return {
    BUSINESS_HOURS: env.BUSINESS_HOURS,
    NO_REPLY_MINUTES: env.NO_REPLY_MINUTES,
    MESSAGE_WINDOW_DAYS: env.MESSAGE_WINDOW_DAYS,
    PROFILE_FIELDS: env.PROFILE_FIELDS,
    CLINT_DEAL_URL_TEMPLATE: env.CLINT_DEAL_URL_TEMPLATE ?? "",
    CLINT_CHAT_URL_TEMPLATE: env.CLINT_CHAT_URL_TEMPLATE ?? "",
  };
}

/** One scheduled sync on Supabase (incremental every 30 min; nightly reconcile in slices). */
export async function runSyncJob(env: Env, mode: JobMode, deadline: number, now = new Date()) {
  return mode === "nightly" ? { nightlyDone: await runNightly(env, { now, deadline }) } : await runIncremental(env, { now, deadline });
}

/** Dashboard snapshot as JSON text (built inside Postgres). */
export function snapshotText(env: Env): Promise<string> {
  return buildSnapshotText(env.DB, snapshotConfig(env), getConfig(env).profileFields);
}

/** Uploads the snapshot to the public `dash` bucket (overwrites); short CDN cache. */
export async function uploadSnapshot(supabaseUrl: string, serviceKey: string, objectName: string, body: string): Promise<number> {
  const bytes = new TextEncoder().encode(body);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/dash/${objectName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        "x-upsert": "true",
        "cache-control": "max-age=60",
      },
      body: bytes,
    });
    if (res.ok) return bytes.length;
    const text = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
    // Storage occasionally answers 502/503 under load: retry a couple of times.
    if (attempt >= 3 || res.status < 500) throw new Error(`Storage upload ${res.status}: ${text}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}
