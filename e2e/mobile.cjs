/*
 * Craftly on a phone and a tablet, as a person uses it with a finger, in English and in Hindi (the longer words): no page
 * scrolls sideways; every tab of the editor's tab bar can be reached (the bar scrolls sideways, and its chevron says so) and
 * opens its panel; the controls of the top bar are on the screen and at least 24 px; the context toolbar of a text and of a
 * shape fits the screen; the File menu, Share, the Download panel, the Create dialog and the presenter fit inside the screen;
 * and a design is made, a text is added and edited, and a PNG is downloaded, all by taps on a 375 x 812 touch screen.
 * Taps are made at points of the screen (`page.touchscreen.tap`), never with Playwright's own scrolling into view, so that
 * a control that is off the screen fails instead of being brought in for us.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("mobile");
const results = [];
const logs = [];
let shotN = 0;

const PHONE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const TEXT = { en: "Hello from a phone", hi: "फ़ोन से नमस्ते" };

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

  /** a new touch screen with its own storage, in language `lang` */
  const open = async (lang, viewport, phone) => {
    const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: phone, locale: lang === "hi" ? "hi-IN" : "en-US", acceptDownloads: true });
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

  /** the catalog of `lang`, as the dev server serves it */
  const catalog = (lang) =>
    page.evaluate(async (l) => {
      const mod = await import(`/src/i18n/${l}/index.ts`);
      const c = mod[l];
      return {
        file: c.editorChrome.fileMenu.file,
        addTextBox: c.panelsTabs.text.addTextBox,
        shareDownload: c.editorChrome.share.download,
        download: c.exporting.panel.download,
      };
    }, lang);

  /** throws when the page scrolls sideways */
  const noSidewaysScroll = async (where) => {
    const [sw, cw] = await page.evaluate(() => [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth]);
    if (sw > cw + 1) throw new Error(`${where}: the page is ${sw} px wide in a ${cw} px screen`);
  };
  /** throws when `locator`'s box is not wholly inside the screen; gives the box */
  const inScreen = async (locator, what) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(what + " is not on the page");
    const { width, height } = page.viewportSize();
    if (box.x < -0.5 || box.y < -0.5 || box.x + box.width > width + 0.5 || box.y + box.height > height + 0.5)
      throw new Error(`${what} is at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}, outside the ${width}x${height} screen`);
    return box;
  };
  /** a tap in the middle of `locator`, which must be on the screen */
  const tap = async (locator, what) => {
    const box = await inScreen(locator, what);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  const editor = (fn) => page.evaluate(fn);

  /** the rail's tabs as they are now: id, label, box, whether the label is cut off */
  const tabsNow = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".cf-leftrail__tab")).map((t) => {
        const b = t.getBoundingClientRect();
        const list = t.parentElement.getBoundingClientRect();
        const label = t.querySelector(".cf-leftrail__label");
        return {
          id: t.id.replace("cf-tab-", ""),
          label: label.textContent,
          left: b.left,
          right: b.right,
          w: b.width,
          h: b.height,
          inView: b.left >= list.left - 0.5 && b.right <= list.right + 0.5,
          cut: label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1,
        };
      }),
    );
  /** taps the chevrons of the tab bar until the tab `id` is wholly in view; gives the number of taps */
  const reveal = async (id) => {
    for (let taps = 0; taps < 6; taps++) {
      const tab = (await tabsNow()).find((t) => t.id === id);
      if (tab.inView) return taps;
      const side = tab.right > page.viewportSize().width / 2 ? "r" : "l";
      const more = page.locator(".cf-leftrail__more--" + side);
      const opacity = await more.evaluate((el) => getComputedStyle(el).opacity);
      if (opacity !== "1") throw new Error(`the ${id} tab is out of view and there is no chevron on the ${side === "r" ? "right" : "left"}`);
      await tap(more, "the chevron of the tab bar");
      await wait(600);
    }
    throw new Error(`the ${id} tab could not be brought into view`);
  };
  /** the top bar: every control on the screen, in the bar, at least 24 x 24 px */
  const topBarFits = async () => {
    const r = await page.evaluate(() => {
      const bar = document.querySelector(".cf-topbar");
      const out = { overflow: bar.scrollWidth - bar.clientWidth, bad: [], n: 0 };
      for (const b of bar.querySelectorAll("button, a[href], input")) {
        const s = getComputedStyle(b);
        const box = b.getBoundingClientRect();
        if (s.display === "none" || s.visibility === "hidden" || box.width === 0) continue;
        out.n++;
        const name = b.getAttribute("aria-label") || b.textContent.trim();
        if (box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight)
          out.bad.push(`${name} off the screen (${Math.round(box.left)}..${Math.round(box.right)})`);
        if (box.width < 24 || box.height < 24) out.bad.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      return out;
    });
    if (r.overflow > 1) throw new Error(`the top bar's controls are ${r.overflow} px wider than the bar`);
    if (r.bad.length) throw new Error(r.bad.join("; "));
    return r.n;
  };

  for (const lang of ["en", "hi"]) {
    const ctx = await open(lang, PHONE, true);
    const words = await (async () => {
      await page.goto(BASE + "/#/", { waitUntil: "load" });
      await page.locator(".cf-dash").waitFor({ timeout: 40000 });
      return catalog(lang);
    })();

    /* ---------------- the dashboard ---------------- */
    await step(`[${lang}] dashboard: Home, Templates, Projects, Brand and Trash do not scroll sideways on a phone`, async () => {
      for (const route of ["", "templates", "projects", "brand", "trash"]) {
        await page.goto(BASE + "/#/" + route, { waitUntil: "load" });
        await page.locator(".cf-dash").waitFor({ timeout: 40000 });
        await wait(900);
        await noSidewaysScroll("#/" + route);
        const items = page.locator(".cf-dtabbar a, .cf-dtabbar button");
        for (let i = 0; i < (await items.count()); i++) await inScreen(items.nth(i), "the tab bar's item " + i);
      }
      await shot(lang + "-dashboard-trash");
      return "5 pages, tab bar on the screen";
    });

    await step(`[${lang}] the Create dialog fits the screen and a tap on a design type makes a design`, async () => {
      await page.goto(BASE + "/#/", { waitUntil: "load" });
      await page.locator(".cf-dash").waitFor({ timeout: 40000 });
      await wait(600);
      await tap(page.locator(".cf-dtabbar__create-btn"), "the Create button");
      const dialog = page.getByRole("dialog");
      await dialog.locator(".cf-tile").first().waitFor();
      await wait(500);
      await inScreen(dialog, "the Create dialog");
      await noSidewaysScroll("the Create dialog");
      await shot(lang + "-create-dialog");
      await tap(dialog.locator(".cf-tile").first(), "the first design type");
      await page.waitForURL(/#\/design\//, { timeout: 20000 });
      await page.locator(".cf-workspace").waitFor({ timeout: 30000 });
      await wait(1200);
      return page.url().split("#")[1];
    });

    /* ---------------- the editor's frame ---------------- */
    await step(`[${lang}] editor: no sideways scroll; every top-bar control is on the screen and at least 24 px`, async () => {
      await noSidewaysScroll("the editor");
      const n = await topBarFits();
      await shot(lang + "-editor");
      return n + " controls";
    });

    await step(`[${lang}] every tab of the tab bar is reached with taps and opens its panel; no label is cut off`, async () => {
      const tabs = await tabsNow();
      if (tabs.length !== 8) throw new Error(tabs.length + " tabs");
      const outOfView = tabs.filter((t) => !t.inView).map((t) => t.label);
      let chevronTaps = 0;
      for (const { id } of tabs) {
        chevronTaps += await reveal(id);
        const t = (await tabsNow()).find((x) => x.id === id);
        if (t.cut) throw new Error(`the label "${t.label}" is cut off`);
        if (t.w < 24 || t.h < 24) throw new Error(`the ${t.label} tab is ${t.w}x${t.h}`);
        await tap(page.locator("#cf-tab-" + id), "the " + t.label + " tab");
        await wait(900);
        if (id === "tools") {
          const card = page.locator(".cf-tools__card");
          await card.waitFor({ timeout: 5000 });
          await inScreen(card, "the tool palette");
          // the palette leaves the bottom bar's buttons free
          const covered = await page.evaluate(() => {
            const hit = [];
            for (const b of document.querySelectorAll(".cf-bottombar button")) {
              const r = b.getBoundingClientRect();
              if (!r.width) continue;
              const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              if (at && !b.contains(at)) hit.push(b.getAttribute("aria-label") || b.textContent.trim());
            }
            return hit;
          });
          if (covered.length) throw new Error("the tool palette covers " + covered.join(", "));
          await shot(lang + "-tab-tools");
          await tap(page.locator("#cf-tab-tools"), "the Tools tab");
          await wait(400);
        } else {
          const panel = page.locator("#cf-tabpanel-" + id);
          await panel.waitFor({ state: "visible", timeout: 8000 });
          await wait(400); // the sheet slides up
          await inScreen(panel, "the " + t.label + " panel");
          await noSidewaysScroll("the " + t.label + " panel");
          await shot(lang + "-tab-" + id);
        }
      }
      // fold the sheet away again with its handle
      await tap(page.locator(".cf-sidepanel__handle"), "the handle of the panel");
      await wait(600);
      return `8 panels; out of view at first: ${outOfView.join(", ") || "none"}; ${chevronTaps} taps on the chevrons`;
    });

    /* ---------------- a text ---------------- */
    await step(`[${lang}] a text is added from the Text tab and edited by typing, on a touch screen`, async () => {
      await reveal("text");
      await tap(page.locator("#cf-tab-text"), "the Text tab");
      const add = page.locator("#cf-tabpanel-text").getByRole("button", { name: words.addTextBox, exact: true });
      await add.waitFor({ timeout: 8000 });
      await wait(400);
      await tap(add, "Add a text box");
      await page.waitForFunction(() => !!window.__editor.getState().editingTextId, null, { timeout: 8000 });
      await page.locator(".cf-texteditor").waitFor();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText(TEXT[lang]);
      await wait(300);
      await shot(lang + "-text-editing");
      await page.keyboard.press("Escape");
      await wait(500);
      const texts = await editor(() => {
        const s = window.__editor.getState();
        const pg = s.design.pages.find((p) => p.id === s.activePageId);
        return pg.elements.filter((e) => e.type === "text").map((e) => e.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n"));
      });
      if (!texts.includes(TEXT[lang])) throw new Error("the texts of the page: " + JSON.stringify(texts));
      return JSON.stringify(TEXT[lang]);
    });

    await step(`[${lang}] the context toolbar of the selected text fits the screen`, async () => {
      await editor(() => {
        const s = window.__editor.getState();
        const pg = s.design.pages.find((p) => p.id === s.activePageId);
        s.actions.select([pg.elements.find((e) => e.type === "text").id]);
      });
      await wait(700);
      const bar = page.locator("[data-cf-toolbar]").first();
      await bar.waitFor({ timeout: 5000 });
      const box = await inScreen(bar, "the text toolbar");
      await noSidewaysScroll("the text toolbar");
      await shot(lang + "-text-toolbar");
      return `${Math.round(box.width)} px wide`;
    });

    await step(`[${lang}] the selected text opens for editing again with a double tap`, async () => {
      // the text is in the middle of a page that is shown small on a phone: zoom in so a finger can hit it
      await editor(() => window.__editor.getState().actions.clearSelection());
      const id = await editor(() => {
        const s = window.__editor.getState();
        return s.design.pages.find((p) => p.id === s.activePageId).elements.find((e) => e.type === "text").id;
      });
      await editor(() => window.__editor.getState().actions.setZoom(0.4));
      await wait(600);
      /** the middle of the text on the screen, after scrolling the workspace to bring it there */
      const pt = await page.evaluate(async (elId) => {
        const s = window.__editor.getState();
        const el = s.design.pages.find((p) => p.id === s.activePageId).elements.find((e) => e.id === elId);
        const at = () => {
          const frame = document.querySelector(".cf-pageframe").getBoundingClientRect();
          return { x: frame.left + (el.x + el.width / 2) * s.zoom, y: frame.top + (el.y + el.height / 2) * s.zoom };
        };
        const scroller = document.querySelector(".cf-workspace__scroll");
        const ws = scroller.getBoundingClientRect();
        const before = at();
        scroller.scrollBy(before.x - (ws.left + ws.width / 2), before.y - (ws.top + ws.height / 2));
        await new Promise((r) => setTimeout(r, 300));
        return { ...at(), h: el.height * s.zoom };
      }, id);
      if (pt.h < 16) throw new Error(`the text is ${pt.h} px high on the screen`);
      // a tap selects the text, as a person sees it chosen before the double tap
      await page.touchscreen.tap(pt.x, pt.y);
      await page.waitForFunction((elId) => window.__editor.getState().selection.includes(elId), id, { timeout: 5000 });
      await wait(800);
      // Two taps in quick succession make a double click. The emulated touch screen sends the second tap only once the page has
      // handled the first, so on a busy (slow) machine the pair can come too far apart to count: a person would tap again too.
      let tries = 0;
      for (; tries < 3; tries++) {
        await page.touchscreen.tap(pt.x, pt.y);
        await wait(60);
        await page.touchscreen.tap(pt.x, pt.y);
        const editing = await page
          .waitForFunction((elId) => window.__editor.getState().editingTextId === elId, id, { timeout: 2000 })
          .then(() => true)
          .catch(() => false);
        if (editing) break;
        await wait(700);
      }
      if (tries === 3) throw new Error("three double taps did not open the text for editing");
      await shot(lang + "-text-double-tap");
      await page.keyboard.press("Escape");
      await wait(300);
      await editor(() => window.__editor.getState().actions.setZoomMode("fit"));
      await wait(400);
      return `editing ${id} (${Math.round(pt.h)} px high) after ${tries + 1} double tap${tries ? "s" : ""}`;
    });

    await step(`[${lang}] the context toolbar of a selected shape fits the screen`, async () => {
      await editor(() => {
        const { actions } = window.__editor.getState();
        actions.addElements(
          [
            {
              id: "x",
              type: "shape",
              shape: "rect",
              x: 300,
              y: 300,
              width: 400,
              height: 300,
              rotation: 0,
              opacity: 1,
              fill: { type: "solid", color: "#3b82f6" },
              stroke: null,
              radius: 0,
            },
          ],
          { center: true, select: true },
        );
      });
      await wait(700);
      const bar = page.locator("[data-cf-toolbar]").first();
      await bar.waitFor({ timeout: 5000 });
      const box = await inScreen(bar, "the shape toolbar");
      await noSidewaysScroll("the shape toolbar");
      await shot(lang + "-shape-toolbar");
      await editor(() => window.__editor.getState().actions.clearSelection());
      await wait(300);
      return `${Math.round(box.width)} px wide`;
    });

    /* ---------------- menus and dialogs ---------------- */
    await step(`[${lang}] the File menu fits the screen and its last entry can be reached`, async () => {
      await tap(page.locator(".cf-topbar button").filter({ hasText: words.file }).first(), "the File button");
      const menu = page.getByRole("menu").first();
      await menu.waitFor({ timeout: 5000 });
      await wait(400);
      // the popover that holds the menu fits the screen and scrolls when the menu is taller
      await inScreen(page.locator(".cf-popover.cf-filemenu"), "the File menu");
      const last = menu.getByRole("menuitem").last();
      await last.scrollIntoViewIfNeeded();
      await inScreen(last, "the last entry of the File menu");
      const entries = await menu.getByRole("menuitem").count();
      await shot(lang + "-file-menu");
      await page.keyboard.press("Escape");
      await wait(400);
      return entries + " entries";
    });

    await step(`[${lang}] Share and its Download panel fit the screen, and a PNG is downloaded`, async () => {
      await tap(page.locator(".cf-topbar__share"), "Share");
      const tile = page.getByRole("button", { name: words.shareDownload, exact: true }).first();
      await tile.waitFor({ timeout: 5000 });
      await wait(400);
      const pop = page.locator(".cf-popover").filter({ has: tile });
      await inScreen(pop, "the Share popover");
      await shot(lang + "-share");
      await tap(tile, "Download in Share");
      const panel = page.locator(".cf-dl");
      await panel.waitFor({ timeout: 8000 });
      await wait(500);
      await noSidewaysScroll("the Download panel");
      const button = panel.getByRole("button", { name: words.download, exact: true });
      await button.scrollIntoViewIfNeeded();
      await inScreen(button, "the Download button");
      await shot(lang + "-download");
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), tap(button, "the Download button")]);
      const name = dl.suggestedFilename();
      const bytes = fs.readFileSync(await dl.path());
      if (!name.endsWith(".png")) throw new Error("the file is " + name);
      if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG: " + bytes.subarray(0, 8).toString("hex"));
      await page.keyboard.press("Escape");
      await wait(400);
      return `${name}, ${bytes.length} bytes`;
    });

    await step(`[${lang}] the page strip is on the screen and a page is added with a tap`, async () => {
      if (!(await editor(() => window.__editor.getState().showPageStrip))) await editor(() => window.__editor.getState().actions.toggle("showPageStrip"));
      await wait(500);
      const add = page.locator(".cf-strip__add-main");
      await tap(add, "Add page");
      await page.waitForFunction(() => window.__editor.getState().design.pages.length === 2, null, { timeout: 5000 });
      await wait(500);
      await inScreen(page.locator(".cf-strip__thumb").last(), "the new page's thumbnail");
      await shot(lang + "-page-strip");
      return "2 pages";
    });

    await step(`[${lang}] Present fills the screen and its controls fit`, async () => {
      await tap(page.locator(".cf-topbar__split-main"), "Present");
      const present = page.locator(".cf-present");
      await present.waitFor({ timeout: 8000 });
      await wait(1200);
      const buttons = present.locator("button:visible");
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const box = await inScreen(b, "the presenter's button " + ((await b.getAttribute("aria-label")) || i));
        if (box.width < 24 || box.height < 24) throw new Error(`the presenter's button ${await b.getAttribute("aria-label")} is ${box.width}x${box.height}`);
      }
      await shot(lang + "-present");
      await page.keyboard.press("Escape");
      await present.waitFor({ state: "detached", timeout: 8000 });
      await wait(400);
      return n + " buttons";
    });

    await ctx.close();
  }

  /* ---------------- a tablet ---------------- */
  for (const lang of ["en", "hi"]) {
    const ctx = await open(lang, TABLET, false);
    await step(`[${lang}] tablet 768 x 1024: the whole tab bar shows without chevrons, the top bar fits, nothing scrolls sideways`, async () => {
      await page.goto(BASE + "/#/", { waitUntil: "load" });
      await page.locator(".cf-dash").waitFor({ timeout: 40000 });
      await noSidewaysScroll("the dashboard");
      await tap(page.locator(".cf-dnav__create-btn:visible, .cf-dnav__create-wide:visible").first(), "the Create button");
      const dialog = page.getByRole("dialog");
      await dialog.locator(".cf-tile").first().waitFor();
      await inScreen(dialog, "the Create dialog");
      await tap(dialog.locator(".cf-tile").first(), "the first design type");
      await page.locator(".cf-workspace").waitFor({ timeout: 30000 });
      await wait(1200);
      await noSidewaysScroll("the editor");
      const tabs = await tabsNow();
      const hidden = tabs.filter((t) => !t.inView || t.cut).map((t) => t.label);
      if (hidden.length) throw new Error("out of view or cut off: " + hidden.join(", "));
      const chevrons = await page.evaluate(() => Array.from(document.querySelectorAll(".cf-leftrail__more")).filter((e) => getComputedStyle(e).opacity !== "0").length);
      if (chevrons) throw new Error(chevrons + " chevrons shown");
      const n = await topBarFits();
      await shot(lang + "-tablet");
      return `8 tabs, ${n} top-bar controls`;
    });
    await ctx.close();
  }

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 4).join(" | "));
    return "clean";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
