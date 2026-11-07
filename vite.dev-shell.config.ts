/** Dev-only: serves dev-shell.html (the editor shell harness) on port 5181 next to the real app. */
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    cacheDir: "node_modules/.vite-shell",
    server: { port: 5181, strictPort: true },
  }),
);
