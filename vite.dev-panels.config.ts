import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/** Dev server for the side-panel harness (dev-panels.html). Never used by the real build. */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: "node_modules/.vite-panels",
    server: { port: 5182, strictPort: true },
  }),
);
