/*
 * Combining shapes and turning a shape into a path, as a person does it in a real browser: select shapes, choose Union,
 * Subtract, Intersect or Exclude from the Combine menu of the toolbar, and see the result in the pixels of the page (the
 * notch of a union is empty, the hole of a subtraction is the colour of the page, a turned shape is combined where it is
 * drawn); one undo gives the shapes back; nothing in common says so and changes nothing; Convert to path from the right-click
 * menu and Edit points on the result; the combined shape is there after a reload.
 *
 * The geometry library (paper.js) is a chunk of its own that loads the first time somebody combines shapes: on a production
 * build this journey is also the check that the Content-Security-Policy lets it in.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("combine");
const results = [];
const logs = [];
let shotN = 0;

const RED = "#d9222a";
const BLUE = "#1f4fd8";

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

  /** the elements of the first page, and what is selected */
  const state = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return {
        sel: s.selection,
        saveState: s.saveState,
        els: pg.elements.map((e) => ({
          id: e.id,
          type: e.type,
          shape: e.shape,
          path: e.path,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          rotation: e.rotation,
          fill: e.fill,
        })),
      };
    });

  /** empties the page and puts shapes on it ({ shape, x, y, w, h, fill, rotation }, in design px); gives their ids */
  const setUp = (list) =>
    page.evaluate((list) => {
      const { actions } = window.__editor.getState();
      actions.selectAll();
      actions.deleteElements();
      const els = list.map((s) => ({
        id: "x",
        type: "shape",
        shape: s.shape || "rect",
        x: s.x,
        y: s.y,
        width: s.w,
        height: s.h,
        rotation: s.rotation || 0,
        opacity: 1,
        fill: { type: "solid", color: s.fill },
        stroke: null,
        radius: 0,
      }));
      return actions.addElements(els, { center: false, select: false });
    }, list);

  const selectIds = (ids) => page.evaluate((ids) => window.__editor.getState().actions.select(ids), ids);

  /** the colours (r, g, b) of points of the page given in design px, read from a screenshot of the page with nothing selected */
  const colorsAt = async (points) => {
    await page.evaluate(() => window.__editor.getState().actions.clearSelection());
    await page.mouse.move(4, 4);
    await wait(300);
    const frame = page.locator(".cf-pageframe");
    const box = await frame.boundingBox();
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    const png = await page.screenshot({ clip: box });
    return page.evaluate(
      async ({ bytes, points, zoom, scale }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        return points.map(([x, y]) => Array.from(g.getImageData(Math.round(x * zoom * scale), Math.round(y * zoom * scale), 1, 1).data.slice(0, 3)));
      },
      { bytes: Array.from(png), points, zoom, scale: 1 },
    );
  };
  const near = (c, hex) => {
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return c.every((v, i) => Math.abs(v - want[i]) <= 28);
  };
  const isPaper = (c) => c.every((v) => v >= 235);
  const describe = (c) => `rgb(${c.join(",")})`;

  const toolbar = () => page.getByRole("toolbar", { name: "Selected element common controls" });
  const combineWith = async (way) => {
    await toolbar().getByRole("button", { name: "Combine", exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp("^" + way) }).click();
  };
  const near1 = (v, want) => Math.abs(v - want) <= 1;
  const bounds = (e) => `${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.width)}x${Math.round(e.height)}`;

  /* ---------------- a new design ---------------- */
  await step("a presentation opens with an empty page", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    const s = await state();
    return s.els.length + " elements";
  });

  /* ---------------- union ---------------- */
  // A (red) is behind B (blue); they overlap in a square of 200
  const two = [
    { x: 400, y: 200, w: 400, h: 400, fill: RED },
    { x: 600, y: 400, w: 400, h: 400, fill: BLUE },
  ];
  await step("Union joins two overlapping squares into one path with the look of the one behind", async () => {
    const [a, b] = await setUp(two);
    await selectIds([a, b]);
    await toolbar().waitFor({ timeout: 5000 });
    await shot("two-squares");
    await combineWith("Union");
    await page.waitForFunction(() => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.length === 1;
    });
    const s = await state();
    const made = s.els[0];
    if (made.shape !== "path") throw new Error("the result is a " + made.shape);
    if (![made.x - 400, made.y - 200, made.width - 600, made.height - 600].every((v) => near1(v, 0))) throw new Error("box " + bounds(made));
    if (made.fill.color !== RED) throw new Error("fill " + made.fill.color);
    if (s.sel.length !== 1 || s.sel[0] !== made.id) throw new Error("selection " + s.sel);
    if (made.rotation !== 0) throw new Error("rotation " + made.rotation);
    await toolbar().getByRole("button", { name: "Edit points" }).waitFor({ timeout: 3000 });
    const [onlyA, onlyB, both, notch, below] = await colorsAt([
      [500, 300],
      [900, 700],
      [700, 500],
      [900, 300],
      [500, 700],
    ]);
    if (!near(onlyA, RED) || !near(onlyB, RED) || !near(both, RED)) throw new Error(`A ${describe(onlyA)}, B ${describe(onlyB)}, both ${describe(both)}`);
    if (!isPaper(notch) || !isPaper(below)) throw new Error(`the notches are ${describe(notch)} and ${describe(below)}`);
    await shot("union");
    return "one path " + bounds(made) + ", both notches empty";
  });

  await step("one undo gives both squares back, redo makes the path again", async () => {
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Control+z");
    await wait(300);
    let s = await state();
    if (s.els.length !== 2 || s.els.some((e) => e.shape !== "rect")) throw new Error("after undo: " + JSON.stringify(s.els.map((e) => e.shape)));
    if (bounds(s.els[0]) !== "400,200 400x400" || bounds(s.els[1]) !== "600,400 400x400") throw new Error("the squares moved: " + s.els.map(bounds));
    await page.keyboard.press("Control+Shift+z");
    await wait(300);
    s = await state();
    if (s.els.length !== 1 || s.els[0].shape !== "path") throw new Error("after redo: " + s.els.map((e) => e.shape));
    return "2 squares, then 1 path";
  });

  await step("Union chosen from the keyboard leaves the focus on the canvas, not on nothing", async () => {
    const [a, b] = await setUp(two);
    await selectIds([a, b]);
    await toolbar().getByRole("button", { name: "Combine", exact: true }).focus();
    await page.keyboard.press("Enter"); // opens the menu on its first item, Union
    await page.getByRole("menuitem", { name: /^Union/ }).waitFor({ timeout: 3000 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.length === 1;
    });
    await wait(400);
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName + (el.hasAttribute("data-cf-workspace") ? " (the canvas)" : "") : "nothing";
    });
    if (!/the canvas/.test(where)) throw new Error("the focus is on " + where);
    return where;
  });

  /* ---------------- subtract ---------------- */
  await step("Subtract cuts the shape in front out of the one behind and leaves a hole you can see through", async () => {
    const [big, hole] = await setUp([
      { x: 400, y: 200, w: 800, h: 600, fill: BLUE },
      { shape: "ellipse", x: 600, y: 350, w: 400, h: 300, fill: RED },
    ]);
    await selectIds([hole, big]); // the order of the selection does not matter
    await combineWith("Subtract");
    await page.waitForFunction(() => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.length === 1;
    });
    const made = (await state()).els[0];
    if (made.shape !== "path" || made.fill.color !== BLUE) throw new Error(`${made.shape} ${made.fill.color}`);
    const pieces = (made.path.match(/M/g) || []).length;
    if (pieces !== 2) throw new Error(pieces + " pieces in " + made.path.slice(0, 80));
    await toolbar().waitFor({ timeout: 3000 });
    // a path of two pieces has no points to edit one by one
    if ((await toolbar().getByRole("button", { name: "Edit points" }).count()) !== 0) throw new Error("Edit points is offered for a path of two pieces");
    if (![made.x - 400, made.y - 200, made.width - 800, made.height - 600].every((v) => near1(v, 0))) throw new Error("box " + bounds(made));
    const [middle, edge, corner, outside] = await colorsAt([
      [800, 500],
      [630, 500],
      [420, 220],
      [300, 500],
    ]);
    if (!isPaper(middle)) throw new Error("the hole is " + describe(middle));
    if (!isPaper(edge) && !near(edge, BLUE)) throw new Error("the edge of the hole is " + describe(edge));
    if (!near(corner, BLUE)) throw new Error("the ring is " + describe(corner));
    if (!isPaper(outside)) throw new Error("outside is " + describe(outside));
    await shot("subtract");
    return "2 pieces, the middle is " + describe(middle);
  });

  await step("the page with the hole downloads as SVG, and drawn from that file the hole is still a hole", async () => {
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await wait(500);
    await page.getByLabel("File type").click();
    await page.getByRole("option", { name: /^SVG/ }).first().click();
    await wait(300);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click()]);
    const svg = fs.readFileSync(await dl.path(), "utf8");
    await page.keyboard.press("Escape");
    await wait(300);
    if (!/<path[^>]* d="[^"]*M[^"]*M[^"]*"/.test(svg)) throw new Error("the two pieces are not one path in the SVG");
    if (/fill-rule="evenodd"/.test(svg)) throw new Error("the SVG says even-odd, which a combined path does not need");
    // the file is drawn by the browser, not by this app
    const [hole, ring] = await page.evaluate(
      async ({ svg, w, h, points }) => {
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        return points.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)));
      },
      {
        svg,
        w: await page.evaluate(() => window.__editor.getState().design.width),
        h: await page.evaluate(() => window.__editor.getState().design.height),
        points: [
          [800, 500],
          [420, 220],
        ],
      },
    );
    if (!isPaper(hole)) throw new Error("the hole in the SVG is " + describe(hole));
    if (!near(ring, BLUE)) throw new Error("the ring in the SVG is " + describe(ring));
    return `${svg.length} bytes, hole ${describe(hole)}, ring ${describe(ring)}`;
  });

  /* ---------------- intersect, exclude ---------------- */
  await step("Intersect keeps only what the shapes have in common", async () => {
    const [a, b] = await setUp(two);
    await selectIds([a, b]);
    await combineWith("Intersect");
    await page.waitForFunction(() => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.length === 1;
    });
    const made = (await state()).els[0];
    if (![made.x - 600, made.y - 400, made.width - 200, made.height - 200].every((v) => near1(v, 0))) throw new Error("box " + bounds(made));
    const [inside, a1, b1] = await colorsAt([
      [700, 500],
      [500, 300],
      [900, 700],
    ]);
    if (!near(inside, RED)) throw new Error("the overlap is " + describe(inside));
    if (!isPaper(a1) || !isPaper(b1)) throw new Error(`the rest is ${describe(a1)} and ${describe(b1)}`);
    return bounds(made);
  });

  await step("Exclude takes the overlap away and keeps the rest in two pieces", async () => {
    const [a, b] = await setUp(two);
    await selectIds([a, b]);
    await combineWith("Exclude");
    await page.waitForFunction(() => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.length === 1;
    });
    const made = (await state()).els[0];
    const pieces = (made.path.match(/M/g) || []).length;
    if (pieces !== 2) throw new Error(pieces + " pieces");
    const [overlap, onlyA, onlyB] = await colorsAt([
      [700, 500],
      [500, 300],
      [900, 700],
    ]);
    if (!isPaper(overlap)) throw new Error("the overlap is " + describe(overlap));
    if (!near(onlyA, RED) || !near(onlyB, RED)) throw new Error(`the pieces are ${describe(onlyA)} and ${describe(onlyB)}`);
    return "2 pieces, the overlap is empty";
  });

  /* ---------------- nothing in common ---------------- */
  await step("shapes with nothing in common say so for Intersect and change nothing", async () => {
    const [a, b] = await setUp([
      { x: 100, y: 100, w: 200, h: 200, fill: RED },
      { x: 800, y: 600, w: 200, h: 200, fill: BLUE },
    ]);
    await selectIds([a, b]);
    const before = JSON.stringify((await state()).els);
    await combineWith("Intersect");
    await page.getByText("These shapes do not overlap, so there is nothing to keep.").waitFor({ timeout: 5000 });
    const s = await state();
    if (JSON.stringify(s.els) !== before) throw new Error("the page changed");
    if (s.sel.length !== 2) throw new Error("selection " + s.sel);
    await shot("nothing-in-common");
    return "toast shown, 2 shapes still there";
  });

  /* ---------------- turned shapes ---------------- */
  await step("a turned shape is combined where it is drawn", async () => {
    // 300 x 300 turned an eighth of a turn about (950, 450): a diamond that reaches 212 px from the centre; a small square inside it
    const [r, s] = await setUp([
      { x: 800, y: 300, w: 300, h: 300, fill: BLUE, rotation: 45 },
      { x: 900, y: 400, w: 100, h: 100, fill: BLUE },
    ]);
    await selectIds([r, s]);
    await combineWith("Union");
    await page.waitForFunction(() => {
      const st = window.__editor.getState();
      return st.design.pages.find((p) => p.id === st.activePageId).elements.length === 1;
    });
    const made = (await state()).els[0];
    if (![made.x - 738, made.y - 238, made.width - 424, made.height - 424].every((v) => Math.abs(v) <= 2)) throw new Error("box " + bounds(made));
    const [tip, cornerOfTheSquare, middle] = await colorsAt([
      [1150, 450], // 200 px right of the centre: inside the diamond, outside the square it was made from
      [1090, 310], // the corner of the unturned square: outside the diamond
      [950, 450],
    ]);
    if (!near(tip, BLUE) || !near(middle, BLUE)) throw new Error(`tip ${describe(tip)}, middle ${describe(middle)}`);
    if (!isPaper(cornerOfTheSquare)) throw new Error("the corner of the unturned square is " + describe(cornerOfTheSquare));
    await shot("turned");
    return "a diamond " + bounds(made);
  });

  /* ---------------- convert to path ---------------- */
  await step("Convert to path in the right-click menu writes an ellipse as four points, and Enter opens them", async () => {
    const [e] = await setUp([{ shape: "ellipse", x: 700, y: 300, w: 500, h: 400, fill: RED }]);
    const box = await page.locator(".cf-pageframe").boundingBox();
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    await page.mouse.click(box.x + 950 * zoom, box.y + 500 * zoom, { button: "right" });
    const menu = page.getByRole("menu", { name: "Context menu" });
    await menu.waitFor({ timeout: 5000 });
    await menu.getByRole("menuitem", { name: /^Convert to path/ }).click();
    await page.waitForFunction((id) => {
      const st = window.__editor.getState();
      return st.design.pages.find((p) => p.id === st.activePageId).elements.find((x) => x.id === id)?.shape === "path";
    }, e);
    const made = (await state()).els[0];
    if (made.id !== e) throw new Error("the id changed");
    if (bounds(made) !== "700,300 500x400") throw new Error("box " + bounds(made));
    const [inside, outside] = await colorsAt([
      [950, 500],
      [720, 320], // the corner of the box: outside the ellipse
    ]);
    if (!near(inside, RED) || !isPaper(outside)) throw new Error(`inside ${describe(inside)}, corner ${describe(outside)}`);
    await selectIds([e]);
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Enter");
    await page.locator("[data-cf-pathedit]").waitFor({ timeout: 5000 });
    const anchors = await page.locator(".cf-pathedit__anchor").count();
    if (anchors !== 4) throw new Error(anchors + " points");
    await shot("points-of-an-ellipse");
    await page.keyboard.press("Escape");
    await wait(300);
    return "4 points";
  });

  /* ---------------- after a reload ---------------- */
  await step("a combined shape is there after a reload, and still drawn", async () => {
    const [a, b] = await setUp(two);
    await selectIds([a, b]);
    await combineWith("Union");
    await page.waitForFunction(
      () => {
        const s = window.__editor.getState();
        return s.design.pages.find((p) => p.id === s.activePageId).elements.length === 1 && s.saveState === "saved";
      },
      null,
      { timeout: 15000 },
    );
    const before = (await state()).els[0];
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    const after = (await state()).els;
    if (after.length !== 1 || after[0].path !== before.path || bounds(after[0]) !== bounds(before)) throw new Error("the shape is not as it was left");
    const [onlyA, notch] = await colorsAt([
      [500, 300],
      [900, 300],
    ]);
    if (!near(onlyA, RED) || !isPaper(notch)) throw new Error(`${describe(onlyA)} and ${describe(notch)}`);
    return "same path, drawn";
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
