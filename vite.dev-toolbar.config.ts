/** Dev-only config for the toolbar harness (dev-toolbar.html): the base config on its own port and cache. */
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    cacheDir: "node_modules/.vite-toolbar",
    server: { port: 5184, strictPort: true },
  }),
);
