import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";

const REPORT_BODY_LIMIT = 20_000;

/** What the development server does with a report that the page sends to /__report: it checks that it is JSON of a sensible size and prints it. */
export async function answerReport(req: IncomingMessage, res: ServerResponse, log: (text: string) => void): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > REPORT_BODY_LIMIT) {
      res.statusCode = 413;
      res.end();
      return;
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    JSON.parse(text);
  } catch {
    res.statusCode = 400;
    res.end();
    return;
  }
  log(`A problem report arrived at /__report:\n${text}`);
  res.statusCode = 204;
  res.end();
}

/**
 * The development server answers a report that the page sends to /__report (src/core/problems.ts gives the page that address
 * while developing), so that the whole flow, the Send button, the request and the toast, can be tried without a server of one's
 * own. It prints the report in the terminal and keeps nothing. A production build has no such address unless the site that
 * hosts it names one (docs/CRASH-RECOVERY.md).
 */
export function devReportEndpoint(log: (text: string) => void = (text) => console.log(text)): Plugin {
  return {
    name: "craftly-dev-report-endpoint",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__report", (req, res) => void answerReport(req, res, log));
    },
  };
}

/**
 * Offline support: lists every file the build produced in `precache.json` (so the service worker can store the whole
 * app on the first visit) and stamps the service worker with a build id (so a new build installs a new worker). The page
 * gets the same id in a meta tag, which is how a tab tells that it runs the build a waiting worker carries
 * (`src/serviceWorker.ts`).
 * WebAssembly files (the ONNX runtime, 28.7 MB) are listed apart under `runtime`: most visitors never use the tools that
 * need them, so the service worker keeps them only after first use, and across updates.
 */
export function offlineSupport(): Plugin {
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
      for (const name of ["sw.js", "index.html"]) {
        const file = resolve(root, outDir, name);
        if (existsSync(file)) writeFileSync(file, readFileSync(file, "utf8").replaceAll("__BUILD_ID__", buildId));
      }
    },
  };
}

const POLICY_LINE = /^([ \t]*Content-Security-Policy:[ \t]*)(.+)$/m;
/** What a browser ignores when the policy comes in a meta tag: these three need a real header. */
const NOT_IN_META = new Set(["frame-ancestors", "report-uri", "sandbox"]);
/** A scheme, a host (with * for any sub-domain) and a port: nothing that could end the directive or the attribute it is written into. */
const HOST_SOURCE = /^[A-Za-z0-9*.:/[\]-]+$/;

function policyOf(headers: string): string {
  const line = POLICY_LINE.exec(headers);
  if (!line) throw new Error("public/_headers has no Content-Security-Policy line: the build reads the policy of the page from it");
  return line[2].trim();
}

/** The Content-Security-Policy of `public/_headers` as a meta tag can carry it: the same text, less the directives a meta tag cannot have. */
export function metaPolicy(headers: string): string {
  return policyOf(headers)
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive && !NOT_IN_META.has(directive.split(/\s+/)[0].toLowerCase()))
    .join("; ");
}

/** The hosts named in VITE_CRAFTLY_CSP_CONNECT, with spaces or commas between them. Anything that is not the address of a host stops the build. */
export function connectHosts(value: string | undefined): string[] {
  const hosts = (value ?? "").split(/[\s,]+/).filter(Boolean);
  for (const host of hosts) {
    if (!HOST_SOURCE.test(host))
      throw new Error(`VITE_CRAFTLY_CSP_CONNECT: "${host}" is not the address of a host (write, for example, https://live.example.org wss://live.example.org)`);
  }
  return hosts;
}

/** The text of the headers file with the hosts added to `connect-src` of its policy; every other line stays as it is. */
export function addConnectHosts(headers: string, hosts: string[]): string {
  if (!hosts.length) return headers;
  const directives = policyOf(headers).split(";");
  const at = directives.findIndex((directive) => directive.trim().split(/\s+/)[0].toLowerCase() === "connect-src");
  if (at < 0) throw new Error("the Content-Security-Policy of public/_headers has no connect-src to add the hosts of VITE_CRAFTLY_CSP_CONNECT to");
  const named = new Set(directives[at].trim().split(/\s+/));
  directives[at] = [directives[at].trimEnd(), ...hosts.filter((host) => !named.has(host))].join(" ");
  return headers.replace(POLICY_LINE, (_line, start: string) => start + directives.join(";"));
}

/**
 * The Content-Security-Policy as a meta tag in the page of a production build, for the hosts that do not read `public/_headers`
 * (only Netlify and Cloudflare Pages do): without it a build on any other host had no policy at all unless its operator wrote one.
 *
 * The policy has one source, the line in `public/_headers`. The tag gets that text less the directives a browser ignores in a
 * meta tag (frame-ancestors, report-uri, sandbox). A site with a live server or a mirror of the models names their addresses in
 * the build variable VITE_CRAFTLY_CSP_CONNECT; they are added to `connect-src` in the tag and in the `_headers` file of the build,
 * because a browser that gets a header and a tag enforces both, and a host missing from either is refused.
 *
 * Only in a build: the development server puts inline scripts of its own into the page (React refresh), which the policy refuses.
 */
export function cspMeta(): Plugin {
  let builtHeaders = "";
  let headers = "";
  let hosts: string[] = [];
  return {
    name: "craftly-csp-meta",
    apply: "build",
    configResolved(config) {
      builtHeaders = resolve(config.root, config.build.outDir, "_headers");
      hosts = connectHosts(config.env.VITE_CRAFTLY_CSP_CONNECT);
      headers = addConnectHosts(readFileSync(resolve(config.publicDir, "_headers"), "utf8"), hosts);
    },
    transformIndexHtml(html) {
      const tag = `<meta http-equiv="Content-Security-Policy" content="${metaPolicy(headers).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" />`;
      // A policy applies to what comes after it, so it goes to the top of the head; only the line that names the encoding stays
      // before it, because a browser looks for that line in the first 1024 bytes of the page.
      const charset = /^([ \t]*)<meta\s+charset=[^>]*>/im.exec(html);
      if (charset) return html.replace(charset[0], () => `${charset[0]}\n${charset[1]}${tag}`);
      const head = /<head[^>]*>/i.exec(html);
      if (!head) throw new Error("index.html has no <head> to write the Content-Security-Policy into");
      return html.replace(head[0], () => head[0] + tag);
    },
    closeBundle() {
      if (hosts.length && existsSync(builtHeaders)) writeFileSync(builtHeaders, headers);
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineSupport(), cspMeta(), devReportEndpoint()],
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
  // the runtime finds its WebAssembly file next to its own script, which pre-bundling would move. Libraries that load on first
  // use are listed so that the dev server prepares them at the start: one that it finds while the page runs makes it reload the page.
  optimizeDeps: { include: ["lucide", "qrcode-generator", "paper/dist/paper-core"], exclude: ["onnxruntime-web"] },
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
        // the entry point of the server for shared designs: it only reads the environment and listens (src/server/live.ts is what is tested)
        "src/server/main.ts",
        "src/**/*.d.ts",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      // `npm run coverage` fails when the total drops below these (the suite sits above them, see the README for today's figures)
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
