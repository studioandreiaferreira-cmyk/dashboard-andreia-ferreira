import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./tests/wrangler.test.toml" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, CLINT_API_TOKEN: "test-token", DASH_PASSWORD: "" },
        },
      }),
    ],
    test: { setupFiles: ["./tests/apply-migrations.ts"], include: ["tests/**/*.test.ts"] },
  };
});
