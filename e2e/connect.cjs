/*
 * Lines that are attached to shapes, as a person does it in a real browser: click one shape, Shift-click another, choose
 * Connect (from the toolbar, from the keyboard and from the right-click menu) and an arrow is drawn between them; drag a shape
 * with the mouse and the arrow follows it; one undo takes the move and the arrow's following back together; deleting a shape
 * takes its arrow with it and undo brings both back; duplicating shapes and arrow together gives a second diagram whose arrow
 * belongs to the copies; the attachments are there after a reload. The arrow is read from the pixels of the page too (a screenshot
 * of the page with nothing selected), so that "attached" means "drawn there" and not only "the numbers say so".
 */
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("connect");
const results = [];
const logs = [];
let shotN = 0;

const RED = "#d9222a";
const BLUE = "#1f4fd8";

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
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);

  /** the elements of the open page and the selection */
  const state = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return {
        sel: s.selection,
        saveState: s.saveState,
        past: s.past.length,
        els: pg.elements.map((e) => ({
          id: e.id,
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          rotation: e.rotation,
          start: e.start,
          end: e.end,
          endArrow: e.endArrow,
        })),
      };
    });
  const lines = async () => (await state()).els.filter((e) => e.type === "line");

  /** empties the page and puts two boxes on it, side by side: A (red) on the left, B (blue) on the right; gives their ids */
  const setUp = () =>
    page.evaluate(
      ({ RED, BLUE }) => {
        const { actions } = window.__editor.getState();
        actions.selectAll();
        actions.deleteElements();
        const box = (x, color) => ({
          id: "x",
          type: "shape",
          shape: "rect",
          x,
          y: 300,
          width: 300,
          height: 150,
          rotation: 0,
          opacity: 1,
          fill: { type: "solid", color },
          stroke: null,
          radius: 0,
        });
        const ids = actions.addElements([box(200, RED), box(1000, BLUE)], { center: false, select: false });
        actions.clearSelection();
        return ids;
      },
      { RED, BLUE },
    );

  /** where a point of the page (design px) is on the screen */
  const screenAt = async (x, y) => {
    const box = await page.locator(".cf-pageframe").boundingBox();
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    return [box.x + x * zoom, box.y + y * zoom];
  };
  const click = async (x, y, shift = false) => {
    const [sx, sy] = await screenAt(x, y);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(sx, sy);
    if (shift) await page.keyboard.up("Shift");
    await wait(150);
  };
  const drag = async (from, to) => {
    const [fx, fy] = await screenAt(...from);
    const [tx, ty] = await screenAt(...to);
    await page.mouse.move(fx, fy);
    await page.mouse.down();
    await page.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 6 });
    await page.mouse.move(tx, ty, { steps: 6 });
    await page.mouse.up();
    await wait(250);
  };

  /** the darkest pixel (r + g + b) within 3 screen pixels of each point of the page given in design px, read with nothing selected */
  const darkestAround = async (points) => {
    await page.evaluate(() => window.__editor.getState().actions.clearSelection());
    await page.mouse.move(4, 4);
    await wait(300);
    const box = await page.locator(".cf-pageframe").boundingBox();
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    const png = await page.screenshot({ clip: box });
    return page.evaluate(
      async ({ bytes, points, zoom }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        return points.map(([x, y]) => {
          const cx = Math.round(x * zoom);
          const cy = Math.round(y * zoom);
          const d = g.getImageData(Math.max(0, cx - 3), Math.max(0, cy - 3), 7, 7).data;
          let darkest = 765;
          for (let i = 0; i < d.length; i += 4) darkest = Math.min(darkest, d[i] + d[i + 1] + d[i + 2]);
          return darkest;
        });
      },
      { bytes: Array.from(png), points, zoom },
    );
  };
  const isInk = (sum) => sum < 140; // the arrow is #0e1318: 14 + 19 + 24

  const toolbar = () => page.getByRole("toolbar", { name: "Selected element common controls" });
  const connectButton = () => toolbar().getByRole("button", { name: "Connect", exact: true });
  const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
  const ends = (l) => {
    // a straight line runs from (x, y) to (x + width, y) about the middle of its box, before it is turned
    const cx = l.x + l.width / 2;
    const cy = l.y + l.height / 2;
    const a = (l.rotation * Math.PI) / 180;
    const half = l.width / 2;
    return {
      start: { x: cx - half * Math.cos(a), y: cy - half * Math.sin(a) },
      end: { x: cx + half * Math.cos(a), y: cy + half * Math.sin(a) },
    };
  };
  const at = (p) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

  /* ---------------- a new design ---------------- */
  let a = "";
  let b = "";
  await step("a presentation opens", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    [a, b] = await setUp();
    return "two boxes: " + a + ", " + b;
  });

  /* ---------------- connect, by mouse and toolbar ---------------- */
  await step("click one box, Shift-click the other, Connect: an arrow is drawn from the first to the second", async () => {
    await click(350, 375);
    await click(1150, 375, true);
    await connectButton().waitFor({ timeout: 5000 });
    await shot("two-selected");
    await connectButton().click();
    await page.waitForFunction(() => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.length === 3;
    });
    const s = await state();
    const line = s.els[2];
    if (line.type !== "line" || line.endArrow !== "arrow") throw new Error("the new element is " + JSON.stringify(line));
    if (line.start?.elementId !== a || line.end?.elementId !== b) throw new Error("attached to " + JSON.stringify([line.start, line.end]));
    if (s.sel.length !== 1 || s.sel[0] !== line.id) throw new Error("selection " + s.sel);
    const e = ends(line);
    if (!near(e.start.x, 500) || !near(e.start.y, 375) || !near(e.end.x, 1000) || !near(e.end.y, 375)) throw new Error(`from ${at(e.start)} to ${at(e.end)}`);
    const [middle, nearEnd] = await darkestAround([
      [750, 375],
      [985, 375],
    ]);
    if (!isInk(middle) || !isInk(nearEnd)) throw new Error(`the arrow is not drawn: ${middle}, ${nearEnd}`);
    await shot("connected");
    return `from ${at(e.start)} to ${at(e.end)}, drawn`;
  });

  /* ---------------- dragging ---------------- */
  await step("dragging a box with the mouse takes the arrow along, and it is drawn there", async () => {
    await drag([1150, 375], [1150, 675]);
    const s = await state();
    const box = s.els.find((e) => e.id === b);
    const line = s.els[2];
    if (!near(box.y, 600, 12)) throw new Error("the box is at y " + box.y);
    if (line.start?.elementId !== a || line.end?.elementId !== b) throw new Error("let go: " + JSON.stringify([line.start, line.end]));
    const e = ends(line);
    // the left side of B, and the right side of A
    if (!near(e.end.x, box.x) || !near(e.end.y, box.y + box.height / 2)) throw new Error(`the arrow ends at ${at(e.end)} but the box is at ${box.x}, ${box.y}`);
    if (!near(e.start.x, 500) || !near(e.start.y, 375)) throw new Error("the arrow starts at " + at(e.start));
    const [nearBox] = await darkestAround([[box.x - 12, box.y + box.height / 2 - (box.y + box.height / 2 - 375) * (12 / (box.x - 500))]]);
    if (!isInk(nearBox)) throw new Error("not drawn next to the box: " + nearBox);
    await shot("dragged");
    return `the arrow now ends at ${at(e.end)}`;
  });

  await step("one undo puts the box and the arrow back together, redo moves both again", async () => {
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Control+z");
    await wait(300);
    let s = await state();
    const line = s.els[2];
    const box = s.els.find((e) => e.id === b);
    if (!near(box.y, 300) || line.type !== "line") throw new Error("after undo the box is at " + box.y);
    const e = ends(line);
    if (!near(e.end.y, 375) || !near(e.end.x, 1000)) throw new Error("after undo the arrow ends at " + at(e.end));
    await page.keyboard.press("Control+Shift+z");
    await wait(300);
    s = await state();
    if (!near(s.els.find((x) => x.id === b).y, 600, 12)) throw new Error("after redo the box is at " + s.els.find((x) => x.id === b).y);
    await page.keyboard.press("Control+z");
    await wait(300);
    return "one step each way";
  });

  /* ---------------- delete ---------------- */
  await step("deleting a box takes its arrow, and one undo brings both back", async () => {
    await click(1150, 375);
    await page.keyboard.press("Delete");
    await wait(300);
    let s = await state();
    if (s.els.length !== 1 || s.els[0].id !== a) throw new Error("left: " + s.els.map((e) => e.type));
    await page.keyboard.press("Control+z");
    await wait(300);
    s = await state();
    if (s.els.length !== 3 || !s.els[2].end || s.els[2].end.elementId !== b) throw new Error("after undo: " + s.els.map((e) => e.type));
    return "1 element, then 3";
  });

  /* ---------------- keyboard ---------------- */
  await step("Connect works from the keyboard", async () => {
    await page.evaluate(() => window.__editor.getState().actions.deleteElements([window.__editor.getState().design.pages[0].elements[2].id]));
    await wait(200);
    await page.evaluate(([a, b]) => window.__editor.getState().actions.select([b, a]), [a, b]);
    await connectButton().waitFor({ timeout: 5000 });
    await connectButton().focus();
    await page.keyboard.press("Enter");
    await wait(300);
    const line = (await lines())[0];
    if (!line) throw new Error("no arrow");
    // b was selected first, so the arrow runs from b to a
    if (line.start?.elementId !== b || line.end?.elementId !== a) throw new Error("runs " + JSON.stringify([line.start?.elementId, line.end?.elementId]) + ", boxes " + [a, b]);
    return "from the box that was selected first";
  });

  /* ---------------- right-click menu ---------------- */
  await step("the right-click menu offers Connect for exactly two elements", async () => {
    await page.evaluate(() => window.__editor.getState().actions.deleteElements([window.__editor.getState().design.pages[0].elements[2].id]));
    await wait(200);
    await click(350, 375);
    await click(1150, 375, true);
    const [sx, sy] = await screenAt(350, 375);
    await page.mouse.click(sx, sy, { button: "right" });
    const item = page.getByRole("menuitem", { name: /^Connect/ });
    await item.waitFor({ timeout: 4000 });
    await shot("menu");
    await item.click();
    await wait(300);
    if ((await lines()).length !== 1) throw new Error("no arrow");
    // three selected: not offered
    await page.evaluate(() => window.__editor.getState().actions.selectAll());
    const [mx, my] = await screenAt(350, 375);
    await page.mouse.click(mx, my, { button: "right" });
    await page.getByRole("menu", { name: "Context menu" }).waitFor({ timeout: 4000 });
    const offered = await page.getByRole("menuitem", { name: /^Connect/ }).count();
    await page.keyboard.press("Escape");
    if (offered) throw new Error("Connect is offered for three");
    return "offered for two, not for three";
  });

  /* ---------------- copies ---------------- */
  await step("duplicating the boxes and the arrow gives a second diagram whose arrow belongs to the copies", async () => {
    await page.evaluate(() => window.__editor.getState().actions.selectAll());
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Control+d");
    await wait(400);
    const s = await state();
    if (s.els.length !== 6) throw new Error(s.els.length + " elements");
    const [orig, copy] = [s.els.filter((e) => e.type === "line")[0], s.els.filter((e) => e.type === "line")[1]];
    const copyIds = new Set(s.els.slice(3).map((e) => e.id));
    if (!copyIds.has(copy.start?.elementId) || !copyIds.has(copy.end?.elementId)) throw new Error("the copy's arrow is attached to " + JSON.stringify([copy.start, copy.end]));
    if (copyIds.has(orig.start?.elementId) || copyIds.has(orig.end?.elementId)) throw new Error("the original arrow was changed");
    // moving a copy of a box moves only the copy's arrow
    const copyBox = s.els.slice(3).find((e) => e.type === "shape" && e.id === copy.end.elementId);
    const before = JSON.stringify(orig);
    await page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { y: 800 }), copyBox.id);
    await wait(200);
    const after = await lines();
    if (JSON.stringify(after.find((l) => l.id === orig.id)) !== before) throw new Error("the original arrow moved");
    if (JSON.stringify(after.find((l) => l.id === copy.id)) === JSON.stringify(copy)) throw new Error("the copy's arrow did not follow");
    await shot("copies");
    return "6 elements, each arrow with its own boxes";
  });

  /* ---------------- reload ---------------- */
  await step("the attachments are there after a reload, and the arrow still follows", async () => {
    await page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 });
    const before = await lines();
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    const after = await lines();
    if (after.length !== before.length) throw new Error(before.length + " arrows before, " + after.length + " after");
    for (const l of before) {
      const same = after.find((x) => x.id === l.id);
      if (!same || JSON.stringify([same.start, same.end]) !== JSON.stringify([l.start, l.end])) throw new Error("the attachments of " + l.id + " changed");
    }
    const target = before[0].end.elementId;
    await page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { y: 40 }), target);
    await wait(200);
    const moved = (await lines()).find((l) => l.id === before[0].id);
    if (JSON.stringify(ends(moved)) === JSON.stringify(ends(before[0]))) throw new Error("the arrow did not follow after the reload");
    return before.length + " arrows, attached and following";
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
