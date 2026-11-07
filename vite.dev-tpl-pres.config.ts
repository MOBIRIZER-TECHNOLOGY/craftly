import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/** Dev server for the presentation template contact sheet (dev-tpl-pres.html). Port 5187. */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: "node_modules/.vite-tpl-pres",
    server: { host: "127.0.0.1", port: 5187, strictPort: true },
  }),
);
