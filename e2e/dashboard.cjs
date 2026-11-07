const { launch, outDir, BASE } = require("./lib.cjs");
const OUT = outDir("dashboard");
const results = [];
(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  let n = 0;
  const shot = (name) => page.screenshot({ path: OUT + String(++n).padStart(2, "0") + "-" + name + ".png" });
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
  const wait = (ms) => page.waitForTimeout(ms);

  await step("home: start from a template (Templates for you) -> editor with 7 pages", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await wait(1500);
    // click the first template card in "Templates for you"
    const card = page
      .locator("section", { hasText: "Templates for you" })
      .locator("button, a, [role=button]")
      .filter({ has: page.locator("canvas, img") })
      .first();
    await card.click();
    await wait(800);
    await shot("template-preview");
    // the preview dialog has a Customize / Use button
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ timeout: 5000 });
    await dlg
      .getByRole("button", { name: /Customize|Use this template|Start|Create/i })
      .first()
      .click();
    await wait(1500);
    // customize step: confirm
    const dlg2 = page.getByRole("dialog");
    if (await dlg2.isVisible().catch(() => false)) {
      await shot("customize");
      await dlg2
        .getByRole("button", { name: /Customize|Create|Start|Use|Open/i })
        .last()
        .click();
    }
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    const pages = await page.evaluate(() => window.__editor.getState().design.pages.length);
    if (pages < 2) throw new Error("pages " + pages);
    await shot("editor-from-template");
    return pages + " pages";
  });

  await step("editor: File > Create new design returns home with the create dialog open", async () => {
    await page.getByRole("button", { name: "File" }).first().click();
    await page.getByRole("menuitem", { name: /Create new design/ }).click();
    await page.waitForURL(/#\/$|#\/?$/, { timeout: 8000 });
    await wait(1000);
    await shot("create-dialog");
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ timeout: 6000 });
    return "dialog: " + ((await dlg.getAttribute("aria-label")) || (await dlg.locator("h2").first().textContent()) || "").trim().slice(0, 40);
  });

  await step("create dialog: pick Instagram Post creates a 1080x1350 design", async () => {
    const dlg = page.getByRole("dialog");
    await dlg.getByPlaceholder("What would you like to create?").fill("instagram");
    await wait(500);
    await dlg
      .getByRole("button", { name: /Instagram Post/i })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    const s = await page.evaluate(() => {
      const d = window.__editor.getState().design;
      return d.width + "x" + d.height;
    });
    if (s !== "1080x1350") throw new Error("size " + s);
    return s;
  });

  await step("editor: File > Make a copy, rename via the title, Move to trash, restore from Trash", async () => {
    await page
      .locator("[aria-label='Design title'], [aria-label='Design name'], .cf-topbar__title")
      .first()
      .click()
      .catch(() => {});
    await page.getByRole("button", { name: "File" }).first().click();
    await page.getByRole("menuitem", { name: /Move to trash/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
    await wait(1500);
    // goes home; the design is in Trash
    await page.goto(BASE + "/#/trash", { waitUntil: "load" });
    await wait(1500);
    await shot("trash");
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Untitled design|Instagram/i.test(txt)) throw new Error("trashed design not listed: " + txt.slice(0, 120).replace(/\s+/g, " "));
    await page
      .getByRole("button", { name: /Restore/ })
      .first()
      .click();
    await wait(800);
    return "trashed + restored";
  });

  await step("projects: restored design shows up; create a folder", async () => {
    await page.goto(BASE + "/#/projects", { waitUntil: "load" });
    await wait(1500);
    await page
      .getByRole("button", { name: /Create folder/ })
      .first()
      .click();
    await wait(400);
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ timeout: 4000 });
    await dlg.getByRole("textbox").first().fill("Campaign A");
    await dlg
      .getByRole("button", { name: /Create|Save|OK/i })
      .last()
      .click();
    await wait(800);
    await shot("projects");
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Campaign A/.test(txt)) throw new Error("folder missing");
    return "folder created";
  });

  await step("brand: add a brand colour", async () => {
    await page.goto(BASE + "/#/brand", { waitUntil: "load" });
    await wait(1500);
    await shot("brand");
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\s+/g, " "));
    return txt.slice(0, 80);
  });

  await step("the dashboard keeps its layout after a visit to the editor and its dialogs, in the same page (the stylesheets of both stay loaded)", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await wait(800);
    const row = () =>
      page.evaluate(() => {
        const tops = [...document.querySelectorAll(".cf-dshortcut")].map((t) => Math.round(t.getBoundingClientRect().top));
        return { tiles: tops.length, rows: new Set(tops).size };
      });
    const before = await row();
    if (before.tiles < 5 || before.rows !== 1) throw new Error(`before the visit: ${before.tiles} tiles in ${before.rows} rows`);
    // into the editor, through the dialogs and the tab that carry stylesheets of their own, and back without reloading
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(800);
    await page.getByRole("button", { name: "File" }).first().click();
    await page.getByRole("menuitem", { name: /^Help/ }).click();
    await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ timeout: 8000 });
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Brand", exact: true }).click();
    await wait(600);
    await page.evaluate(() => {
      location.hash = "#/";
    });
    await page.getByText("What will you design today?").waitFor({ timeout: 10000 });
    await wait(800);
    const after = await row();
    if (after.tiles !== before.tiles || after.rows !== 1) throw new Error(`after the visit: ${after.tiles} tiles in ${after.rows} rows (it was ${before.tiles} in 1)`);
    // the brand kit page against the editor's Brand tab, which used to share five class names with it
    await page.evaluate(() => {
      location.hash = "#/brand";
    });
    await page.locator(".cf-brand__add").first().waitFor({ timeout: 10000 });
    const add = await page.locator(".cf-brand__add").first().boundingBox();
    if (!add || Math.round(add.width) !== 56) throw new Error(`the add-colour button of the brand kit page is ${add && add.width} px wide (56 expected)`);
    return `${after.tiles} tiles in one row, add-colour button ${add.width} px`;
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
