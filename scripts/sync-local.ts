// Runs one sync job from this machine against the Supabase Postgres (initial load / debugging).
// Usage: node scripts/build-functions.mjs --local && node .build/sync-local.mjs [incremental|nightly] [--upload]
import { writeFileSync } from "node:fs";
import { pgDb } from "../src/db/postgres";
import { runSyncJob, snapshotText, uploadSnapshot } from "../src/job";
import type { Env } from "../src/config";

const mode = (process.argv[2] ?? "incremental") as "incremental" | "nightly";
const e = process.env;
const { db, end } = pgDb(e.SUPABASE_DB_URL!);
const env: Env = {
  DB: db,
  CLINT_API_TOKEN: e.CLINT_API_TOKEN!,
  META_API_TOKEN: e.META_API_TOKEN,
  BUSINESS_HOURS: e.BUSINESS_HOURS ?? "",
  NO_REPLY_MINUTES: e.NO_REPLY_MINUTES ?? "",
  MESSAGE_WINDOW_DAYS: e.MESSAGE_WINDOW_DAYS ?? "",
  PROFILE_FIELDS: e.PROFILE_FIELDS ?? "",
};
const t0 = Date.now();
const cpu0 = process.cpuUsage();
const cpuMs = () => {
  const c = process.cpuUsage(cpu0);
  return Math.round((c.user + c.system) / 1000);
};
try {
  const sync = process.argv.includes("--no-sync") ? null : await runSyncJob(env, mode, Date.now() + 110_000);
  const t1 = Date.now();
  const c1 = cpuMs();
  const json = await snapshotText(env);
  writeFileSync(".build/snapshot.json", json);
  console.log(JSON.stringify({ sync, sync_ms: t1 - t0, sync_cpu_ms: c1, snapshot_ms: Date.now() - t1, snapshot_cpu_ms: cpuMs() - c1, bytes: json.length }));
  if (process.argv.includes("--upload")) console.log("uploaded", await uploadSnapshot(e.SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, `${e.SNAPSHOT_KEY}.json`, json));
} finally {
  await end();
}
