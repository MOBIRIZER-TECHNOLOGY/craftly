import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/** Dev server for the social template contact sheet (dev-tpl-social.html), kept off the main ports and cache. */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: "node_modules/.vite-tpl-social",
    server: { host: "127.0.0.1", port: 5188, strictPort: true },
  }),
);
