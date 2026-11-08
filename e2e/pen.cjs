/*
 * The Pen tool and the editing of a path's points, as a person does it with the mouse and the keys: pick the pen in the Tools
 * palette, click corners, drag a curve out of a point, close the path on its first point, undo and redo it, open its points
 * with Enter, drag a point, click the path to add one, turn a point smooth with a double click, delete a point, leave with
 * Escape, undo while a path is being placed (it takes the last point back), walk through the points with Tab and on to the
 * toolbar of the points, see that the toolbar still shows Done in a narrow window, download the page as SVG and find the
 * curve in it, reload to find the path as it was left, and choose another page in the middle of a path.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("pen");
const results = [];
const logs = [];
let shotN = 0;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);

  const state = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      const el = pg.elements[pg.elements.length - 1];
      return {
        tool: s.tool,
        n: pg.elements.length,
        sel: s.selection,
        width: s.design.width,
        height: s.design.height,
        last: el ? { id: el.id, type: el.type, shape: el.shape, path: el.path, fill: el.fill, stroke: el.stroke, x: el.x, y: el.y, width: el.width, height: el.height } : null,
        saveState: s.saveState,
      };
    });
  /** client coordinates of a point of the page given in design px */
  const at = (x, y) =>
    page.evaluate(
      ([x, y]) => {
        const frame = document.querySelector(".cf-pageframe").getBoundingClientRect();
        const zoom = window.__editor.getState().zoom;
        return { x: frame.left + x * zoom, y: frame.top + y * zoom };
      },
      [x, y],
    );
  const click = async (x, y) => {
    const p = await at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const dragFrom = async (x, y, dx, dy) => {
    const p = await at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + dx / 2, p.y + dy / 2, { steps: 4 });
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 4 });
    await page.mouse.up();
  };
  const anchorBoxes = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".cf-pathedit__anchor")).map((a) => {
        const r = a.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }),
    );
  const count = (selector) => page.locator(selector).count();

  /* ---------------- a new design, the pen from the palette ---------------- */
  await step("the Tools palette offers the Pen, and choosing it opens its options", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    await page.getByRole("tab", { name: "Tools", exact: true }).click();
    const palette = page.getByRole("toolbar", { name: "Tools" });
    await palette.waitFor({ timeout: 10000 });
    await palette.getByRole("button", { name: "Pen", exact: true }).click();
    await page.getByRole("dialog", { name: "Pen options" }).waitFor({ timeout: 5000 });
    const s = await state();
    if (s.tool !== "pen") throw new Error("the tool is " + s.tool);
    await page.keyboard.press("Escape"); // closes the options (the popover takes the key) but not the tool
    await wait(300);
    if ((await state()).tool !== "pen") throw new Error("Escape put the pen down while the options were open");
    return "tool pen, options shown";
  });

  let pathId = "";
  let nodesBefore = 0;
  await step("clicks place points, a drag pulls a curve out of one, and a click on the first point closes the path", async () => {
    const { width: W, height: H, n: before } = await state();
    const A = [0.2 * W, 0.3 * H];
    await click(...A);
    if ((await count(".cf-penpreview")) !== 1) throw new Error("no preview of the path being placed");
    await dragFrom(0.5 * W, 0.2 * H, 0.08 * W, -0.1 * H); // a smooth point
    await click(0.8 * W, 0.5 * H);
    await click(0.45 * W, 0.8 * H);
    const middle = await at(0.3 * W, 0.6 * H);
    await page.mouse.move(middle.x, middle.y); // the side that the next click would make follows the pointer
    if ((await count(".cf-penpreview__rubber")) !== 1) throw new Error("no rubber band");
    await shot("placing");
    await click(...A); // the first point again: closes
    await wait(300);
    const s = await state();
    if (s.n !== before + 1) throw new Error(`elements ${before} -> ${s.n}`);
    if (s.last.shape !== "path") throw new Error("the new element is a " + s.last.shape);
    if (!/Z$/.test(s.last.path)) throw new Error("not closed: " + s.last.path);
    if (!/C/.test(s.last.path)) throw new Error("no curve in " + s.last.path);
    if (!s.last.fill || s.last.stroke) throw new Error("a closed path should be filled and have no outline");
    if (s.tool !== "select" || s.sel[0] !== s.last.id || s.sel.length !== 1) throw new Error(`tool ${s.tool}, selection ${s.sel}`);
    if ((await count(".cf-penpreview")) !== 0) throw new Error("the preview stays");
    pathId = s.last.id;
    await shot("closed");
    return s.last.path.slice(0, 70);
  });

  await step("one undo takes the whole path away, and redo brings it back", async () => {
    const before = (await state()).n;
    await page.keyboard.press("Control+z");
    await wait(300);
    if ((await state()).n !== before - 1) throw new Error("undo did not remove the path");
    await page.keyboard.press("Control+Shift+z");
    await wait(300);
    const s = await state();
    if (s.n !== before || s.last.id !== pathId) throw new Error("redo did not bring it back");
    return "undone and redone";
  });

  /* ---------------- the points ---------------- */
  await step("a click on the path selects it", async () => {
    const { last } = await state();
    await click(last.x + last.width / 2, last.y + last.height / 2);
    await wait(300);
    const s = await state();
    if (s.sel.length !== 1 || s.sel[0] !== pathId) throw new Error("selection " + JSON.stringify(s.sel));
    return "selected";
  });

  await step("Enter opens the points of the path, with a toolbar of their own", async () => {
    await page.keyboard.press("Enter");
    await page.locator("[data-cf-pathedit]").waitFor({ timeout: 5000 });
    await page.getByRole("toolbar", { name: "Point editing controls" }).waitFor({ timeout: 5000 });
    nodesBefore = await count(".cf-pathedit__anchor");
    if (nodesBefore !== 4) throw new Error(nodesBefore + " points");
    if ((await count(".cf-sel")) !== 0) throw new Error("the selection frame is still there");
    await shot("points");
    return nodesBefore + " points";
  });

  await step("dragging a point moves it, and only it", async () => {
    const before = await anchorBoxes();
    const from = before[2];
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 20, { steps: 4 });
    await page.mouse.move(from.x + 60, from.y + 40, { steps: 4 });
    await page.mouse.up();
    await wait(300);
    const after = await anchorBoxes();
    const moved = after.map((p, i) => Math.round(Math.hypot(p.x - before[i].x, p.y - before[i].y)));
    if (Math.abs(after[2].x - (from.x + 60)) > 3 || Math.abs(after[2].y - (from.y + 40)) > 3) throw new Error("the point is at " + JSON.stringify(after[2]));
    if ([0, 1, 3].some((i) => moved[i] > 2)) throw new Error("the other points moved: " + moved);
    return `point 3 moved by ${moved[2]} px, the others by ${[moved[0], moved[1], moved[3]]}`;
  });

  await step("clicking the path adds a point without changing its shape", async () => {
    const side = await page.evaluate(() => {
      const seg = document.querySelectorAll(".cf-pathedit__segment")[3]; // the closing side: a straight one
      const length = seg.getTotalLength();
      const p = seg.getPointAtLength(length / 2);
      const m = seg.getScreenCTM();
      return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    });
    const before = await state();
    await page.mouse.click(side.x, side.y);
    await wait(300);
    const n = await count(".cf-pathedit__anchor");
    if (n !== nodesBefore + 1) throw new Error(`${nodesBefore} -> ${n} points`);
    const caption = await page.getByRole("toolbar", { name: "Point editing controls" }).innerText();
    if (!/Point 5 of 5/.test(caption)) throw new Error("caption: " + caption.replace(/\s+/g, " "));
    const after = await state();
    if (Math.abs(after.last.width - before.last.width) > 1 || Math.abs(after.last.height - before.last.height) > 1) throw new Error("the box changed");
    return "5 points, box unchanged";
  });

  await step("a double click turns a point smooth, and shows its handles", async () => {
    const [first] = await anchorBoxes();
    await page.mouse.dblclick(first.x, first.y);
    await wait(300);
    const handles = await count(".cf-pathedit__handle");
    if (handles !== 2) throw new Error(handles + " handles");
    const caption = await page.getByRole("toolbar", { name: "Point editing controls" }).innerText();
    if (!/smooth/.test(caption)) throw new Error("caption: " + caption.replace(/\s+/g, " "));
    await shot("smooth");
    return "2 handles";
  });

  await step("dragging a handle reshapes the curve", async () => {
    const before = (await state()).last.path;
    const handle = await page.evaluate(() => {
      const r = document.querySelectorAll(".cf-pathedit__handle")[1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 25, handle.y + 25, { steps: 4 });
    await page.mouse.up();
    await wait(300);
    const after = (await state()).last.path;
    if (after === before) throw new Error("the path did not change");
    return "reshaped";
  });

  await step("Delete takes the selected point away, and the path stays", async () => {
    await page.keyboard.press("Delete");
    await wait(300);
    const n = await count(".cf-pathedit__anchor");
    if (n !== 4) throw new Error(n + " points");
    if ((await state()).last.id !== pathId) throw new Error("the path is gone");
    return "4 points";
  });

  await step("Escape leaves point editing and keeps the path selected", async () => {
    await page.keyboard.press("Escape");
    await wait(300);
    if ((await count("[data-cf-pathedit]")) !== 0) throw new Error("still editing points");
    const s = await state();
    if (s.sel[0] !== pathId) throw new Error("selection " + s.sel);
    if ((await count(".cf-sel")) < 1) throw new Error("no selection frame");
    return "selected";
  });

  /* ---------------- an open path with the P key ---------------- */
  await step("P picks up the pen again; Enter finishes an open path, which is a stroke with nothing inside", async () => {
    const before = (await state()).n;
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("p");
    if ((await state()).tool !== "pen") throw new Error("P did not pick up the pen");
    const { width: W, height: H } = await state();
    await click(0.1 * W, 0.9 * H);
    await click(0.3 * W, 0.95 * H);
    await click(0.5 * W, 0.88 * H);
    await page.keyboard.press("Enter");
    await wait(300);
    const s = await state();
    if (s.n !== before + 1) throw new Error(`elements ${before} -> ${s.n}`);
    if (/Z/.test(s.last.path) || s.last.fill || !s.last.stroke) throw new Error(`not an open stroke: ${s.last.path} ${JSON.stringify(s.last.fill)}`);
    return s.last.path;
  });

  /* ---------------- undo while a path is being placed ---------------- */
  const placedPoints = () => page.evaluate(() => document.querySelectorAll(".cf-penpreview__node").length);
  await step("Ctrl+Z, and the Undo button, take the last point of a path being placed back and leave the shapes alone", async () => {
    const { width: W, height: H, n: before } = await state();
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("p");
    await click(0.62 * W, 0.15 * H);
    await click(0.7 * W, 0.3 * H);
    await click(0.78 * W, 0.18 * H);
    if ((await placedPoints()) !== 3) throw new Error((await placedPoints()) + " points placed");
    await page.keyboard.press("Control+z");
    await wait(200);
    if ((await placedPoints()) !== 2) throw new Error("Ctrl+Z left " + (await placedPoints()) + " points");
    if ((await state()).n !== before) throw new Error("Ctrl+Z reached into the page");
    await page.keyboard.press("Control+Shift+z"); // nothing to bring back, and no redo of the page
    await wait(200);
    if ((await placedPoints()) !== 2 || (await state()).n !== before) throw new Error("Ctrl+Shift+Z did something");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await wait(200);
    if ((await placedPoints()) !== 1) throw new Error("the Undo button left " + (await placedPoints()) + " points");
    await page.keyboard.press("Control+z");
    await wait(200);
    if ((await count(".cf-penpreview")) !== 0) throw new Error("the path is not gone");
    if ((await state()).n !== before) throw new Error("the page changed: " + before + " -> " + (await state()).n);
    await page.keyboard.press("Escape"); // puts the pen down, and keeps the path that was selected
    await wait(200);
    return "3 -> 2 -> 1 -> 0 points, " + before + " shapes all along";
  });

  /* ---------------- the keyboard goes on to the toolbar of the points ---------------- */
  await step("Tab walks through the points and then on to the toolbar, where Smooth works from the keyboard", async () => {
    // choosing a drawing tool clears the selection: choose the open path again, the last one made
    await page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      s.actions.select([pg.elements[pg.elements.length - 1].id]);
    });
    const s0 = await state();
    if (s0.sel.length !== 1 || s0.last.shape !== "path") throw new Error("selection " + s0.sel);
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Enter");
    await page.locator("[data-cf-pathedit]").waitFor({ timeout: 5000 });
    const points = await count(".cf-pathedit__anchor");
    const bar = page.getByRole("toolbar", { name: "Point editing controls" });
    for (let i = 1; i <= points; i++) {
      await page.keyboard.press("Tab");
      const caption = await bar.innerText();
      if (!new RegExp(`Point ${i} of ${points}`).test(caption)) throw new Error(`Tab ${i}: ` + caption.replace(/\s+/g, " "));
    }
    await page.keyboard.press("Tab"); // after the last point: the browser's
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return { inBar: !!el.closest('[aria-label="Point editing controls"]'), name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30) };
    });
    if (!where.inBar) throw new Error("the focus went to " + where.name);
    if (!/^Corner/.test(where.name)) throw new Error("the first stop of the toolbar is " + where.name);
    const before = (await state()).last.path;
    await page.keyboard.press("Tab"); // Smooth
    await page.keyboard.press("Enter");
    await wait(300);
    const after = (await state()).last.path;
    // the last point of an open path has one side only, so it gets one handle: the side becomes a curve
    if (after === before || !/C/.test(after)) throw new Error(`Smooth did nothing: ${before} -> ${after}`);
    if ((await count("[data-cf-pathedit]")) !== 1) throw new Error("point editing ended");
    return points + " points, then the toolbar: " + where.name;
  });

  /* ---------------- a narrow window ---------------- */
  await step("in a narrow window the toolbar of the points still shows Done", async () => {
    await page.setViewportSize({ width: 600, height: 800 });
    await wait(700);
    const bar = await page.evaluate(() => {
      const scroller = document.querySelector('[aria-label="Point editing controls"] .cf-tb__scroll') || document.querySelector(".cf-tb__scroll");
      const done = Array.from(scroller.querySelectorAll("button")).find((b) => /^Done/.test(b.textContent.trim()));
      const s = scroller.getBoundingClientRect();
      const d = done.getBoundingClientRect();
      const close = Array.from(scroller.querySelectorAll("button")).some((b) => /^Close path/.test(b.textContent.trim()));
      return { overflow: scroller.scrollWidth - scroller.clientWidth, doneRight: Math.round(d.right), barRight: Math.round(s.right), close };
    });
    await shot("narrow");
    await page.setViewportSize({ width: 1440, height: 900 });
    await wait(500);
    if (!bar.close) throw new Error("the bar has no Close path button, so it was not the long one");
    if (bar.overflow > 1 || bar.doneRight > bar.barRight) throw new Error(`Done is cut off: ${JSON.stringify(bar)}`);
    return `Done ends at ${bar.doneRight}, the bar at ${bar.barRight}`;
  });

  await step("Escape leaves point editing again", async () => {
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Escape");
    await wait(300);
    if ((await count("[data-cf-pathedit]")) !== 0) throw new Error("still editing points");
    return "left";
  });

  /* ---------------- export and persistence ---------------- */
  await step("the page downloads as SVG with the curve in it", async () => {
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await wait(500);
    await page.getByLabel("File type").click();
    await page.getByRole("option", { name: /^SVG/ }).first().click();
    await wait(300);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click()]);
    const text = fs.readFileSync(await dl.path(), "utf8");
    await page.keyboard.press("Escape");
    await wait(300);
    if (!/<svg/.test(text)) throw new Error("not an SVG: " + text.slice(0, 60));
    if (!/<path[^>]* d="[^"]*C[^"]*"/.test(text)) throw new Error("no curve in the SVG");
    return `${dl.suggestedFilename()} ${text.length} bytes`;
  });

  await step("the paths are there after a reload", async () => {
    await page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 });
    const before = await state();
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    const after = await state();
    if (after.n !== before.n) throw new Error(`elements ${before.n} -> ${after.n}`);
    if (after.last.path !== before.last.path) throw new Error("the last path changed");
    const closed = await page.evaluate((id) => window.__editor.getState().design.pages[0].elements.find((e) => e.id === id)?.path, pathId);
    if (!closed || !/Z$/.test(closed)) throw new Error("the closed path is not as it was left: " + closed);
    return `${after.n} elements`;
  });

  /* ---------------- another page, in the middle of a path ---------------- */
  await step("a page chosen in the middle of a path leaves the path on the page it was drawn on", async () => {
    const first = await page.evaluate(() => window.__editor.getState().design.pages[0].id);
    const before = await page.evaluate((id) => window.__editor.getState().design.pages.find((p) => p.id === id).elements.length, first);
    const { width: W, height: H } = await state();
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("p");
    await click(0.15 * W, 0.12 * H);
    await click(0.25 * W, 0.2 * H);
    await page.getByRole("button", { name: "Add page", exact: true }).first().click();
    await wait(500);
    const s = await page.evaluate(
      ([id]) => {
        const st = window.__editor.getState();
        return {
          pages: st.design.pages.length,
          active: st.activePageId === id,
          tool: st.tool,
          onFirst: st.design.pages.find((p) => p.id === id).elements.length,
          onNew: st.design.pages[st.design.pages.length - 1].elements.length,
          preview: document.querySelectorAll(".cf-penpreview").length,
        };
      },
      [first],
    );
    if (s.pages !== 2 || s.active) throw new Error("the new page is not the active one: " + JSON.stringify(s));
    if (s.onFirst !== before + 1 || s.onNew !== 0) throw new Error("the path is not on the first page: " + JSON.stringify(s));
    if (s.tool !== "pen" || s.preview !== 0) throw new Error("the pen or its preview: " + JSON.stringify(s));
    return `page 1 ${before} -> ${s.onFirst} shapes, the pen still in hand on page 2`;
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
