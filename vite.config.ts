import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// DASH_SLUG (secret part of the link) decides where the page is served: /<slug>/.
// scripts/deploy-page.mjs sets it together with the VITE_* data URLs.
const slug = process.env.DASH_SLUG ?? "";

export default defineConfig({
  root: "web",
  base: slug ? `/${slug}/` : "/",
  plugins: [preact()],
  build: { outDir: slug ? `dist/${slug}` : "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
