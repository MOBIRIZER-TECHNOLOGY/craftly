/*
 * What was added on 2026-11-23, as a person uses it in a real browser, each read back from the design or from the page:
 *
 *   Bulk create      rows pasted into Apps > Bulk create, a text box for a column from its button, a page for every row
 *                    with the names in braces filled, the pages named after the first column, one Undo for all of them
 *   Charts           Stack the series and the two axis titles in the Data panel
 *   Shape options    the sides of a polygon from its toolbar
 *   Font weight      Weight in the Font panel
 *   Link             Link in the "..." menu: a web address stored in full, an address that could run code refused
 *   Crop             a fixed shape for the frame from the crop toolbar
 *   Frame shape      a picture on the page cut to a circle from the image toolbar
 *   Margins          File > Rulers and guides > Show margins draws the frame of margins
 *   Spell-check      File > Check spelling while typing sets the attribute of the text editor, and is remembered
 *   Accessibility    File > Check accessibility finds a pale text and a picture without alternative text
 *   Presenter        the clock of the show and the pointer on L
 */
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("additions");
const results = [];
const logs = [];
let shotN = 0;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  const shot = (name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
      // whatever was open is closed, so that the next step starts from the page
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);
  /** The design, or a part of it, straight from the editor's store. */
  const design = (fn) => page.evaluate(`(${fn})(window.__editor.getState())`);
  const edit = (fn, arg) => page.evaluate(`(${fn})(window.__editor.getState().actions, ${JSON.stringify(arg ?? null)})`);
  const textOf = "(el) => el.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\\n')";
  const openFile = async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menu", { name: "File" }).waitFor({ timeout: 5000 });
  };
  /** The toolbar of the selected element. */
  const toolbar = page.locator(".cf-tb").first();

  await step("setup: a new presentation", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    return "open";
  });

  /* ---------------- Bulk create ---------------- */
  await step("Bulk create: rows are read, and a button puts a column on the page in braces", async () => {
    await page.getByRole("tab", { name: "Apps", exact: true }).click();
    await page.getByRole("button", { name: /^Bulk create\./ }).click();
    await page.getByRole("heading", { name: "Bulk create" }).waitFor({ timeout: 5000 });
    await page.getByRole("textbox", { name: "Data to import" }).fill("Name,Role\nAda Lovelace,Engineer\nGrace Hopper,Rear admiral\nAlan Turing,Mathematician");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("button", { name: "Add a text box with {{Name}}" }).click();
    await page.getByRole("button", { name: "Add a text box with {{Role}}" }).click();
    const texts = await design(`(s) => s.design.pages[0].elements.filter((e) => e.type === "text").map(${textOf})`);
    if (texts.join("|") !== "{{Name}}|{{Role}}") throw new Error("texts: " + JSON.stringify(texts));
    const ys = await design(`(s) => s.design.pages[0].elements.map((e) => e.y)`);
    if (!(ys[1] > ys[0])) throw new Error("the second box is not under the first: " + ys);
    await page.getByRole("button", { name: "Create 3 pages" }).waitFor({ timeout: 5000 });
    return texts.join(" and ");
  });

  await step("Bulk create: a page for every row, filled and named, and one Undo takes them all back", async () => {
    await page.getByRole("button", { name: "Create 3 pages" }).click();
    await page.getByText("Created 3 pages, one for each row.").waitFor({ timeout: 5000 });
    const pages = await design(`(s) => s.design.pages.map((p) => ({ name: p.name ?? "", texts: p.elements.filter((e) => e.type === "text").map(${textOf}) }))`);
    const got = pages.map((p) => `${p.name}:${p.texts.join("/")}`).join(" | ");
    const want = ":{{Name}}/{{Role}} | Ada Lovelace:Ada Lovelace/Engineer | Grace Hopper:Grace Hopper/Rear admiral | Alan Turing:Alan Turing/Mathematician";
    if (got !== want) throw new Error(got);
    const active = await design(`(s) => s.design.pages.findIndex((p) => p.id === s.activePageId)`);
    if (active !== 1) throw new Error("the open page is page " + (active + 1));
    await shot("bulk");
    await page.getByRole("button", { name: "Undo" }).first().click();
    const after = await design(`(s) => s.design.pages.length`);
    if (after !== 1) throw new Error("after Undo there are " + after + " pages");
    return `${pages.length} pages, 1 after Undo`;
  });

  /* ---------------- the page for the rest ---------------- */
  await step("setup: a polygon, a pale text, a photo and a chart with two series on a white page", async () => {
    await edit(`(a) => {
      a.selectAll();
      a.deleteElements();
      const base = { rotation: 0, opacity: 1 };
      a.addElements([
        { ...base, id: "x", type: "shape", shape: "polygon", x: 80, y: 80, width: 240, height: 240, fill: { type: "solid", color: "#7c3aed" }, stroke: null, radius: 0, name: "polygon" },
        { ...base, id: "x", type: "text", x: 80, y: 380, width: 500, height: 60, name: "pale", paragraphs: [{ runs: [{ text: "Pale words" }] }], fontFamily: "Inter", fontSize: 40, fontWeight: 400, italic: false, underline: false, strike: false, color: "#e4e4e7", align: "left", lineHeight: 1.2, letterSpacing: 0, textCase: "none", autoWidth: true, effect: { kind: "none" }, curve: 0 },
        { ...base, id: "x", type: "chart", x: 700, y: 80, width: 700, height: 440, name: "chart", chart: "column", labels: ["Q1", "Q2"], series: [{ name: "A", values: [10, 20] }, { name: "B", values: [15, 25] }], palette: ["#7c3aed", "#14b8a6"], fontFamily: "Inter", textColor: "#1f2937", showLegend: false, showValues: true, showGrid: true },
      ], { center: false, select: false });
    }`);
    // a photo from the catalogue, by the panel
    await page.getByRole("tab", { name: "Elements", exact: true }).click();
    await page.getByRole("button", { name: "Browse photos" }).click();
    await page.locator(".cf-panel button img, .cf-panel [role=button] img").first().waitFor({ timeout: 15000 });
    await wait(600);
    await page.locator(".cf-panel button:has(img), .cf-panel [role=button]:has(img)").first().click();
    await wait(800);
    const kinds = await design(`(s) => s.design.pages[0].elements.map((e) => e.type).sort().join()`);
    if (kinds !== "chart,image,shape,text") throw new Error("elements: " + kinds);
    return kinds;
  });

  const select = async (name) => {
    await edit(
      `(a, name) => { const s = window.__editor.getState(); const el = s.design.pages[0].elements.find((e) => e.name === name || e.type === name); a.select([el.id]); }`,
      name,
    );
    await wait(300);
  };
  const el = (name) => design(`(s) => s.design.pages[0].elements.find((e) => e.name === ${JSON.stringify(name)} || e.type === ${JSON.stringify(name)})`);

  await step("Charts: Stack the series and the two axis titles, from the Data panel", async () => {
    await select("chart");
    await toolbar.getByRole("button", { name: "Edit data" }).click();
    const panel = page.getByRole("region", { name: "Chart" });
    await panel.waitFor({ timeout: 5000 });
    await panel.getByRole("switch", { name: "Stack the series" }).click();
    await panel.getByRole("textbox", { name: "Title of the value axis" }).fill("Units");
    await panel.getByRole("textbox", { name: "Title of the category axis" }).fill("Quarter");
    await wait(300);
    const chart = await el("chart");
    if (chart.stacked !== true || chart.valueAxisTitle !== "Units" || chart.categoryAxisTitle !== "Quarter")
      throw new Error(JSON.stringify({ stacked: chart.stacked, v: chart.valueAxisTitle, c: chart.categoryAxisTitle }));
    await shot("chart");
    return "stacked, Units / Quarter";
  });

  await step("Shape options: the sides of a polygon", async () => {
    await select("polygon");
    await toolbar.getByRole("button", { name: "Shape options" }).click();
    const sides = page.getByRole("slider", { name: "Sides" });
    await sides.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    const params = (await el("polygon")).params;
    if (!params || params.sides !== 5) throw new Error("params: " + JSON.stringify(params));
    return "5 sides";
  });

  await step("Font weight: a text box set in Light from the Font panel", async () => {
    await select("pale");
    await toolbar.getByRole("button", { name: /^Toggle font selector/ }).click();
    const weight = page.getByRole("combobox", { name: "Weight" });
    await weight.waitFor({ timeout: 5000 });
    await weight.click();
    await page.getByRole("option", { name: "Light (300)" }).click();
    await wait(600);
    const w = (await el("pale")).fontWeight;
    if (w !== 300) throw new Error("weight " + w);
    return "300";
  });

  await step("Link: an address that could run code is refused, a web address is stored in full", async () => {
    await select("polygon");
    await toolbar.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /^Link/ }).click();
    const dialog = page.getByRole("dialog", { name: "Link" });
    const field = dialog.getByRole("textbox", { name: "Address" });
    await field.fill("javascript:alert(1)");
    await field.press("Enter");
    await dialog.getByRole("alert").waitFor({ timeout: 3000 });
    if ((await el("polygon")).link) throw new Error("the unsafe address was stored");
    await field.fill("example.com/pricing");
    await field.press("Enter");
    await dialog.waitFor({ state: "detached", timeout: 3000 });
    const link = (await el("polygon")).link;
    if (link !== "https://example.com/pricing") throw new Error("link: " + link);
    return link;
  });

  await step("Frame shape: the photo cut to a circle, where it was", async () => {
    await select("image");
    const before = await el("image");
    await toolbar.getByRole("button", { name: "Frame shape" }).click();
    // the menu lists every shape of the catalogue by its name, so "Circle" and not "Half circle"
    await page.getByRole("menuitemcheckbox", { name: "Circle", exact: true }).click();
    const after = await el("image");
    if (after.mask !== "ellipse") throw new Error("mask: " + after.mask);
    if (after.x !== before.x || after.width !== before.width) throw new Error("the picture moved");
    return "ellipse";
  });

  await step("Crop: a fixed shape for the frame, and the picture stays where it is", async () => {
    await select("image");
    const before = await el("image");
    await toolbar.getByRole("button", { name: "Crop", exact: true }).click();
    const crop = page.getByRole("toolbar", { name: "Crop controls" });
    await crop.getByRole("button", { name: "Shape of the crop" }).click();
    await page.getByRole("menuitemcheckbox", { name: "1:1" }).click();
    await wait(200);
    const after = await el("image");
    if (Math.abs(after.width - after.height) > 0.01) throw new Error(`${after.width} x ${after.height}`);
    const where = (e) => Math.round(e.x + e.crop.x * e.width);
    if (where(after) !== where(before)) throw new Error("the picture moved from " + where(before) + " to " + where(after));
    await crop.getByRole("button", { name: "Done" }).click();
    return `${Math.round(after.width)} x ${Math.round(after.height)}`;
  });

  await step("Margins: Show margins draws the frame a twentieth of the page in", async () => {
    await edit(`(a) => a.clearSelection()`);
    await openFile();
    await page.getByRole("menuitem", { name: /^Rulers and guides/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "Show margins" }).click();
    const box = page.locator("[data-cf-margins]");
    await box.waitFor({ timeout: 3000 });
    const info = await page.evaluate(() => {
      const s = window.__editor.getState();
      const m = document.querySelector("[data-cf-margins]").getBoundingClientRect();
      const p = document.querySelector(".cf-pageframe").getBoundingClientRect();
      return { inset: m.left - p.left, want: Math.round(Math.min(s.design.width, s.design.height) * 0.05) * s.zoom };
    });
    if (Math.abs(info.inset - info.want) > 1.5) throw new Error(`inset ${info.inset}, wanted ${info.want}`);
    await shot("margins");
    return `${Math.round(info.inset)} px on the screen`;
  });

  await step("Spell-check: off to begin with, on when asked, and remembered", async () => {
    const editorAttr = async () => {
      await edit(`(a) => { const s = window.__editor.getState(); a.startTextEdit(s.design.pages[0].elements.find((e) => e.name === "pale").id); }`);
      const value = await page.locator("[data-cf-text-editor]").getAttribute("spellcheck", { timeout: 5000 });
      await edit(`(a) => a.endTextEdit()`);
      return value;
    };
    const off = await editorAttr();
    if (off !== "false") throw new Error("spellcheck is " + off + " to begin with");
    await edit(`(a) => a.clearSelection()`);
    await openFile();
    await page.getByRole("menuitemcheckbox", { name: "Check spelling while typing" }).click();
    await page.getByText(/Your browser now marks misspelt words/).waitFor({ timeout: 3000 });
    const on = await editorAttr();
    if (on !== "true") throw new Error("spellcheck is " + on + " after it was asked for");
    const stored = await page.evaluate(() => window.localStorage.getItem("craftly.spellcheck"));
    if (stored !== "1") throw new Error("not remembered: " + stored);
    return "false, then true";
  });

  await step("Check accessibility: the pale text and the photo without alternative text are found, and Show selects", async () => {
    await edit(`(a) => a.clearSelection()`);
    await openFile();
    await page.getByRole("menuitem", { name: "Check accessibility" }).click();
    const dialog = page.getByRole("dialog", { name: "Check accessibility" });
    await dialog.getByText("2 things to look at").waitFor({ timeout: 5000 });
    const text = await dialog.innerText();
    if (!/“Pale words” has a contrast of 1\.\d+ to 1/.test(text)) throw new Error("the pale text is not listed");
    if (!/has no alternative text/.test(text)) throw new Error("the photo is not listed");
    await shot("accessibility");
    await dialog.getByRole("button", { name: /^Show on the page: “Pale words”/ }).click();
    await dialog.waitFor({ state: "detached", timeout: 3000 });
    const selected = await design(`(s) => s.design.pages[0].elements.find((e) => e.id === s.selection[0])?.name`);
    if (selected !== "pale") throw new Error("selected: " + selected);
    return "2 found, Show selects the text";
  });

  await step("Presenter: the clock counts and starts again, and L shows the pointer where the mouse is", async () => {
    await edit(`(a) => a.clearSelection()`);
    await page.getByRole("button", { name: "Present", exact: true }).first().click();
    const show = page.getByRole("dialog", { name: "Presentation" });
    await show.waitFor({ timeout: 5000 });
    const clock = show.getByRole("button", { name: /^The show has run / });
    await wait(2300);
    const ran = await clock.innerText();
    if (!/^00:0[2-4]$/.test(ran)) throw new Error("the clock says " + ran);
    await page.mouse.move(400, 400);
    await page.mouse.move(420, 420);
    await clock.click();
    // the clock is drawn again a moment after the click
    await show.getByRole("button", { name: "The show has run 00:00. Start the clock again" }).waitFor({ timeout: 900 });
    await page.keyboard.press("l");
    await page.mouse.move(500, 300);
    await page.mouse.move(520, 320);
    const dot = await page.evaluate(() => {
      const d = document.querySelector("[data-cf-present-dot]");
      const r = d?.getBoundingClientRect();
      return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
    });
    if (!dot || Math.abs(dot.x - 520) > 2 || Math.abs(dot.y - 320) > 2) throw new Error("the dot is at " + JSON.stringify(dot));
    await shot("present");
    await page.keyboard.press("Escape");
    await show.waitFor({ state: "detached", timeout: 5000 });
    return `clock ${ran}, dot at ${dot.x}, ${dot.y}`;
  });

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
