/*
 * WORK IN PROGRESS, NOT PART OF `npm run e2e` YET (it is not listed in run-all.cjs). Run it alone: `node e2e/crash.cjs`. On
 * 2026-11-09 the first nine steps passed and the rest did not; why, and what to do about each step, is in the "Status and
 * what is left" section of docs/CRASH-RECOVERY.md. The main trouble: `damage()` below stops the editor once, but the damaged
 * design is then refused when it is opened again (the editor says "We couldn't open this design" instead of stopping again),
 * so the steps that need a second stop never see one.
 *
 * When Craftly stops, in a real browser: a design whose state stops the editor (the store is given pages with no elements, the way
 * a damaged design would), the screen that says what happened and when the design was saved, a reload that stops again and
 * says so, going back to the version that was kept before the problem (and the design opening again with its shapes), a copy of
 * the design saved to a file from the crash screen, the report of the problem read, copied, downloaded and sent only when the
 * person presses Send (nothing goes before that, no cookies or referrer go with it, and no design or title is in it), an error
 * that nothing caught written down and shown in the toast with its details, what an extension throws ignored, "Report a problem"
 * from the File menu and from the account menu, a part of the app that cannot be fetched.
 *
 * The page's reports go to /__report (the development server's own address, or the one that the build was made with:
 * VITE_CRAFTLY_REPORT_URL=/__report, see e2e/README.md); the request is answered here, by the browser's routing, so that nothing
 * depends on a server that takes reports.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("crash");
const results = [];
let shotN = 0;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => undefined);
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
  /** gives the pages no elements, the way a damaged design would: the editor stops at once */
  const damage = () =>
    page.evaluate(() => {
      window.__editor.setState((s) => ({ design: { ...s.design, pages: s.design.pages.map((p) => ({ ...p, elements: null })) }, saveState: "unsaved" }));
    });
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
    const text = await alertText();
    if (!/Something went wrong/.test(text)) throw new Error(text);
    if (!/Craftly stopped unexpectedly\. Your design is saved on this device \(last saved at /.test(text)) throw new Error("text: " + text);
    if (await page.getByRole("button", { name: "Reload Craftly" }).evaluate((b) => document.activeElement !== b)) throw new Error("the first button does not have the keyboard");
    await shot("stopped");
    return text.slice(0, 120);
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
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (copied !== null && copied !== shown) throw new Error("the clipboard holds something else");
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
  await step("the damaged design was written when the editor went away, and reloading stops Craftly again, and says so", async () => {
    await page.getByRole("button", { name: "Reload Craftly" }).click();
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
    await crashScreen().getByText("Go back to an earlier version").click();
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
    return "script, 1 listed";
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
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page.route(/Editor[-.][^/]*\.(?:js|tsx)(?:\?.*)?$/, (route) => route.abort("failed"));
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
    await page.unroute(/Editor[-.][^/]*\.(?:js|tsx)(?:\?.*)?$/);
    await page.getByRole("button", { name: "Reload Craftly" }).click();
    await page.waitForLoadState("load");
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
