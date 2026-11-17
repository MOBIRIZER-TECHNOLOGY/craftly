/*
 * The first visit, in a real browser: Home greets an empty library with a welcome panel (what Craftly is, three ways to begin, that
 * the work stays on this device) that is part of the page and never a dialog; each way to begin works (a blank size through the
 * Create dialog, the templates, a picture opened from the device); the panel can be reached and dismissed with the keyboard, and
 * stays dismissed after a reload; a person who has a design never sees it; the editor's note on an empty page shows the first time,
 * lets clicks through to the page, and goes for good with the first element or its close button; the panel and the note fit a
 * 375 px phone in English and in Hindi with no sideways scroll; reduced motion takes the panel's entrance away; no console errors.
 *
 * Every context starts from empty storage, as the other journeys do; the words are read from the app's own catalogs (dev server)
 * or, for a production build, from the English text below.
 */
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("onboarding");
const results = [];
const logs = [];
let shotN = 0;

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };
const EN = {
  title: "Welcome to Craftly",
  ways: "Ways to begin",
  dismiss: "Dismiss the welcome",
  local: "Your work stays on this device",
  hintLabel: "Getting started",
  hintDismiss: "Dismiss this hint",
};

(async () => {
  const browser = await launch();
  let page = null; // the page the next screenshot is of
  const shot = (name) => page && page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 300));
      await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);

  /** a new browser with empty storage, in `lang`, of the size `viewport` (a phone gets touch) */
  const open = async (lang = "en", viewport = DESKTOP, options = {}) => {
    const phone = viewport.width < 600;
    const ctx = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone, locale: lang === "hi" ? "hi-IN" : "en-US", ...options });
    await ctx.addInitScript((l) => {
      try {
        localStorage.setItem("craftly.language", l);
      } catch {
        /* the language then follows the browser's */
      }
    }, lang);
    page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on("console", (msg) => {
      if (msg.type() === "error") logs.push(lang + " console.error: " + msg.text().slice(0, 240));
    });
    page.on("pageerror", (e) => logs.push(lang + " PAGEERROR " + e.message.slice(0, 240)));
    return ctx;
  };

  /** the words of the welcome and of the note in `lang`, from the catalog the dev server serves; English as written above otherwise */
  const words = (lang) =>
    page
      .evaluate(async (l) => {
        const c = (await import(`/src/i18n/${l}/index.ts`))[l];
        const w = c.dashboard.welcome;
        const h = c.editor.emptyHint;
        return { title: w.title, ways: w.ways, dismiss: w.dismiss, local: w.local, hintLabel: h.label, hintDismiss: h.dismiss };
      }, lang)
      .catch(() => (lang === "en" ? EN : null));

  /** whether this build has an account server built in (read from the module on the dev server; a production build has none in the journeys) */
  const accountServer = () => page.evaluate(async () => (await import("/src/cloud/state.ts")).CONFIGURED_SERVER).catch(() => "");

  const home = async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.locator(".cf-hero__title").waitFor({ timeout: 40000 });
  };
  const welcome = (w) => page.getByRole("region", { name: w.title });
  const way = (id) => page.locator(`.cf-welcome__way[data-way='${id}']`);
  const hint = (w) => page.getByRole("note", { name: w.hintLabel });
  const elementCount = () => page.evaluate(() => window.__editor.getState().design.pages.reduce((n, p) => n + p.elements.length, 0));
  /** throws when the page or the dashboard's scrolling column is wider than the screen */
  const noSidewaysScroll = async (where) => {
    const r = await page.evaluate(() => {
      const doc = document.scrollingElement;
      const col = document.querySelector(".cf-dash__scroll");
      return { doc: [doc.scrollWidth, doc.clientWidth], col: col ? [col.scrollWidth, col.clientWidth] : [0, 0] };
    });
    if (r.doc[0] > r.doc[1] + 1) throw new Error(`${where}: the page is ${r.doc[0]} px wide in a ${r.doc[1]} px screen`);
    if (r.col[0] > r.col[1] + 1) throw new Error(`${where}: the dashboard column is ${r.col[0]} px wide in ${r.col[1]} px`);
  };
  /** throws when `locator` is not wholly inside the width of the screen */
  const fitsAcross = async (locator, what) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(what + " is not on the page");
    const { width } = page.viewportSize();
    if (box.x < -0.5 || box.x + box.width > width + 0.5) throw new Error(`${what} runs from ${Math.round(box.x)} to ${Math.round(box.x + box.width)} px on a ${width} px screen`);
    return box;
  };
  /** a small PNG made by the browser, for the file chooser */
  const pngFile = async () => {
    const b64 = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 200;
      const g = c.getContext("2d");
      g.fillStyle = "#12c2b9";
      g.fillRect(0, 0, 320, 200);
      g.fillStyle = "#7c3aed";
      g.fillRect(60, 40, 120, 120);
      return c.toDataURL("image/png").split(",")[1];
    });
    return { name: "first-photo.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
  };

  /* ---------------- a first visit on a desktop ---------------- */
  let ctx = await open();
  let w = EN;
  await step("first visit: Home greets an empty library with the welcome, inside the main landmark, with a heading under the page's and no dialog", async () => {
    await home();
    w = (await words("en")) || EN;
    const panel = welcome(w);
    await panel.waitFor({ timeout: 20000 });
    await wait(600);
    await shot("welcome");
    const info = await panel.evaluate((el) => ({
      inMain: !!el.closest("main"),
      heading: el.querySelector("h2")?.textContent,
      levels: [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1])),
      ways: el.querySelectorAll(".cf-welcome__way").length,
      text: el.innerText,
    }));
    if (!info.inMain) throw new Error("the welcome is not inside the main landmark");
    if (info.heading !== w.title) throw new Error("its heading is " + info.heading);
    if (info.levels[0] !== 1 || info.levels.some((l, i) => i > 0 && l > info.levels[i - 1] + 1)) throw new Error("heading levels " + info.levels.join(","));
    if (info.ways !== 3) throw new Error(info.ways + " ways to begin");
    if (!info.text.includes(w.local)) throw new Error("it does not say that the work stays on this device");
    if (await page.getByRole("dialog").count()) throw new Error("a dialog is open on the first visit");
    // "Sign in to sync" only when an account server is built in
    const server = await accountServer();
    const signIn = await panel.getByRole("button", { name: /Sign in/ }).count();
    if (!!server !== !!signIn) throw new Error(`account server "${server}" and ${signIn} sign-in button(s)`);
    // the rest of Home is all there under it
    if ((await page.locator(".cf-dshortcut").count()) < 5) throw new Error("the shortcut row is missing");
    return `${info.ways} ways, headings ${info.levels.slice(0, 3).join(",")}..., sign in ${signIn ? "offered" : "not offered (no account server)"}`;
  });

  await step("first visit: a blank size opens the Create dialog, and a size chosen there opens the editor", async () => {
    await way("blank").click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ timeout: 8000 });
    await dlg.getByPlaceholder("What would you like to create?").fill("instagram");
    await wait(400);
    await dlg
      .getByRole("button", { name: /Instagram Post/i })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    const size = await page.evaluate(() => `${window.__editor.getState().design.width}x${window.__editor.getState().design.height}`);
    if (size !== "1080x1350") throw new Error("size " + size);
    return size;
  });

  await step("editor: the note on the empty page shows, sits over the canvas at its foot, and lets a click through to the page", async () => {
    const note = hint(w);
    await note.waitFor({ timeout: 10000 });
    await wait(400);
    await shot("editor-hint");
    const r = await note.evaluate((el) => {
      const ws = el.closest("[data-cf-workspace]").getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return { inside: b.left >= ws.left && b.right <= ws.right && b.bottom <= ws.bottom, pe: getComputedStyle(el).pointerEvents, mid: [b.left + b.width / 2, b.top + 20] };
    });
    if (!r.inside) throw new Error("the note is outside the workspace");
    if (r.pe !== "none") throw new Error("the note takes clicks: pointer-events " + r.pe);
    // what is under the note at its middle is not the note: the page gets the click
    const under = await page.evaluate(([x, y]) => !document.elementFromPoint(x, y).closest(".cf-firsthint"), r.mid);
    if (!under) throw new Error("a click on the note's text lands on the note");
    if (await page.getByRole("dialog").count()) throw new Error("a dialog is open in the editor");
    return "pointer-events none, inside the workspace";
  });

  await step("editor: the first element takes the note away, for good (T adds a text)", async () => {
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("t");
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.length > 0, null, { timeout: 8000 });
    await hint(w).waitFor({ state: "detached", timeout: 5000 });
    const kept = await page.evaluate(() => localStorage.getItem("craftly:first-run:canvasHint"));
    if (kept !== "1") throw new Error("not remembered: " + kept);
    // empty again with Delete: the note does not come back
    await page.keyboard.press("Escape");
    await wait(300);
    await page.evaluate(() => {
      const s = window.__editor.getState();
      s.actions.select(s.design.pages[0].elements.map((e) => e.id));
    });
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.length === 0, null, { timeout: 5000 });
    await wait(500);
    if (await hint(w).count()) throw new Error("the note came back on an empty page");
    // something on the page to keep for the next step
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("r");
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.length > 0, null, { timeout: 8000 });
    return `${await elementCount()} element(s), remembered`;
  });

  await step("returning: with a design in the library, Home shows no welcome, also after a reload", async () => {
    // let the autosave write the design
    await page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 }).catch(() => undefined);
    await home();
    await page.getByRole("region", { name: /Recent designs|हाल के डिज़ाइन/ }).waitFor({ timeout: 15000 });
    if (await welcome(w).count()) throw new Error("the welcome shows to somebody with a design");
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-hero__title").waitFor({ timeout: 30000 });
    await wait(1500);
    if (await welcome(w).count()) throw new Error("the welcome shows after a reload");
    await shot("returning-home");
    return "no welcome";
  });
  await ctx.close();

  /* ---------------- the keyboard, dismissing, and reduced motion ---------------- */
  ctx = await open("en", DESKTOP, { reducedMotion: "reduce" });
  await step("keyboard: Tab reaches the three ways and the close button; Enter dismisses; the keyboard stays where the panel was", async () => {
    await home();
    await welcome(w).waitFor({ timeout: 20000 });
    await wait(600);
    const anim = await page.locator(".cf-welcome").evaluate((el) => getComputedStyle(el).animationName);
    if (anim !== "none") throw new Error("with reduced motion the panel still animates: " + anim);
    const reached = new Set();
    for (let i = 0; i < 50 && !["blank", "template", "file", "close"].every((id) => reached.has(id)); i++) {
      await page.keyboard.press("Tab");
      const what = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || !el.closest(".cf-welcome")) return null;
        return el.classList.contains("cf-welcome__way") ? el.dataset.way : el.closest(".cf-welcome__close, .cf-welcome__head button") ? "close" : el.textContent;
      });
      if (what) reached.add(what);
    }
    for (const id of ["blank", "template", "file", "close"]) if (!reached.has(id)) throw new Error(`Tab did not reach ${id}; reached ${[...reached].join(", ")}`);
    // the close button comes first in the panel (it sits by the heading): back to it, then Enter
    await page.getByRole("button", { name: w.dismiss }).focus();
    const ring = await page.evaluate(() => document.activeElement.matches(":focus-visible"));
    await shot("welcome-close-focused");
    await page.keyboard.press("Enter");
    await welcome(w).waitFor({ state: "detached", timeout: 5000 });
    const focus = await page.evaluate(() => (document.activeElement === document.body ? "(body)" : document.activeElement.className));
    if (!/cf-welcome-slot/.test(focus)) throw new Error("the keyboard went to " + focus);
    // the next Tab goes on to the shortcut row, not back to the top of the page
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() =>
      document.activeElement.closest(".cf-dshortcuts") ? "shortcuts" : document.activeElement.getAttribute("aria-label") || document.activeElement.textContent.trim().slice(0, 30),
    );
    if (next !== "shortcuts") throw new Error("the next Tab went to " + next);
    return `reached ${[...reached].join(", ")}; focus ring ${ring ? "shown" : "not shown"}; then the shortcut row`;
  });

  await step("dismissed: after a reload the empty library still shows no welcome", async () => {
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-hero__title").waitFor({ timeout: 30000 });
    await page.locator(".cf-dshortcut").first().waitFor({ timeout: 10000 });
    await wait(1500);
    if (await welcome(w).count()) throw new Error("the welcome is back");
    const kept = await page.evaluate(() => localStorage.getItem("craftly:first-run:welcome"));
    if (kept !== "1") throw new Error("not remembered: " + kept);
    if (await page.getByRole("region", { name: /Recent designs/ }).count()) throw new Error("the library is not empty, so this proves nothing");
    return "empty library, no welcome";
  });

  await step("editor: the note's close button puts it away for good, and the keyboard goes back to the canvas", async () => {
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    const close = page.getByRole("button", { name: w.hintDismiss });
    await close.waitFor({ timeout: 10000 });
    const box = await close.boundingBox();
    if (box.width < 24 || box.height < 24) throw new Error(`the close button is ${box.width} x ${box.height}`);
    await close.focus();
    await page.keyboard.press("Enter");
    await hint(w).waitFor({ state: "detached", timeout: 5000 });
    const focus = await page.evaluate(() => document.activeElement.getAttribute("aria-label"));
    if (focus !== "Design canvas") throw new Error("the keyboard went to " + focus);
    if ((await elementCount()) !== 0) throw new Error("Enter on the close button added something to the page");
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    if (await hint(w).count()) throw new Error("the note is back after a reload on the empty page");
    return `close button ${Math.round(box.width)} x ${Math.round(box.height)} px`;
  });
  await ctx.close();

  /* ---------------- the other two ways to begin ---------------- */
  ctx = await open();
  await step("first visit: Start from a template goes to the Templates page", async () => {
    await home();
    await welcome(w).waitFor({ timeout: 20000 });
    await way("template").click();
    await page.waitForURL(/#\/templates/, { timeout: 8000 });
    await page.locator(".cf-hero__title").waitFor({ timeout: 10000 });
    await wait(600);
    await shot("templates");
    return page.url().replace(/^.*#/, "#");
  });
  await ctx.close();

  ctx = await open();
  await step("first visit: Open a file offers pictures and project files, and a picture starts a design of its own", async () => {
    await home();
    await welcome(w).waitFor({ timeout: 20000 });
    const file = await pngFile();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), way("file").click()]);
    const accept = await chooser.element().getAttribute("accept");
    if (!/\.craftly/.test(accept) || !/image\/png/.test(accept)) throw new Error("the picker accepts " + accept);
    await chooser.setFiles(file);
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.length === 1, null, { timeout: 10000 });
    const d = await page.evaluate(() => {
      const s = window.__editor.getState().design;
      return { title: s.title, type: s.pages[0].elements[0].type };
    });
    if (d.type !== "image") throw new Error("the design holds a " + d.type);
    // a design that starts with something on it shows no note
    await wait(800);
    if (await hint(w).count()) throw new Error("the note shows on a page that has a picture");
    return `"${d.title}", one picture, no note`;
  });
  await ctx.close();

  /* ---------------- a phone, in English and in Hindi ---------------- */
  for (const lang of ["en", "hi"]) {
    ctx = await open(lang, PHONE);
    await home();
    if (!(await words(lang))) {
      results.push(`SKIP [${lang}] phone 375 px  (the catalog is read from src/, which only the dev server serves)`);
      await ctx.close();
      continue;
    }
    await step(`[${lang}] phone 375 px: the welcome fits with no sideways scroll, and the note fits the canvas`, async () => {
      await home();
      const lw = await words(lang);
      if (!lw) throw new Error("the catalog of " + lang + " cannot be read (dev server only)");
      const panel = welcome(lw);
      await panel.waitFor({ timeout: 20000 });
      await wait(800);
      await noSidewaysScroll("Home with the welcome");
      await fitsAcross(panel, "the welcome");
      for (const id of ["blank", "template", "file"]) await fitsAcross(way(id), "the way " + id);
      const close = page.getByRole("button", { name: lw.dismiss });
      const cb = await fitsAcross(close, "the close button");
      if (cb.width < 24 || cb.height < 24) throw new Error(`the close button is ${cb.width} x ${cb.height}`);
      // no word is cut off inside a way
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll(".cf-welcome__way-title, .cf-welcome__way-text, .cf-welcome__title, .cf-welcome__local")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent.slice(0, 30)),
      );
      if (cut.length) throw new Error("cut off: " + cut.join(" | "));
      await shot(lang + "-phone-welcome");
      await page.screenshot({ path: OUT + lang + "-phone-welcome-full.png", fullPage: true });
      // into the editor with a tap on the blank size and the first size of the dialog
      await way("blank").scrollIntoViewIfNeeded();
      const b = await way("blank").boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      const dlg = page.getByRole("dialog");
      await dlg.locator(".cf-tile").first().waitFor({ timeout: 10000 });
      await wait(400);
      const t = await dlg.locator(".cf-tile").first().boundingBox();
      await page.touchscreen.tap(t.x + t.width / 2, t.y + t.height / 2);
      await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
      const note = hint(lw);
      await note.waitFor({ timeout: 10000 });
      await wait(500);
      await noSidewaysScroll("the editor with the note");
      await fitsAcross(note, "the note");
      const keys = await page.locator(".cf-firsthint__keys").evaluate((el) => getComputedStyle(el).display);
      if (keys !== "none") throw new Error("the keys line shows on a phone");
      await shot(lang + "-phone-editor-hint");
      return `title "${lw.title}"`;
    });
    await ctx.close();
  }

  await step("no console errors", async () => {
    if (logs.length) throw new Error(logs.slice(0, 3).join(" | "));
    return "none";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  console.log("Screenshots:", OUT);
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
