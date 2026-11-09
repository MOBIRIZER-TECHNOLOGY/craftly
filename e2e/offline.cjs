/*
 * Offline journey: loads the app, waits for the service worker to store the whole build, goes offline and checks that
 * the editor, the dashboard and a saved design all still open. Needs a PRODUCTION build (the worker is not registered
 * by the dev server):  npm run build && npm run preview   then   BASE=http://127.0.0.1:4173 OFFLINE=1 npm run e2e
 */
const fs = require("node:fs");
const { launch, BASE } = require("./lib.cjs");

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const logs = [];
  const results = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 200)));

  await page.goto(BASE + "/#/", { waitUntil: "load" });
  await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
  // make a design online so there is something saved to reopen
  await page
    .getByRole("button", { name: /^Presentation/ })
    .first()
    .click();
  await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
  await page.getByRole("tab", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: /Add a text box/ }).click();
  await page.keyboard.type("Offline test", { delay: 10 });
  await page.keyboard.press("Escape");

  // wait for the service worker to finish storing the whole build
  let entries = 0;
  for (let i = 0; i < 60 && entries <= 150; i++) {
    entries = await page.evaluate(async () => {
      const keys = await caches.keys();
      return keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
    });
    if (entries <= 150) await page.waitForTimeout(500);
  }
  results.push(
    entries > 150 ? `PASS service worker stored the build  (${entries} files)` : `FAIL service worker stored the build  (${entries} files; is this a production build?)`,
  );
  await page.reload({ waitUntil: "load" }); // from now on the worker controls the page
  await page.waitForTimeout(1500);

  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" }).catch(() => {});
  results.push(
    await page
      .locator(".cf-workspace")
      .waitFor({ timeout: 10000 })
      .then(() => "PASS editor reloads offline")
      .catch(() => "FAIL editor reloads offline"),
  );

  await page.evaluate(() => {
    location.hash = "#/";
  });
  results.push(
    await page
      .getByText("What will you design today?")
      .waitFor({ timeout: 10000 })
      .then(() => "PASS dashboard opens offline")
      .catch(() => "FAIL dashboard opens offline"),
  );

  results.push(
    await page
      .getByText("Recent designs")
      .waitFor({ timeout: 8000 })
      .then(async () => {
        await page.locator("a[href*='#/design/']").first().click();
        await page.locator(".cf-workspace").waitFor({ timeout: 15000 });
        await page.waitForTimeout(1200);
        const canvases = await page.evaluate(() => document.querySelectorAll("canvas").length);
        return canvases > 0 ? "PASS saved design reopens offline" : "FAIL saved design reopens offline  (no canvas)";
      })
      .catch((e) => "FAIL saved design reopens offline  -> " + e.message.split("\n")[0]),
  );

  // the Back up & restore dialog is code that loads when it is first opened: it has to be in the stored build too
  results.push(
    await (async () => {
      try {
        await page.evaluate(() => {
          location.hash = "#/";
        });
        await page.getByText("What will you design today?").waitFor({ timeout: 10000 });
        await page.getByRole("button", { name: "Account" }).first().click();
        await page.getByRole("menuitem", { name: "Back up & restore" }).click();
        const dialog = page.getByRole("dialog", { name: "Back up & restore" });
        await dialog.waitFor({ timeout: 10000 });
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), dialog.getByRole("button", { name: "Download backup" }).click()]);
        const head = fs.readFileSync(await download.path()).subarray(0, 4);
        return head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4
          ? "PASS Back up & restore opens and makes a backup offline"
          : "FAIL Back up & restore opens and makes a backup offline  (the file is not a ZIP)";
      } catch (e) {
        return "FAIL Back up & restore opens and makes a backup offline  -> " + e.message.split("\n")[0];
      }
    })(),
  );

  // combining shapes loads the geometry library (paper.js) when it is first used: that chunk has to be in the stored build too.
  // This step puts its shapes on the page through the store, so it needs the build of e2e/README.md (VITE_EXPOSE_STORE=1).
  results.push(
    await (async () => {
      try {
        await page.keyboard.press("Escape"); // the dialog of the step before is still open
        await page.getByRole("dialog", { name: "Back up & restore" }).waitFor({ state: "hidden", timeout: 5000 });
        await page.getByText("Recent designs").waitFor({ timeout: 10000 });
        await page.locator("a[href*='#/design/']").first().click();
        await page.locator(".cf-workspace").waitFor({ timeout: 15000 });
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
          const { actions } = window.__editor.getState();
          const square = (x, y) => ({
            id: "x",
            type: "shape",
            shape: "rect",
            x,
            y,
            width: 400,
            height: 400,
            rotation: 0,
            opacity: 1,
            fill: { type: "solid", color: "#d9222a" },
            stroke: null,
            radius: 0,
          });
          actions.select(actions.addElements([square(400, 200), square(600, 400)], { center: false, select: false }));
        });
        await page.getByRole("toolbar", { name: "Selected element common controls" }).getByRole("button", { name: "Combine", exact: true }).click();
        await page.getByRole("menuitem", { name: /^Union/ }).click();
        await page.waitForFunction(
          () => {
            const s = window.__editor.getState();
            return s.design.pages.find((p) => p.id === s.activePageId).elements.some((e) => e.shape === "path");
          },
          null,
          { timeout: 15000 },
        );
        return "PASS Combine shapes works offline";
      } catch (e) {
        return "FAIL Combine shapes works offline  -> " + e.message.split("\n")[0];
      }
    })(),
  );

  console.log(results.join("\n"));
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 6)));
  if (results.some((r) => r.startsWith("FAIL")) || logs.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
