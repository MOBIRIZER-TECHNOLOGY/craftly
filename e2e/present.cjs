/* Present: entrance animations, page transitions (forward and back), auto-play, reduced motion and leaving the show. */
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("present");
const results = [];
let shotN = 0;

const RED = [225, 29, 72]; // page 1 background #e11d48
const BLUE = [37, 99, 235]; // page 2 background #2563eb
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const near = (p, c, tol = 24) => !!p && dist(p, c) <= tol;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 220));
      try {
        await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30));
      } catch {}
    }
  };

  /** One pixel of the presenter's canvas, as a fraction of its width and height. */
  const px = (fx, fy) =>
    page.evaluate(
      ([x, y]) => {
        const c = document.querySelector("canvas.cf-present__page");
        if (!c || !c.width) return null;
        const d = c.getContext("2d").getImageData(Math.min(c.width - 1, Math.floor(c.width * x)), Math.min(c.height - 1, Math.floor(c.height * y)), 1, 1).data;
        return [d[0], d[1], d[2]];
      },
      [fx, fy],
    );
  const counter = () => page.evaluate(() => document.querySelector(".cf-present__count")?.textContent?.replace(/\s+/g, "") ?? "");
  const autoplayOn = () =>
    page.evaluate(
      () =>
        document
          .querySelector(".cf-present button[aria-pressed][aria-label*='Auto-play'], .cf-present button[aria-pressed][aria-keyshortcuts='P']")
          ?.getAttribute("aria-pressed") === "true",
    );
  const hasProgress = () => page.evaluate(() => !!document.querySelector(".cf-present__progress"));
  const inShow = () => page.evaluate(() => !!document.querySelector(".cf-present"));
  const until = async (what, fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return Date.now() - t0;
      await wait(40);
    }
    throw new Error("timed out waiting for " + what);
  };
  /** Waits for the first painted frame (the page background shows in the corner). */
  const painted = (bg) => until("the first frame", async () => near(await px(0.03, 0.03), bg, 30), 8000);
  /**
   * Opens the show. With `trail`, the middle of the page is read on every frame from the click on, in the page itself: read from
   * here, one at a time, the first frames can be gone before the first answer comes (Playwright's Firefox is that slow).
   */
  const openShow = async ({ trail = false } = {}) => {
    if (trail)
      await page.evaluate(() => {
        const t0 = performance.now();
        const frames = (window.__trail = []);
        const read = () => {
          const c = document.querySelector("canvas.cf-present__page");
          if (c && c.width) {
            const d = c.getContext("2d").getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.5), 1, 1).data;
            frames.push([Math.round(performance.now() - t0), [d[0], d[1], d[2]]]);
          }
          if (performance.now() - t0 < 2500) requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
      });
    await page
      .getByRole("button", { name: /^Present$/ })
      .first()
      .click();
    await page.locator(".cf-present").waitFor({ timeout: 8000 });
    // full screen is asked for as the show opens: a key pressed before it has come (or been refused) is the browser's
    await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 1500 }).catch(() => undefined);
  };

  let pageIds = [];
  let shapeId = "";

  await step("setup: two pages with different backgrounds, a fade-in shape and a slide transition", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(800);
    await page.getByRole("button", { name: "Browse shapes" }).click();
    await wait(400);
    await page.locator(".cf-ditem").nth(2).click();
    await wait(300);
    const ids = await page.evaluate(
      ({ red, blue }) => {
        const a = window.__editor.getState().actions;
        const first = window.__editor.getState().design.pages[0];
        const shape = first.elements[first.elements.length - 1];
        a.setPageBackground({ type: "solid", color: red }, first.id);
        // animations are set on the active page, so this comes before the second page is added (adding it makes it active)
        a.setAnimation([shape.id], "in", { kind: "fade", duration: 1, delay: 0 });
        const second = a.addPage({ blank: true });
        a.setPageBackground({ type: "solid", color: blue }, second);
        a.setPageDuration(2, "all");
        a.setPageTransition({ kind: "slide", duration: 1, direction: "left" }, "page", second);
        a.setActivePage(first.id);
        a.select([]);
        return { pages: window.__editor.getState().design.pages.map((p) => p.id), shape: shape.id };
      },
      { red: "#e11d48", blue: "#2563eb" },
    );
    pageIds = ids.pages;
    shapeId = ids.shape;
    if (pageIds.length !== 2 || !shapeId) throw new Error(JSON.stringify(ids));
    return `${pageIds.length} pages`;
  });

  await step("the show opens on the active page with Auto-play off", async () => {
    await openShow();
    await painted(RED);
    const c = await counter();
    if (c !== "1/2") throw new Error("counter " + c);
    if (await autoplayOn()) throw new Error("auto-play is already on");
    if (await hasProgress()) throw new Error("progress line without auto-play");
    return c;
  });

  await step("the shape fades in on the page (not there at first, part-way, there when settled)", async () => {
    // reopen so the clock starts from a known first frame
    await page.keyboard.press("Escape");
    await until("the show to close", async () => !(await inShow()), 3000);
    await openShow({ trail: true });
    await painted(RED);
    await shot("fade-during");
    await wait(2600);
    // the frames of the show from its first one, as they were drawn
    const frames = await page.evaluate(() => window.__trail);
    if (!frames.length) throw new Error("no frame of the show was read");
    const t0 = frames[0][0];
    const samples = frames.filter((_, i) => i % 4 === 0).map(([t, p]) => [t - t0, p]);
    const settled = await px(0.5, 0.5);
    const dF = dist(settled, RED);
    if (dF < 60) throw new Error(`the shape never appeared (settled ${settled}, background ${RED})`);
    const fractions = samples.map(([, p]) => dist(p, RED) / dF);
    const trail = samples.map(([t], i) => `${t}ms:${Math.round(fractions[i] * 100)}%`).join(" ");
    if (fractions[0] > 0.7) throw new Error(`the shape was already there at the first frame (${trail})`);
    if (!fractions.some((f) => f > 0.1 && f < 0.9)) throw new Error(`no part-way frame, it jumped (${trail})`);
    return trail
      .split(" ")
      .filter((_, i) => i % 3 === 0)
      .join(" ");
  });

  await step("next page plays the slide: both pages are on screen part-way, then only page 2", async () => {
    await page.keyboard.press("ArrowRight");
    await wait(380);
    const l = await px(0.06, 0.5);
    const r = await px(0.94, 0.5);
    await shot("slide-mid");
    const both = (near(l, RED) && near(r, BLUE)) || (near(l, BLUE) && near(r, RED));
    if (!both) throw new Error(`mid-slide sides are ${l} and ${r}, expected one of each page`);
    await wait(1000);
    const l2 = await px(0.06, 0.5);
    const r2 = await px(0.94, 0.5);
    if (!near(l2, BLUE) || !near(r2, BLUE)) throw new Error(`after the slide ${l2} and ${r2}`);
    const c = await counter();
    if (c !== "2/2") throw new Error("counter " + c);
    return `mid ${l} | ${r}`;
  });

  await step("previous page plays the same transition backwards", async () => {
    await page.keyboard.press("ArrowLeft");
    await wait(380);
    const l = await px(0.06, 0.5);
    const r = await px(0.94, 0.5);
    const both = (near(l, RED) && near(r, BLUE)) || (near(l, BLUE) && near(r, RED));
    if (!both) throw new Error(`mid-slide sides are ${l} and ${r}, expected one of each page`);
    await wait(1000);
    const l2 = await px(0.06, 0.5);
    const r2 = await px(0.94, 0.5);
    if (!near(l2, RED) || !near(r2, RED)) throw new Error(`after the slide ${l2} and ${r2}`);
    const c = await counter();
    if (c !== "1/2") throw new Error("counter " + c);
    return `mid ${l} | ${r}`;
  });

  await step("P starts auto-play: a progress line shows, it moves on by itself and stops after the last page", async () => {
    await page.keyboard.press("p");
    await until("auto-play to switch on", autoplayOn, 2000);
    if (!(await hasProgress())) throw new Error("no progress line while auto-play runs");
    const took = await until("page 2", async () => (await counter()) === "2/2", 9000);
    await until("auto-play to end", async () => !(await autoplayOn()), 6000);
    if (await hasProgress()) throw new Error("the progress line stayed after the show ended");
    const p2 = await px(0.5, 0.5);
    if (!near(p2, BLUE)) throw new Error("final frame is not page 2: " + p2);
    return `page 2 after ${(took / 1000).toFixed(1)}s`;
  });

  await step("pressing Next while auto-play runs turns it off", async () => {
    await page.keyboard.press("Home");
    await until("page 1", async () => (await counter()) === "1/2", 3000);
    await wait(300);
    await page.keyboard.press("p");
    await until("auto-play to switch on", autoplayOn, 2000);
    await page.keyboard.press("ArrowRight");
    await until("auto-play to switch off", async () => !(await autoplayOn()), 1500);
    await until("page 2", async () => (await counter()) === "2/2", 3000);
    await wait(1300);
    if (!near(await px(0.5, 0.5), BLUE)) throw new Error("not on page 2 after the move");
    if (await autoplayOn()) throw new Error("auto-play came back");
    return "ok";
  });

  await step("the Auto-play button does the same as P", async () => {
    await page.keyboard.press("Home");
    await until("page 1", async () => (await counter()) === "1/2", 3000);
    await wait(300);
    const button = page.locator(".cf-present").getByRole("button", { name: /Auto-play/ });
    await button.click();
    await until("auto-play to switch on", autoplayOn, 2000);
    await button.click();
    await until("auto-play to switch off", async () => !(await autoplayOn()), 2000);
    return "ok";
  });

  await step("with reduced motion a move is an instant cut", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await wait(300);
    await page.keyboard.press("Home");
    await wait(300);
    await page.keyboard.press("ArrowRight");
    await wait(130);
    const l = await px(0.06, 0.5);
    const r = await px(0.94, 0.5);
    if (!near(l, BLUE) || !near(r, BLUE)) throw new Error(`still moving after 130 ms: ${l} | ${r}`);
    return "cut";
  });

  await step("Esc leaves the show and the editor continues on the page it ended on", async () => {
    await page.keyboard.press("Escape");
    await until("the show to close", async () => !(await inShow()), 3000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const active = await page.evaluate(() => {
      const s = window.__editor.getState();
      return s.design.pages.findIndex((p) => p.id === s.activePageId);
    });
    if (active !== 1) throw new Error("the editor is on page " + (active + 1));
    return "page 2";
  });

  console.log(results.join("\n"));
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.log("E2E CRASH", e);
  process.exit(1);
});
