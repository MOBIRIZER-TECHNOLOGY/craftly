/*
 * The speed budgets, on a production build (CI's second pass): how long the app takes to show the dashboard in a new browser,
 * how long a page of 5,000 shapes takes to be added and drawn, and how smooth a drag on that page is. Each is the median of a
 * few tries, and each fails its step when it is over its budget. The numbers are written to budgets.json in the output folder,
 * so that a run's numbers can be compared with an earlier one's.
 *
 * The budgets are for CI's machine, a shared runner drawing without a GPU, and are set well above what a laptop measures, so
 * that they catch a real slowing (a repaint that walks every element on every move, say), not the runner's bad minutes.
 * START_BUDGET_MS, FILL_BUDGET_MS and FRAME_BUDGET_MS change them; docs/PERFORMANCE.md, "Budgets", says what was measured.
 *
 *   BASE=http://127.0.0.1:4174 node e2e/budgets.cjs      (a production build with VITE_EXPOSE_STORE=1, see e2e/README.md)
 */
const fs = require("node:fs");
const path = require("node:path");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("budgets");
const START_BUDGET_MS = Number(process.env.START_BUDGET_MS || 4000);
const FILL_BUDGET_MS = Number(process.env.FILL_BUDGET_MS || 1500);
const FRAME_BUDGET_MS = Number(process.env.FRAME_BUDGET_MS || 100);
const ELEMENTS = 5000;
const TRIES = 3;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

(async () => {
  const browser = await launch();
  const results = [];
  const numbers = {};
  const logs = [];
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 220));
    }
  };

  await step(`the dashboard shows in a new browser within ${START_BUDGET_MS} ms (median of ${TRIES})`, async () => {
    const times = [];
    for (let i = 0; i < TRIES; i++) {
      // a new context each time: nothing cached, no service worker yet, as for somebody who comes for the first time
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(BASE + "/#/", { waitUntil: "commit" });
      await page.getByText("What will you design today?").waitFor({ timeout: 30000 });
      times.push(Date.now() - t0);
      await ctx.close();
    }
    numbers.startMs = times;
    const m = median(times);
    if (m > START_BUDGET_MS) throw new Error(`median ${m} ms (${times.join(", ")})`);
    return `median ${m} ms (${times.join(", ")})`;
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  let top = "";

  await step(`a page of ${ELEMENTS} shapes is added and drawn within ${FILL_BUDGET_MS} ms (median of ${TRIES})`, async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 30000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !!window.__editor, null, { timeout: 10000 });
    const times = [];
    for (let i = 0; i < TRIES; i++) {
      const r = await page.evaluate(async (n) => {
        const { actions } = window.__editor.getState();
        actions.selectAll();
        actions.deleteElements();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const els = [];
        for (let k = 0; k < n; k++) {
          els.push({
            id: "x",
            type: "shape",
            shape: k % 3 ? "rect" : "ellipse",
            rotation: 0,
            opacity: 1,
            radius: 0,
            stroke: null,
            fill: `hsl(${(k * 37) % 360}, 70%, 55%)`,
            x: (k * 53) % 1800,
            y: (k * 29) % 1000,
            width: 40 + (k % 5) * 10,
            height: 30 + (k % 7) * 8,
          });
        }
        // the one to drag, on top, in the middle
        els.push({ id: "x", type: "shape", shape: "rect", rotation: 0, opacity: 1, radius: 0, stroke: null, fill: "#111111", x: 860, y: 440, width: 200, height: 200 });
        const t0 = performance.now();
        const ids = actions.addElements(els, { center: false, select: false });
        // drawn: two frames after the store has the elements
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { ms: Math.round(performance.now() - t0), top: ids[ids.length - 1], count: window.__editor.getState().design.pages[0].elements.length };
      }, ELEMENTS);
      if (r.count !== ELEMENTS + 1) throw new Error(`the page has ${r.count} elements`);
      times.push(r.ms);
      top = r.top;
    }
    numbers.fillMs = times;
    const m = median(times);
    if (m > FILL_BUDGET_MS) throw new Error(`median ${m} ms (${times.join(", ")})`);
    return `median ${m} ms (${times.join(", ")})`;
  });

  await step(`dragging a shape on that page: the median frame within ${FRAME_BUDGET_MS} ms`, async () => {
    if (!top) throw new Error("there is no page of shapes to drag on");
    const at = await page.evaluate((id) => {
      const s = window.__editor.getState();
      const el = s.design.pages.find((p) => p.id === s.activePageId).elements.find((e) => e.id === id);
      const b = document.querySelector(".cf-pageframe").getBoundingClientRect();
      return { x: b.left + (el.x + el.width / 2) * s.zoom, y: b.top + (el.y + el.height / 2) * s.zoom, x0: el.x };
    }, top);
    const frames = [];
    for (let i = 0; i < TRIES; i++) {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 6, at.y);
      await page.evaluate(() => {
        const f = (window.__frames = []);
        let last = performance.now();
        window.__framesOn = true;
        const tick = () => {
          const now = performance.now();
          f.push(now - last);
          last = now;
          if (window.__framesOn) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      for (let k = 1; k <= 60; k++) await page.mouse.move(at.x + 6 + 120 * Math.sin((k / 60) * Math.PI), at.y + 40 * Math.sin((k / 30) * Math.PI));
      const got = await page.evaluate(() => {
        window.__framesOn = false;
        return window.__frames.slice(1);
      });
      await page.mouse.up();
      frames.push(...got);
    }
    const moved = await page.evaluate((id) => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.find((e) => e.id === id).x;
    }, top);
    if (moved === at.x0) throw new Error("the shape did not move: the drag was not a drag");
    numbers.frameMs = frames.map((f) => Math.round(f * 10) / 10);
    const m = Math.round(median(frames) * 10) / 10;
    const p95 = Math.round(pct(frames, 0.95) * 10) / 10;
    if (m > FRAME_BUDGET_MS) throw new Error(`median frame ${m} ms, 95th ${p95} ms, ${frames.length} frames`);
    return `median ${m} ms, 95th ${p95} ms, ${frames.length} frames`;
  });

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs[0]);
    return "clean";
  });

  fs.writeFileSync(
    path.join(OUT, "budgets.json"),
    JSON.stringify({ base: BASE, at: new Date().toISOString(), budgets: { START_BUDGET_MS, FILL_BUDGET_MS, FRAME_BUDGET_MS }, ...numbers }, null, 2),
  );
  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.log("E2E CRASH", e);
  process.exit(1);
});
