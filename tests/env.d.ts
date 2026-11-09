import type { D1Migration } from "cloudflare:test";
import type { Env as AppEnv } from "../src/config";

declare global {
  namespace Cloudflare {
    interface Env extends Omit<AppEnv, "DB"> {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
