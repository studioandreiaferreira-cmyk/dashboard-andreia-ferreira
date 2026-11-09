/// <reference path="./deno.d.ts" />
// Supabase Edge Function `sync`, called by pg_cron (supabase/migrations/*_cron.sql).
// ?mode=incremental|nightly runs the Clint/Meta sync, then calls itself with ?step=snapshot so the
// snapshot build gets its own CPU budget. Every call must carry the x-cron-key header.
import type { Env } from "../src/config";
import { pgDb } from "../src/db/postgres";
import { runSyncJob, snapshotText, uploadSnapshot, type JobMode } from "../src/job";

const env = (name: string) => Deno.env.get(name) ?? "";
// Free plan: 150 s wall clock per request. Leave room for the snapshot call and the response.
const SYNC_SECONDS = 100;

Deno.serve(async (req) => {
  if (!env("CRON_KEY") || req.headers.get("x-cron-key") !== env("CRON_KEY")) return new Response("forbidden", { status: 403 });
  const url = new URL(req.url);
  const step = url.searchParams.get("step") === "snapshot" ? "snapshot" : "sync";
  const mode: JobMode = url.searchParams.get("mode") === "nightly" ? "nightly" : "incremental";
  const { db, end } = pgDb(env("SUPABASE_DB_URL"));
  const appEnv: Env = {
    DB: db,
    CLINT_API_TOKEN: env("CLINT_API_TOKEN"),
    META_API_TOKEN: env("META_API_TOKEN") || undefined,
    BUSINESS_HOURS: env("BUSINESS_HOURS"),
    NO_REPLY_MINUTES: env("NO_REPLY_MINUTES"),
    MESSAGE_WINDOW_DAYS: env("MESSAGE_WINDOW_DAYS"),
    PROFILE_FIELDS: env("PROFILE_FIELDS"),
    CLINT_DEAL_URL_TEMPLATE: env("CLINT_DEAL_URL_TEMPLATE"),
    CLINT_CHAT_URL_TEMPLATE: env("CLINT_CHAT_URL_TEMPLATE"),
  };
  const started = Date.now();
  try {
    if (step === "snapshot") {
      const json = await snapshotText(appEnv);
      const bytes = await uploadSnapshot(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), `${env("SNAPSHOT_KEY")}.json`, json);
      return Response.json({ step, bytes, ms: Date.now() - started });
    }
    const sync = await runSyncJob(appEnv, mode, started + SYNC_SECONDS * 1000);
    await end();
    const snap = await fetch(`${env("SUPABASE_URL")}/functions/v1/sync?step=snapshot`, { method: "POST", headers: { "x-cron-key": env("CRON_KEY") } });
    return Response.json({ step, mode, sync, ms: Date.now() - started, snapshot: snap.ok ? await snap.json() : `${snap.status} ${await snap.text()}` });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    await end().catch(() => {});
  }
});
