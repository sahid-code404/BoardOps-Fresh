import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      // Share the same local Cloudflare state used by root-level Wrangler
      // migration/seed commands. This prevents Vite from silently opening a
      // different empty D1 database under services/api/.wrangler.
      persistState: { path: "../../.wrangler/state" },
    }),
  ],
  server: {
    port: 8787,
    strictPort: true,
  },
});
