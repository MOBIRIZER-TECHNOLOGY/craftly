import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";

/**
 * Offline support: lists every file the build produced in `precache.json` (so the service worker can store the whole
 * app on the first visit) and stamps the service worker with a build id (so a new build installs a new worker).
 * WebAssembly files (the ONNX runtime, 28.7 MB) are listed apart under `runtime`: most visitors never use the tools that
 * need them, so the service worker keeps them only after first use, and across updates.
 */
function offlineSupport(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  let buildId = "dev";
  return {
    name: "craftly-offline-support",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const all = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map") && f !== "index.html")
        .sort();
      const runtime = all.filter((f) => f.endsWith(".wasm"));
      const files = all.filter((f) => !f.endsWith(".wasm"));
      buildId = createHash("sha1").update(all.join("|")).digest("hex").slice(0, 10);
      this.emitFile({ type: "asset", fileName: "precache.json", source: JSON.stringify({ buildId, files, runtime }) });
    },
    closeBundle() {
      const sw = resolve(root, outDir, "sw.js");
      if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, "utf8").replaceAll("__BUILD_ID__", buildId));
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineSupport()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Folders that tools delete and write again while a dev server runs: a coverage run does it to coverage/, a build
    // copy (dist-e2e, see e2e/README.md) to dist-*/. On Windows a watch on a deleted folder then sends "rename" events
    // for as long as the server lives, about 100,000 a second, which keeps it at two or three CPU cores
    // (src/test/devServerWatch.test.ts). A path with a folder called coverage, dist or dist-<name> in it is left alone,
    // the folder itself included (a glob such as dist-*/** would not match the folder, only what is inside it).
    watch: { ignored: [/[\\/](coverage|dist|dist-[^\\/.]+)([\\/]|$)/] },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  // the on-device model worker splits its code (the runtime loads on demand), which needs module workers
  worker: { format: "es" },
  // the runtime finds its WebAssembly file next to its own script, which pre-bundling would move
  optimizeDeps: { include: ["lucide", "qrcode-generator"], exclude: ["onnxruntime-web"] },
  test: {
    // importing the renderer loads the whole font table, which is slow while many workers start at once
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // a jsdom worker is heavy: keep the pool small enough for a laptop
    maxWorkers: 6,
    projects: [
      {
        // pure logic: documents, geometry, text layout, export writers ... (no browser needed)
        extends: true,
        test: { name: "logic", environment: "node", include: ["src/**/*.test.ts"], exclude: ["src/**/*.dom.test.ts"] },
      },
      {
        // components and anything else that needs a DOM: React Testing Library on jsdom, see src/test/
        extends: true,
        test: { name: "ui", environment: "jsdom", include: ["src/**/*.test.tsx", "src/**/*.dom.test.ts"], setupFiles: ["src/test/domSetup.ts"] },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        // dev-only entry points and the UI-kit gallery: they are not part of the shipped app
        "src/dev/**",
        "src/ui/Showcase.tsx",
        "src/ui/showcase-main.tsx",
        // the worker's entry and the loader of the real ONNX runtime need a real browser: e2e/ml.cjs runs them
        "src/ml/worker.ts",
        "src/ml/ortRuntime.ts",
        "src/**/*.d.ts",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      // `npm run coverage` fails when the total drops below these (the suite sits above them, see the README for today's figures)
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
