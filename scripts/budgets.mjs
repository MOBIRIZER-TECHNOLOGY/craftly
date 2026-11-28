/*
 * The size budgets of a production build: what a person's browser downloads, gzipped, before it shows each screen, and what
 * the service worker keeps for offline use. It stops with a message when one is over its budget, so that a dependency or an
 * import that makes the app heavier is seen in the pull request that adds it, not months later.
 *
 *   npm run build && node scripts/budgets.mjs [dist]
 *
 * What it counts, for each screen: the chunk that shows it and every chunk it imports statically, followed through the bundle
 * (a dynamic `import()` is loaded later, on demand, and is not counted), with its CSS, less what an earlier screen already
 * fetched: the first load (index.html's script and stylesheet), then the dashboard after it, then the editor after both, which
 * is the order a person meets them.
 *
 * The budgets are what the build measured on 2026-11-28 with about 10 % to spare. When something heavier is worth it, raise the
 * budget in the same change and say why in its message; docs/PERFORMANCE.md, "Budgets", has the numbers.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const KIB = 1024;
export const BUDGETS = {
  /** index.html's script and stylesheet: measured 247 KiB */
  first: 275 * KIB,
  /** the dashboard's chunks after the first load: measured 254 KiB */
  dashboard: 280 * KIB,
  /** the editor's chunks after the dashboard: measured 243 KiB */
  editor: 270 * KIB,
  /** everything the service worker keeps (not gzipped: it is stored as it is): measured 6.5 MiB */
  precache: 7.25 * KIB * KIB,
};

/** The sizes of a build in `dist`, by the names of BUDGETS. */
export function measure(dist) {
  const assets = readdirSync(join(dist, "assets"));
  const gz = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
  const fetched = new Set();
  /** `file` and every chunk it imports statically, those not fetched yet, added to `fetched`; their gzipped size. */
  const take = (file) => {
    if (fetched.has(file)) return 0;
    fetched.add(file);
    let size = gz(file);
    if (!file.endsWith(".js")) return size;
    const text = readFileSync(join(dist, file), "utf8");
    // `import{a as b}from"./x.js"` and `import"./x.js"`; `import("./x.js")` has a bracket and is left out
    for (const m of text.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) size += take(`assets/${m[1]}`);
    return size;
  };
  const screen = (name) => {
    const own = assets.filter((a) => a.startsWith(`${name}-`));
    const js = own.find((a) => a.endsWith(".js"));
    if (!js) throw new Error(`no chunk named ${name}-*.js in ${dist}/assets: was the screen renamed?`);
    return own.reduce((sum, a) => sum + take(`assets/${a}`), 0);
  };
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  if (!entry.length) throw new Error(`index.html in ${dist} names no script or stylesheet`);
  const first = entry.reduce((sum, file) => sum + take(file), 0);
  const dashboard = screen("Dashboard");
  const editor = screen("Editor");
  const files = JSON.parse(readFileSync(join(dist, "precache.json"), "utf8")).files;
  const precache = files.reduce((sum, file) => sum + statSync(join(dist, file)).size, 0);
  return { first, dashboard, editor, precache };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dist = process.argv[2] ?? "dist";
  if (!existsSync(join(dist, "index.html"))) {
    console.error(`No build in ${dist}: run npm run build first.`);
    process.exit(1);
  }
  const sizes = measure(dist);
  const kib = (n) => `${(n / KIB).toFixed(0)} KiB`;
  let over = 0;
  for (const [name, size] of Object.entries(sizes)) {
    const budget = BUDGETS[name];
    const ok = size <= budget;
    if (!ok) over++;
    console.log(`${ok ? "ok  " : "OVER"} ${name.padEnd(10)} ${kib(size).padStart(9)} of ${kib(budget)} (${Math.round((size / budget) * 100)} %)`);
  }
  if (over) {
    console.error(`\n${over} over budget. If the weight is worth it, raise the budget in scripts/budgets.mjs and say why.`);
    process.exit(1);
  }
}
