import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/**
 * Dev server for the export harness (dev-export.html): own port and cache so it never clashes with other agents.
 * `vite build --config vite.dev-export.config.ts --outDir <dir>` bundles just the harness (a production-build check
 * of the export package, including the hashed font files the SVG exporter embeds).
 */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: "node_modules/.vite-export",
    server: { host: "127.0.0.1", port: 5185, strictPort: true },
    preview: { host: "127.0.0.1", port: 5195, strictPort: true },
    build: { rollupOptions: { input: "dev-export.html" } },
  }),
);
