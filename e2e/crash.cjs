/*
 * When Craftly stops, in a real browser (docs/CRASH-RECOVERY.md): a design whose state stops the editor and cannot be stored (the
 * store is given pages with no elements, the way a damaged design would, and a function, which a library cannot keep), so that
 * what is stored stays the last autosave; the screen that says what happened and when the design was saved; the problem written
 * down on the device; the report read, copied, downloaded and sent only when the person presses Send (nothing goes before that,
 * no cookies or referrer go with it, and no design or title is in it); a reload that opens the design again, and a second stop
 * within two minutes that says so; going back to the version that was kept before the problem (and the design opening again with
 * its shapes); a copy of the design saved to a file from the crash screen; an error that nothing caught written down and shown
 * in the toast with its details, and what an extension throws ignored; "Report a problem" from the account menu and from the File
 * menu; a part of the app that cannot be fetched.
 *
 * A state that stops the screen and is stored as well makes a design that `openDesign` refuses: the screen then says "We couldn't
 * open this design", and has the way back, the earlier versions (the step near the end of the first half).
 *
 * The page's reports go to /__report (the development server's own address, or the one that the build was made with:
 * VITE_CRAFTLY_REPORT_URL=/__report, see e2e/README.md); the request is answered here, by the browser's routing, so that nothing
 * depends on a server that takes reports.
 */
const fs = require("node:fs");
const { launch, outDir, BASE, isChromium } = require("./lib.cjs");

const OUT = outDir("crash");
const results = [];
let shotN = 0;

(async () => {
  const browser = await launch();
  // no service worker: on a production build it would answer a request that the journey has told the browser to refuse
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, serviceWorkers: "block" });
  // the clipboard permissions are Chromium's: another engine names neither, and refuses the context that asks for them
  if (isChromium) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => undefined);
  const page = await ctx.newPage();
  const sent = [];
  await page.route("**/__report", async (route) => {
    const request = route.request();
    sent.push({ method: request.method(), headers: request.headers(), body: request.postData() });
    await route.fulfill({ status: 204 });
  });
  const shot = (name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);

  const problems = () => page.evaluate(() => JSON.parse(localStorage.getItem("craftly.problems.v1") || "[]"));
  const crashScreen = () => page.locator(".cf-crash");
  const alertText = async () => (await crashScreen().locator('[role="alert"]').innerText()).replace(/\s+/g, " ");
  const shapesOnPage = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      return s.design ? s.design.pages[0].elements.length : -1;
    });
  /**
   * gives the pages no elements, the way a damaged design would: the editor stops at once. The design also gets a function, which
   * IndexedDB cannot keep, so that the state that stopped the editor is not written over the stored one when the editor goes away
   * (the stored design stays the last autosave, and opens again after a reload).
   */
  const damage = () =>
    page.evaluate(() => {
      window.__editor.setState((s) => ({
        design: { ...s.design, pages: s.design.pages.map((p) => ({ ...p, elements: null })), unstorable: () => undefined },
        saveState: "unsaved",
      }));
    });
  /**
   * What is wrong with what is on show inside `selector`, as the browser draws it: text with less contrast than WCAG AA asks for
   * (4.5:1, 3:1 for large text), controls smaller than 24 px, and anything that sticks out past the right edge of the window.
   */
  const inspect = (selector) =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c);
        if (!m) return null;
        const p = m[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
      const background = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c.a > 0) {
            layers.push(c);
            if (c.a === 1) break;
          }
        }
        return layers.reverse().reduce((under, c) => over(c, under), { r: 255, g: 255, b: 255, a: 1 });
      };
      const luminance = ({ r, g, b }) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const faint = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        const el = node.parentElement;
        if (!node.textContent.trim() || !el.getClientRects().length) continue; // nothing to read, or folded away
        const style = getComputedStyle(el);
        const bg = background(el);
        const fg = over({ ...parse(style.color), a: parse(style.color).a * Number(style.opacity) }, bg);
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
        const ratio = (hi + 0.05) / (lo + 0.05);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
        if (ratio < (large ? 3 : 4.5)) faint.push(`"${node.textContent.trim().slice(0, 28)}" ${ratio.toFixed(2)}:1`);
      }
      const small = [];
      const outside = [];
      for (const el of root.querySelectorAll("button, summary, a[href], input, select, textarea, [role=button]")) {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        // folded away: Firefox keeps a box for what a closed <details> hides
        if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true })) continue;
        const name = (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 28);
        if (box.width < 24 || box.height < 24) small.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
        if (box.right > window.innerWidth + 0.5) outside.push(`${name} ends at ${Math.round(box.right)} of ${window.innerWidth}`);
      }
      return { faint, small, outside, scrolls: document.documentElement.scrollWidth > window.innerWidth + 1 };
    }, selector);
  const settle = () => page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 });
  const openEditor = async () => {
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(700);
  };

  /* ---------------- a design that stops the editor ---------------- */
  let designUrl = "";
  await step("a design with three shapes is saved", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await openEditor();
    await page.evaluate(() => {
      const { actions } = window.__editor.getState();
      const square = (x, c) => ({
        id: "x",
        type: "shape",
        shape: "rect",
        x,
        y: 300,
        width: 300,
        height: 300,
        rotation: 0,
        opacity: 1,
        fill: { type: "solid", color: c },
        stroke: null,
        radius: 0,
      });
      actions.addElements([square(200, "#d9222a"), square(700, "#1f4fd8"), square(1200, "#16a34a")], { center: false, select: false });
      actions.setTitle("Quarterly poster");
    });
    await settle();
    designUrl = page.url();
    if ((await shapesOnPage()) !== 3) throw new Error("shapes: " + (await shapesOnPage()));
    return "saved";
  });

  await step("nothing has been sent anywhere, and no problem has been written down", async () => {
    if (sent.length) throw new Error(sent.length + " requests to /__report");
    const list = await problems();
    if (list.length) throw new Error(list.length + " problems before anything went wrong");
    return "clean";
  });

  await step("a damaged state stops the editor: a calm screen that says when the design was saved", async () => {
    await damage();
    await crashScreen().waitFor({ timeout: 10000 });
    // the screen is there at once and reads when the design was saved from the library a moment later: wait for that
    let text = await alertText();
    for (let i = 0; i < 50 && !/last saved at /.test(text); i++) {
      await page.waitForTimeout(100);
      text = await alertText();
    }
    if (!/Something went wrong/.test(text)) throw new Error(text);
    if (!/Craftly stopped unexpectedly\. Your design is saved on this device \(last saved at /.test(text)) throw new Error("text: " + text);
    if (await page.getByRole("button", { name: "Reload Craftly" }).evaluate((b) => document.activeElement !== b)) throw new Error("the first button does not have the keyboard");
    await shot("stopped");
    return text.slice(0, 120);
  });

  await step("the crash screen works with the keyboard alone, its text is readable, its buttons are big enough, and it fits a phone", async () => {
    // the first button has the keyboard already (checked above); Tab goes through the other button and the two folded sections
    const names = [];
    const withoutFocus = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const e = document.activeElement;
        const style = getComputedStyle(e);
        const ring = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
        return { name: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40), shown: e.matches(":focus-visible") && ring };
      });
      names.push(focused.name);
      if (!focused.shown) withoutFocus.push(focused.name);
    }
    if (names.join(" | ") !== "Go to your projects | Go back to an earlier version | Report this problem") throw new Error("Tab order: " + names.join(" | "));
    if (withoutFocus.length) throw new Error("no focus ring on: " + withoutFocus.join(", "));
    // Enter opens a folded section, and Enter closes it again (the steps after this one click it open)
    await page.keyboard.press("Enter");
    if (!(await page.evaluate(() => document.activeElement.closest("details").open))) throw new Error("Enter did not open the report");
    await page.keyboard.press("Enter");
    if (await page.evaluate(() => document.activeElement.closest("details").open)) throw new Error("Enter did not close it");
    await page.getByRole("button", { name: "Reload Craftly" }).focus();
    const wide = await inspect(".cf-crash");
    if (wide.faint.length) throw new Error("text that is hard to read: " + wide.faint.join("; "));
    if (wide.small.length) throw new Error("controls under 24 px: " + wide.small.join("; "));
    await page.setViewportSize({ width: 375, height: 700 });
    const narrow = await inspect(".cf-crash");
    await page.setViewportSize({ width: 1280, height: 800 });
    if (narrow.scrolls || narrow.outside.length) throw new Error("it does not fit a phone: " + (narrow.outside.join("; ") || "the page scrolls sideways"));
    return names.join(" > ");
  });

  await step("the problem is written down on this device, and nothing was sent", async () => {
    const list = await problems();
    if (list.length !== 1 || list[0].kind !== "screen") throw new Error(JSON.stringify(list.map((p) => p.kind)));
    if (/Quarterly poster|d_[a-z0-9]{6}/.test(JSON.stringify(list))) throw new Error("the log holds a title or an id");
    if (sent.length) throw new Error("something was sent");
    return list[0].message.slice(0, 70);
  });

  await step("the report is read as it would be sent, and copied", async () => {
    await page.getByText("Report this problem").click();
    const shown = await page.getByLabel("What a report holds").innerText();
    const report = JSON.parse(shown);
    const keys = Object.keys(report).sort().join(",");
    if (keys !== "app,at,browser,build,count,format,kind,message,online,route,stack,window") throw new Error("fields: " + keys);
    if (report.kind !== "screen" || report.route !== "design") throw new Error(`kind ${report.kind}, route ${report.route}`);
    if (/Quarterly poster|d_[a-z0-9]{6}/.test(shown)) throw new Error("the report holds a title or an id");
    await page.getByRole("button", { name: "Copy report" }).click();
    await page.getByText("Report copied").waitFor({ timeout: 5000 });
    // the clipboard of the system may change the ends of lines: what has to be the same is the report
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (copied !== null && JSON.stringify(JSON.parse(copied)) !== JSON.stringify(report)) throw new Error("the clipboard holds something else: " + copied.slice(0, 80));
    if (sent.length) throw new Error("copying sent something");
    return `${report.browser}, ${report.window}`;
  });

  await step("the report downloads as a file", async () => {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.getByRole("button", { name: "Download report" }).click()]);
    if (download.suggestedFilename() !== "craftly-problem-report.json") throw new Error(download.suggestedFilename());
    const report = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    if (report.app !== "craftly" || report.format !== 1) throw new Error(JSON.stringify(report).slice(0, 80));
    if (sent.length) throw new Error("downloading sent something");
    return download.suggestedFilename();
  });

  await step("Send posts that report, and only when it is pressed: no cookies, no referrer, nothing of the design", async () => {
    if (sent.length) throw new Error("sent before the button was pressed");
    const shown = await page.getByLabel("What a report holds").innerText();
    await page.getByRole("button", { name: "Send report" }).click();
    await page.getByRole("button", { name: "Sent" }).waitFor({ timeout: 5000 });
    await page.getByText("Report sent. Thank you.").waitFor({ timeout: 5000 });
    if (sent.length !== 1) throw new Error(sent.length + " requests");
    const [request] = sent;
    if (request.method !== "POST") throw new Error(request.method);
    if (request.body !== shown) throw new Error("the body is not what was shown");
    if (request.headers.cookie) throw new Error("cookies were sent");
    if (request.headers.referer) throw new Error("a referrer was sent: " + request.headers.referer);
    if (!/^text\/plain/.test(request.headers["content-type"] || "")) throw new Error(request.headers["content-type"]);
    if (/Quarterly poster|d_[a-z0-9]{6}/.test(request.body)) throw new Error("the request holds a title or an id");
    return "one POST, " + request.body.length + " characters";
  });

  /* ---------------- the same design stops it again ---------------- */
  await step("after a reload the design opens again, as it was stored, and stopping it again within two minutes says so", async () => {
    await page.getByRole("button", { name: "Reload Craftly" }).click();
    await openEditor(); // only the new document has a workspace
    const n = await shapesOnPage();
    if (n !== 3) throw new Error("shapes after the reload: " + n);
    await damage();
    await crashScreen().waitFor({ timeout: 15000 });
    const text = await alertText();
    if (!/Craftly stopped again when this design was opened\./.test(text)) throw new Error("text: " + text);
    const details = crashScreen().locator("details", { hasText: "Go back to an earlier version" });
    if (!(await details.evaluate((d) => d.open))) throw new Error("the earlier versions are not open");
    await shot("stopped-again");
    return "stopped again";
  });

  await step("the version from before the problem is listed, and putting it back brings the design back with its shapes", async () => {
    const rows = await crashScreen().locator(".cf-crash__versions li").allInnerTexts();
    if (!rows.some((r) => /Before the problem/.test(r))) throw new Error("rows: " + rows.join(" | "));
    await crashScreen().locator(".cf-crash__versions li", { hasText: "Before the problem" }).getByRole("button", { name: "Use this version" }).click();
    await page.waitForLoadState("load");
    await openEditor();
    const n = await shapesOnPage();
    if (n !== 3) throw new Error("shapes after going back: " + n);
    const title = await page.evaluate(() => window.__editor.getState().design.title);
    if (title !== "Quarterly poster") throw new Error("title " + title);
    await shot("back");
    return "3 shapes, " + title;
  });

  await step("what was there is kept as a version, so that going back can be undone", async () => {
    await page.evaluate(() => window.__editor.getState().actions.openDialog("versions"));
    const dialog = page.getByRole("dialog", { name: "Version history" });
    await dialog.waitFor({ timeout: 5000 });
    await wait(500);
    const text = await dialog.innerText();
    await page.keyboard.press("Escape");
    // the versions dialog lists times; what the labels say is in the store of versions
    const labels = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("craftly");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction("versions", "readonly").objectStore("versions").getAll();
            all.onsuccess = () => resolve(all.result.map((v) => v.label || "(automatic)"));
            all.onerror = () => reject(all.error);
          };
        }),
    );
    if (!labels.includes("Before going back")) throw new Error("labels: " + labels.join(", ") + " | " + text.slice(0, 80));
    return labels.join(", ");
  });

  /* ---------------- a copy of the design from the crash screen ---------------- */
  await step("from the crash screen the design can be saved to a file without opening it", async () => {
    await damage();
    await crashScreen().waitFor({ timeout: 10000 });
    // the earlier versions are open from the second stop on; a click on the summary would close them
    const more = crashScreen().locator("details", { hasText: "Go back to an earlier version" });
    if (!(await more.evaluate((d) => d.open))) await more.locator("summary").click();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "Save a copy of the design to a file" }).click()]);
    if (!/^Quarterly poster.*\.craftly$/.test(download.suggestedFilename())) throw new Error(download.suggestedFilename());
    const file = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    if (file.design.title !== "Quarterly poster") throw new Error("title " + file.design.title);
    await page.getByText("Saved a copy of the design").waitFor({ timeout: 5000 });
    return download.suggestedFilename();
  });

  await step("Go to your projects leaves the crash screen, and the design is still there to open", async () => {
    await page.getByRole("button", { name: "Go to your projects" }).click();
    await page
      .getByText("Recent designs")
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => undefined);
    if ((await crashScreen().count()) !== 0) throw new Error("the crash screen is still there");
    return page.url().replace(BASE, "");
  });

  /* ---------------- a design that is stored damaged ---------------- */
  /** whether a design in the library has pages with no elements: what the editor writes over the design when the screen stops with such a state */
  const storedDamaged = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("craftly");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction("designs", "readonly").objectStore("designs").getAll();
            all.onsuccess = () => resolve(all.result.some((d) => d.pages.some((p) => p.elements === null)));
            all.onerror = () => reject(all.error);
          };
        }),
    );
  await step("a design that was stored damaged is refused with the way back on the screen that says so: the earlier versions, read and put back", async () => {
    await page.goto(designUrl, { waitUntil: "load" });
    await openEditor();
    // this time nothing keeps the state from being stored (no function in it): the editor keeps the stored design as a version, then writes this over it
    await page.evaluate(() => {
      window.__editor.setState((s) => ({ design: { ...s.design, pages: s.design.pages.map((p) => ({ ...p, elements: null })) }, saveState: "unsaved" }));
    });
    await crashScreen().waitFor({ timeout: 10000 });
    for (let i = 0; i < 50 && !(await storedDamaged()); i++) await wait(200);
    if (!(await storedDamaged())) throw new Error("the damaged state was not written over the design");
    await page.getByRole("button", { name: "Reload Craftly" }).click();
    await page.getByText("We couldn't open this design").waitFor({ timeout: 20000 });
    const panel = page.locator(".cf-editor-state details", { hasText: "Go back to an earlier version" });
    if (!(await panel.evaluate((d) => d.open))) throw new Error("the earlier versions are not open");
    const rows = await panel.locator(".cf-crash__versions li").allInnerTexts();
    if (!rows.some((r) => /Before the problem/.test(r))) throw new Error("rows: " + rows.join(" | "));
    await shot("cannot-open");
    // readable, big enough, and on a phone it fits
    const seen = await inspect(".cf-editor-state");
    if (seen.faint.length) throw new Error("text that is hard to read: " + seen.faint.join("; "));
    if (seen.small.length) throw new Error("controls under 24 px: " + seen.small.join("; "));
    await page.setViewportSize({ width: 375, height: 700 });
    const narrow = await inspect(".cf-editor-state");
    await shot("cannot-open-375");
    await page.setViewportSize({ width: 1280, height: 800 });
    if (narrow.scrolls || narrow.outside.length) throw new Error("it does not fit a phone: " + (narrow.outside.join("; ") || "the page scrolls sideways"));
    // the version from before the problem is put back, and the design opens with its shapes
    // (every stop kept one: the newest is a copy of the design as it was stored before the damaged state was written over it)
    await panel.locator(".cf-crash__versions li", { hasText: "Before the problem" }).first().getByRole("button", { name: "Use this version" }).click();
    await openEditor();
    const n = await shapesOnPage();
    if (n !== 3) throw new Error("shapes after going back: " + n);
    if (await storedDamaged()) throw new Error("the design is still stored damaged");
    return "refused, read, put back: " + n + " shapes";
  });

  /* ---------------- what nothing caught ---------------- */
  await step("an error that nothing caught is written down and shown, with a way to its details", async () => {
    await page.goto(designUrl.replace(/#\/design\/.*/, "#/"), { waitUntil: "load" }).catch(() => undefined);
    await page.evaluate(() => localStorage.removeItem("craftly.problems.v1"));
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error("A handler failed on purpose");
      }, 0),
    );
    await page.getByText("Something unexpected went wrong. If something does not work, reload the page.").waitFor({ timeout: 5000 });
    const list = await problems();
    if (list.length !== 1 || list[0].kind !== "script" || list[0].message !== "A handler failed on purpose") throw new Error(JSON.stringify(list));
    await page.getByRole("button", { name: "Details" }).click();
    const dialog = page.getByRole("dialog", { name: "Report a problem" });
    await dialog.waitFor({ timeout: 5000 });
    const shown = await dialog.getByLabel("What a report holds").innerText();
    if (!/A handler failed on purpose/.test(shown)) throw new Error("the dialog shows another problem");
    await shot("dialog");
    // readable, big enough, and on a phone the report goes under the list instead of beside it
    const seen = await inspect('[role="dialog"]');
    if (seen.faint.length) throw new Error("text that is hard to read: " + seen.faint.join("; "));
    if (seen.small.length) throw new Error("controls under 24 px: " + seen.small.join("; "));
    await page.setViewportSize({ width: 594, height: 800 });
    const narrow = await inspect('[role="dialog"]');
    const stacked = await page.evaluate(() => {
      const list = document.querySelector(".cf-problems__list")?.getBoundingClientRect();
      const report = document.querySelector(".cf-report")?.getBoundingClientRect();
      return !!list && !!report && report.top >= list.bottom - 1;
    });
    await shot("dialog-594");
    await page.setViewportSize({ width: 1280, height: 800 });
    if (narrow.scrolls || narrow.outside.length) throw new Error("the dialog does not fit 594 px: " + (narrow.outside.join("; ") || "the page scrolls sideways"));
    if (!stacked) throw new Error("at 594 px the report is not under the list");
    return "script, 1 listed, readable, fits 594 px";
  });

  await step("a failure that nothing waited for is written down too, and what an extension throws is not", async () => {
    await page.evaluate(() => {
      Promise.reject(new Error("A promise failed on purpose"));
      window.dispatchEvent(new ErrorEvent("error", { message: "from an extension", filename: "chrome-extension://abcdef/content.js" }));
      window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    });
    await wait(400);
    const messages = (await problems()).map((p) => p.message);
    if (!messages.includes("A promise failed on purpose")) throw new Error(messages.join(" | "));
    if (messages.some((m) => /extension|Script error/.test(m))) throw new Error("noise was kept: " + messages.join(" | "));
    return messages.length + " problems";
  });

  await step("the dialog clears the list", async () => {
    const dialog = page.getByRole("dialog", { name: "Report a problem" });
    await dialog.getByRole("button", { name: "Clear the list" }).click();
    await dialog.getByText("No problems have been recorded on this device.").waitFor({ timeout: 3000 });
    if ((await problems()).length !== 0) throw new Error("the list is not empty");
    await dialog.getByRole("button", { name: "Close" }).last().click();
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
    return "cleared";
  });

  /* ---------------- the menus ---------------- */
  await step("Report a problem is in the account menu of the dashboard", async () => {
    await page.getByRole("button", { name: "Account" }).first().click();
    await page.getByRole("menuitem", { name: "Report a problem" }).click();
    await page.getByRole("dialog", { name: "Report a problem" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Report a problem" }).waitFor({ state: "hidden", timeout: 3000 });
    return "opens";
  });

  await step("Report a problem is under File, Help in the editor", async () => {
    await page.goto(designUrl, { waitUntil: "load" });
    await openEditor();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Help/ }).click();
    await page.getByRole("menuitem", { name: /^Report a problem/ }).click();
    await page.getByRole("dialog", { name: "Report a problem" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    return "opens";
  });

  /* ---------------- a part of the app that cannot be fetched ---------------- */
  await step("a part of Craftly that cannot be fetched is said so, and a reload brings it back", async () => {
    // a fresh document that is refused the editor from its first request: the dashboard loads, and the editor is fetched when a design is opened
    // the module of the editor: src/editor/Editor.tsx on the development server, assets/Editor-<hash>.js in a build (not ChartEditor.tsx and the like)
    const editorChunk = /\/Editor(?:-[^/]*)?\.(?:js|tsx)(?:\?.*)?$/;
    await page.goto("about:blank");
    await page.route(editorChunk, (route) => route.abort("failed"));
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page.evaluate(() => {
      window.location.hash = "#/design/not-a-real-design";
    });
    await crashScreen().waitFor({ timeout: 10000 });
    const heading = await crashScreen().getByRole("heading").innerText();
    if (!/A part of Craftly could not load/.test(heading)) throw new Error("heading: " + heading);
    const text = await alertText();
    if (!/Check your connection, then reload/.test(text)) throw new Error(text);
    const kinds = (await problems()).map((p) => p.kind);
    if (!kinds.includes("load")) throw new Error("kinds: " + kinds.join(","));
    await shot("could-not-load");
    await page.unroute(editorChunk);
    await page.getByRole("button", { name: "Reload Craftly" }).click();
    await page.getByText("We couldn't find this design").waitFor({ timeout: 20000 });
    return "load problem, then the editor opened again";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
