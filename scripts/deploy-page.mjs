// Builds the page with the data URLs from .env and publishes it to the client's Cloudflare
// (static assets only). Usage: node scripts/deploy-page.mjs [--dry-run]
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);
for (const k of ["DASH_SLUG", "SNAPSHOT_KEY", "SUPABASE_URL", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
  if (!env[k]) throw new Error(`${k} missing in .env`);
}
const buildEnv = {
  ...process.env,
  DASH_SLUG: env.DASH_SLUG,
  VITE_SNAPSHOT_URL: `${env.SUPABASE_URL}/storage/v1/object/public/dash/${env.SNAPSHOT_KEY}.json`,
  VITE_CHAT_URL: `${env.SUPABASE_URL}/functions/v1/chat`,
  VITE_DASH_KEY: env.SNAPSHOT_KEY,
};
rmSync("web/dist", { recursive: true, force: true });
execSync("npx vite build", { stdio: "inherit", env: buildEnv });
if (!process.argv.includes("--dry-run")) {
  execSync("npx wrangler deploy", {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID },
  });
}
