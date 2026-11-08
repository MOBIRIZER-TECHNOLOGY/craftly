/*
 * Update journey: what happens to tabs that are open when a new build is published. Needs a PRODUCTION build in the
 * project folder (E2E_DIST, default dist-e2e; see e2e/README.md). It starts a small server of its own for that build,
 * and plays a deployment by changing what the server answers: build B is build A with another build id, one more file
 * and without one lazily loaded chunk (a real build renames its files, so the old ones are gone from the server);
 * build C follows B the same way.
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { launch } = require("./lib.cjs");

const DIST = path.resolve(process.env.E2E_DIST || "dist-e2e");
const PROMPT = "A new version of Craftly is ready. Reload to use it.";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

// the policy of the README's Deploy section, so that the pages of this journey are held to it as they would be in production
const POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co blob: data:; worker-src 'self'; media-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

const results = [];
const logs = [];

/** The build in DIST, and the builds that are made from it by changing the id. */
function loadBuilds() {
  if (!fs.existsSync(path.join(DIST, "precache.json")))
    throw new Error(`no production build in ${DIST}: build with VITE_EXPOSE_STORE=1 npx vite build --outDir dist-e2e (see e2e/README.md)`);
  const read = (name) => fs.readFileSync(path.join(DIST, name), "utf8");
  const a = { name: "A", index: read("index.html"), sw: read("sw.js"), precache: read("precache.json"), hidden: new Set(), marker: null };
  const list = JSON.parse(a.precache);
  a.id = list.buildId;
  const chunk = list.files.find((f) => /^assets\/BackupDialog-.*\.js$/.test(f));
  if (!chunk) throw new Error("the build has no BackupDialog chunk to play an old file with");
  if (!a.index.includes(`content="${a.id}"`) || !a.sw.includes(`"${a.id}"`)) throw new Error("the build was not stamped with its id in index.html and sw.js");
  const derive = (name, id) => {
    const marker = `assets/update-marker-${name}.js`;
    const swap = (text) => text.replaceAll(a.id, id);
    return {
      name,
      id,
      index: swap(a.index),
      sw: swap(a.sw),
      precache: JSON.stringify({ ...list, buildId: id, files: [...list.files.filter((f) => f !== chunk), marker] }),
      hidden: new Set(["/" + chunk]),
      marker,
      chunk: "/" + chunk,
    };
  };
  return { a, b: derive("B", "b".repeat(10)), c: derive("C", "c".repeat(10)), chunk: "/" + chunk };
}

function serve(initial) {
  const state = { current: initial };
  const server = http.createServer((req, res) => {
    const build = state.current;
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/") pathname = "/index.html";
    const send = (status, body, type) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", "content-security-policy": POLICY });
      res.end(body);
    };
    if (pathname === "/index.html") return send(200, build.index, TYPES[".html"]);
    if (pathname === "/sw.js") return send(200, build.sw, TYPES[".js"]);
    if (pathname === "/precache.json") return send(200, build.precache, TYPES[".json"]);
    if (build.marker && pathname === "/" + build.marker) return send(200, `// marker ${build.name}`, TYPES[".js"]);
    if (build.hidden.has(pathname)) return send(404, "gone", "text/plain");
    const file = path.join(DIST, pathname);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, "not found", "text/plain");
    send(200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

(async () => {
  const { a, b, c, chunk } = loadBuilds();
  const { server, state, url } = await serve(a);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const watch = (page, label) => {
    page.on("console", (m) => {
      if (m.type() === "error") logs.push(`${label} console.error: ${m.text().slice(0, 200)}`);
    });
    page.on("pageerror", (e) => logs.push(`${label} PAGEERROR ${e.message.slice(0, 200)}`));
  };
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
    }
  };

  /* ---- what a page can see ---- */
  const cacheNames = (page) => page.evaluate(() => caches.keys());
  const controllerBuild = (page) =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => resolve(event.data.build);
          navigator.serviceWorker.controller.postMessage({ type: "VERSION" }, [channel.port2]);
          setTimeout(() => resolve(null), 3000);
        }),
    );
  const pageBuild = (page) => page.evaluate(() => document.querySelector('meta[name="craftly-build"]')?.getAttribute("content") ?? null);
  /** Repeats a check made in the page until it holds. (waitForFunction does not wait for the promise of an async function: it takes the promise for a truthy answer.) */
  const until = async (page, check, arg, what, timeoutMs = 30000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await page.evaluate(check, arg)) return;
      await page.waitForTimeout(150);
    }
    throw new Error("timed out waiting for " + what);
  };
  const hasCache = (page, id) => until(page, async (name) => (await caches.keys()).includes(name), `craftly-${id}`, `the cache of build ${id}`);
  const controlled = (page) => page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  const waitingWorker = (page) => until(page, async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, undefined, "a worker that is waiting");
  const lookForUpdate = (page) => page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration.update()));
  const prompt = (page) => page.getByText(PROMPT);
  const home = async (page) => {
    await page.goto(url + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
  };

  const page1 = await ctx.newPage();
  const page2 = await ctx.newPage();
  watch(page1, "tab 1");
  watch(page2, "tab 2");
  let designPath = "";

  await step("the first visit stores build A and starts its worker, with no prompt", async () => {
    await home(page1);
    await controlled(page1);
    await hasCache(page1, a.id);
    if ((await controllerBuild(page1)) !== a.id) throw new Error("the worker is not build A");
    if ((await pageBuild(page1)) !== a.id) throw new Error("the page does not carry the id of build A: " + (await pageBuild(page1)));
    await page1.waitForTimeout(2500);
    if (await prompt(page1).isVisible()) throw new Error("the first visit asks for a reload");
    return "worker and page are build " + a.id;
  });

  await step("a design is open in tab 1 and tab 2 is on the dashboard, both on build A", async () => {
    await page1
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page1.locator(".cf-workspace").waitFor({ timeout: 20000 });
    designPath = await page1.evaluate(() => location.hash);
    await home(page2);
    await controlled(page2);
    await page2.evaluate(() => {
      window.__stillHere = 1;
    });
    return designPath;
  });

  await step("build B is published: its worker installs and WAITS, and the tabs keep running build A", async () => {
    state.current = b;
    await lookForUpdate(page1);
    await waitingWorker(page1);
    await hasCache(page1, b.id);
    if ((await controllerBuild(page1)) !== a.id || (await controllerBuild(page2)) !== a.id) throw new Error("a tab was handed to the new worker");
    const names = await cacheNames(page1);
    if (!names.includes(`craftly-${a.id}`) || !names.includes(`craftly-${b.id}`)) throw new Error("caches: " + names);
    const stored = await page1.evaluate(async (id) => (await (await caches.open(`craftly-${id}`)).keys()).map((r) => new URL(r.url).pathname), b.id);
    const counts = await page1.evaluate(async () =>
      Object.fromEntries(await Promise.all((await caches.keys()).map(async (n) => [n, (await (await caches.open(n)).keys()).length]))),
    );
    if (!stored.includes("/" + b.marker))
      throw new Error(
        "counts " +
          JSON.stringify(counts) +
          " -> " +
          "the new build's files were not all stored: " +
          stored.length +
          " files, marker " +
          b.marker +
          ", last " +
          stored.slice(-3).join(" "),
      );
    return "both builds stored, tabs still on A";
  });

  await step("both tabs, which still run build A, are asked to reload", async () => {
    await prompt(page1).waitFor({ timeout: 15000 });
    await prompt(page2).waitFor({ timeout: 15000 });
    return "prompt in both";
  });

  await step("a tab opened now gets build B's page from the network and is not asked to reload: it already runs it", async () => {
    const page3 = await ctx.newPage();
    watch(page3, "tab 3");
    await home(page3);
    await controlled(page3);
    if ((await pageBuild(page3)) !== b.id) throw new Error("the new tab runs " + (await pageBuild(page3)));
    await page3.waitForTimeout(3500);
    const asked = await prompt(page3).isVisible();
    await page3.close();
    if (asked) throw new Error("a tab that already runs the new build is asked to reload");
    return "page build " + b.id + ", no prompt";
  });

  await step("Reload in tab 1 saves an edit that was not saved yet, switches to build B and reloads once", async () => {
    await page1.getByRole("tab", { name: "Text", exact: true }).click();
    await page1.getByRole("button", { name: /Add a text box/ }).click();
    await page1.keyboard.type("Update survives", { delay: 10 });
    await page1.keyboard.press("Escape");
    const loaded = page1.waitForEvent("load", { timeout: 30000 });
    // in one go, so that the autosave (700 ms after the last change) has not run yet
    const before = await page1.evaluate(() => {
      const state = window.__editor.getState().saveState;
      document.querySelector(".cf-toast__action").click();
      return state;
    });
    if (before !== "unsaved") throw new Error("the edit was already saved (" + before + "): this step proves nothing");
    await loaded;
    await controlled(page1);
    await page1.locator(".cf-workspace").waitFor({ timeout: 20000 });
    if ((await controllerBuild(page1)) !== b.id) throw new Error("the worker is " + (await controllerBuild(page1)));
    if ((await pageBuild(page1)) !== b.id) throw new Error("the page is " + (await pageBuild(page1)));
    const kept = await page1.evaluate(() => JSON.stringify(window.__editor.getState().design).includes("Update survives"));
    if (!kept) throw new Error("the edit was lost");
    return "edit kept, worker and page are build " + b.id;
  });

  await step("tab 2 was not reloaded behind the person's back, and still asks", async () => {
    if ((await page2.evaluate(() => window.__stillHere)) !== 1) throw new Error("tab 2 was reloaded");
    if ((await controllerBuild(page2)) !== b.id) throw new Error("tab 2 is not served by the new worker");
    if (!(await prompt(page2).isVisible())) throw new Error("tab 2 lost its prompt");
    return "still on its old page, with its prompt";
  });

  await step("tab 2, on build A, still gets a lazily loaded file that the server no longer has, from the build that was kept", async () => {
    const status = await fetch(url + chunk, { cache: "no-store" }).then((r) => r.status);
    if (status !== 404) throw new Error("the server still has the file (" + status + "): this step proves nothing");
    await page2.getByRole("button", { name: "Account" }).first().click();
    await page2.getByRole("menuitem", { name: "Back up & restore" }).click();
    await page2.getByRole("dialog", { name: "Back up & restore" }).waitFor({ timeout: 15000 });
    await page2.keyboard.press("Escape");
    const names = await cacheNames(page2);
    if (!names.includes(`craftly-${a.id}`)) throw new Error("build A's files were deleted: " + names);
    return "dialog opened from build A's cache; caches " + names.filter((n) => n.startsWith("craftly-")).length;
  });

  await step("build C is published and taken: the build before the previous one is dropped", async () => {
    state.current = c;
    await lookForUpdate(page1);
    await waitingWorker(page1);
    await hasCache(page1, c.id);
    await prompt(page1).waitFor({ timeout: 15000 });
    const loaded = page1.waitForEvent("load", { timeout: 30000 });
    await page1.getByRole("button", { name: "Reload" }).click();
    await loaded;
    await controlled(page1);
    if ((await controllerBuild(page1)) !== c.id) throw new Error("the worker is " + (await controllerBuild(page1)));
    const names = (await cacheNames(page1)).filter((n) => n.startsWith("craftly-") && n !== "craftly-runtime");
    const expected = [`craftly-active-${c.id}`, `craftly-${b.id}`, `craftly-${c.id}`].sort();
    if (JSON.stringify(names.sort()) !== JSON.stringify(expected)) throw new Error("caches: " + names);
    return "kept B, took C, dropped A";
  });

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 4).join(" | "));
    return "clean";
  });

  console.log(results.join("\n"));
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
  server.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
