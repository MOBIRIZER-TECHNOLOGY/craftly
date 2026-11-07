import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/** Dev-only server for the print template contact sheet (dev-tpl-print.html). Never part of the production build. */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: "node_modules/.vite-tpl-print",
    server: { host: "127.0.0.1", port: 5189, strictPort: true },
  }),
);
