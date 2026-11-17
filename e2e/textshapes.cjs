/*
 * Text to points, as a person does it in a real browser: add a heading, type a word, right-click it and choose Convert to
 * shapes, and the text box is replaced by one group of path shapes, one for each letter that has ink, drawn where the letters
 * were (read from the pixels of the page before and after, not only from the numbers); one undo gives the text back as it was
 * and redo converts it again; the same from the "..." menu of the toolbar, with a variable font at a light and a heavy weight;
 * curved text, a font Craftly has no file of and more than 500 letters are refused with a message that says what to do and
 * change nothing; a text effect and a letter the font does not have are said to be left out; a text that wraps keeps its line
 * breaks; the page downloads as SVG with paths and no text; and the shapes are there, and drawn, after a reload.
 *
 * The letters come from the font file through fontkit, a chunk of its own that loads the first time somebody converts a text:
 * on a production build this journey is also the check that the Content-Security-Policy lets it (and the font files) in.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("textshapes");
const results = [];
const logs = [];
let shotN = 0;

const INK = "#0e1318";

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
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

  /** the elements of the open page (all of them, as JSON), what is selected and how many steps undo has */
  const state = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return { sel: s.selection, saveState: s.saveState, past: s.past.length, els: JSON.parse(JSON.stringify(pg.elements)) };
    });

  /** the heading made in the first step, as the store has it: the model for the texts of the later steps */
  let model = null;

  /** empties the page and puts one text on it, the heading of the first step with `patch` over it; gives its id */
  const setUpText = (text, patch) =>
    page.evaluate(
      ({ model, text, patch }) => {
        const { actions } = window.__editor.getState();
        actions.selectAll();
        actions.deleteElements();
        const paragraphs = text.split("\n").map((line) => ({ runs: [{ text: line }] }));
        const [id] = actions.addElements([{ ...model, id: "x", paragraphs, ...patch }], { center: false, select: false });
        actions.clearSelection();
        return id;
      },
      { model, text, patch },
    );
  /** waits until the fonts the page draws with are loaded, and a moment more for the canvas to draw with them */
  const settle = async () => {
    await page.evaluate(() => document.fonts.ready);
    await wait(700);
  };

  /** where a point of the page (design px) is on the screen */
  const screenAt = async (x, y) => {
    const box = await page.locator(".cf-pageframe").boundingBox();
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    return [box.x + x * zoom, box.y + y * zoom];
  };
  const middleOf = (e) => [e.x + e.width / 2, e.y + e.height / 2];

  /**
   * The ink (pixels darker than mid grey) in a part of the page given in design px, read from a screenshot of the page with
   * nothing selected: how many pixels, their box and the bands of rows that have ink (both in design px), and the mask itself.
   */
  const inkIn = async ([x0, y0, x1, y1]) => {
    await page.evaluate(() => window.__editor.getState().actions.clearSelection());
    await page.mouse.move(4, 4);
    await wait(400);
    const box = await page.locator(".cf-pageframe").boundingBox();
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    const png = await page.screenshot({ clip: box });
    return page.evaluate(
      async ({ bytes, zoom, region }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        const sx = Math.max(0, Math.round(region[0] * zoom));
        const sy = Math.max(0, Math.round(region[1] * zoom));
        const w = Math.min(bitmap.width, Math.round(region[2] * zoom)) - sx;
        const h = Math.min(bitmap.height, Math.round(region[3] * zoom)) - sy;
        const d = g.getImageData(sx, sy, w, h).data;
        let mask = "";
        let count = 0;
        let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
        const rows = new Array(h).fill(false);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const ink = d[i] + d[i + 1] + d[i + 2] < 382;
            mask += ink ? "1" : "0";
            if (!ink) continue;
            count++;
            rows[y] = true;
            l = Math.min(l, x);
            t = Math.min(t, y);
            r = Math.max(r, x + 1);
            b = Math.max(b, y + 1);
          }
        const bands = [];
        rows.forEach((on, y) => {
          if (on && (y === 0 || !rows[y - 1])) bands.push([y, y + 1]);
          else if (on) bands[bands.length - 1][1] = y + 1;
        });
        const toPage = (v, o) => Math.round((v + o) / zoom);
        return {
          count,
          box: count ? [toPage(l, sx), toPage(t, sy), toPage(r, sx), toPage(b, sy)] : null,
          bands: bands.map(([a, c]) => [toPage(a, sy), toPage(c, sy)]),
          mask,
          w,
          h,
          zoom,
        };
      },
      { bytes: Array.from(png), zoom, region: [x0, y0, x1, y1] },
    );
  };
  /** how much of two masks of the same part of the page lands on the other one, `slack` pixels allowed (the smaller of both ways) */
  const overlap = (a, b, slack = 1) => {
    const share = (p, q) => {
      let hit = 0;
      let all = 0;
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          if (p.mask[y * p.w + x] !== "1") continue;
          all++;
          let found = false;
          for (let dy = -slack; dy <= slack && !found; dy++)
            for (let dx = -slack; dx <= slack && !found; dx++) {
              const yy = y + dy;
              const xx = x + dx;
              if (yy >= 0 && yy < q.h && xx >= 0 && xx < q.w && q.mask[yy * q.w + xx] === "1") found = true;
            }
          if (found) hit++;
        }
      return all ? hit / all : 0;
    };
    return Math.min(share(a, b), share(b, a));
  };
  /**
   * Whether this browser draws the letters of a variable font at the weight they are asked in. Playwright's WebKit build on
   * Windows does not: it lays the text out with the advances of that weight (measureText gives Chrome's widths to the hundredth),
   * but draws every letter with the outline of the font's default instance, on the canvas and in the page alike (Inter "Shape" at
   * 200px: 27,384 / 27,288 / 27,391 ink pixels at weights 200 / 400 / 900, against Chrome's 14,786 / 27,594 / 51,529). The
   * letters Convert to shapes makes are those of the weight asked for, so there the text and its shapes cannot agree exactly.
   * Safari (Core Text) applies the weight axis. Asked once a family, by drawing an H light and heavy.
   */
  const weightsDrawn = {};
  const drawsWeightsOf = async (family) => {
    if (weightsDrawn[family] === undefined)
      weightsDrawn[family] = await page.evaluate(async (family) => {
        const face = [...document.fonts].find((f) => f.family.replace(/"/g, "") === family + " Variable" && f.status === "loaded");
        if (!face) return true; // not a variable font: every weight is a file of its own
        const ink = (weight) => {
          const canvas = document.createElement("canvas");
          canvas.width = 200;
          canvas.height = 150;
          const g = canvas.getContext("2d", { willReadFrequently: true });
          g.font = `${weight} 100px "${family} Variable"`;
          g.fillText("H", 20, 120);
          const d = g.getImageData(0, 0, 200, 150).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++;
          return n;
        };
        return ink(800) > ink(200) * 1.5;
      }, family);
    return weightsDrawn[family];
  };
  /**
   * How closely the ink of a text and of its shapes must agree: one pixel of slack, 95% of the ink, a box within `box` screen px
   * and as many pixels within 10%; or, where the browser draws a variable font at one weight only (`drawsWeightsOf`), a slack of
   * LOOSE screen px each way, which is half the difference in stem width between the weights 400 and 900 of Inter at this size
   * (an "l" at 200px is 17 design px wide at 400 and 39 at 900: 11 px a side, 6 screen px at the zoom of 0.55 the page opens at),
   * and no count of pixels (the weights have different amounts of ink by design; the weight step below checks the shapes' own).
   * The layout itself agrees in both engines (the same advances), so the strict check at Inter 400 runs in every engine.
   */
  const LOOSE = 6;
  const agreement = async (family, box = 2) =>
    (await drawsWeightsOf(family)) ? { slack: 1, share: 0.95, box, count: true } : { slack: LOOSE, share: 0.95, box: LOOSE + box, count: false };
  const pct = (v) => Math.round(v * 100) + "%";
  const boxText = (b) => `${b[0]},${b[1]} to ${b[2]},${b[3]}`;
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

  const contextMenu = () => page.getByRole("menu", { name: "Context menu" });
  const toolbar = () => page.getByRole("toolbar", { name: "Selected element common controls" });
  /** right-clicks the middle of an element and chooses Convert to shapes */
  const convertByRightClick = async (el) => {
    const [sx, sy] = await screenAt(...middleOf(el));
    await page.mouse.click(sx, sy, { button: "right" });
    await contextMenu().waitFor({ timeout: 8000 });
    await contextMenu()
      .getByRole("menuitem", { name: /^Convert to shapes/ })
      .click();
  };
  /** clicks an element and chooses Convert to shapes from the "..." menu of the toolbar */
  const convertByToolbar = async (el) => {
    const [sx, sy] = await screenAt(...middleOf(el));
    await page.mouse.click(sx, sy);
    await wait(300);
    await toolbar().getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Convert to shapes/ }).click();
  };
  /** waits until the text `id` is gone from the page (fontkit and the font file load on first use: a slow laptop needs time) */
  const convertedFrom = async (id) => {
    await page.waitForFunction(
      (id) => {
        const s = window.__editor.getState();
        return !s.design.pages.find((p) => p.id === s.activePageId).elements.some((e) => e.id === id);
      },
      id,
      { timeout: 90000 },
    );
    await wait(300);
    return (await state()).els;
  };
  /** the toast that says `text` (a part of it is enough) */
  const toastSaying = (text) => page.getByText(text, { exact: false }).first();
  const closeToasts = async () => {
    await page.keyboard.press("Escape");
    await wait(200);
  };
  /** what a converted text must be: a group of path shapes; gives it */
  const groupOfPaths = (els, letters) => {
    if (els.length !== 1) throw new Error(els.length + " elements on the page: " + els.map((e) => e.type));
    const g = els[0];
    if (g.type !== "group") throw new Error("the text became a " + g.type);
    const kinds = g.children.map((c) => (c.type === "shape" ? c.shape : c.type));
    if (kinds.some((k) => k !== "path")) throw new Error("not all paths: " + kinds);
    if (g.children.some((c) => !/^M/.test(c.path || ""))) throw new Error("a shape has no path data");
    if (letters !== undefined && g.children.length !== letters) throw new Error(g.children.length + " shapes for " + letters + " letters");
    return g;
  };

  /* ---------------- a new design ---------------- */
  await step("a presentation opens", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 30000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 30000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 30000 });
    await wait(1200);
    const s = await state();
    return s.els.length + " elements";
  });

  /* ---------------- convert, from the right-click menu ---------------- */
  let text = null; // the text as it was before it was converted
  let before = null; // its ink
  let group = null;
  const REGION = [100, 150, 1500, 650];
  await step("a heading typed from the Text tab, made large", async () => {
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await wait(500);
    await page
      .getByRole("button", { name: /Add a heading/i })
      .first()
      .click();
    await wait(600);
    await page.keyboard.type("Craft", { delay: 40 });
    await page.keyboard.press("Escape");
    await wait(400);
    let s = await state();
    const made = s.els.find((e) => e.type === "text");
    if (!made || made.paragraphs[0].runs.map((r) => r.text).join("") !== "Craft") throw new Error("the heading says " + JSON.stringify(made?.paragraphs));
    // a known place and a large size, so that the pixels are easy to read
    await page.evaluate((id) => {
      const { actions } = window.__editor.getState();
      actions.selectAll();
      actions.deleteElements(window.__editor.getState().selection.filter((x) => x !== id));
      actions.updateElements([id], { x: 300, y: 300 });
      actions.setTextProps([id], { fontSize: 200 });
      actions.clearSelection();
    }, made.id);
    await settle();
    s = await state();
    text = s.els.find((e) => e.id === made.id);
    model = { ...text };
    if (s.els.length !== 1) throw new Error(s.els.length + " elements");
    before = await inkIn(REGION);
    if (!before.box) throw new Error("the heading is not drawn");
    await shot("heading");
    return `${text.fontFamily} ${text.fontWeight}, ${text.fontSize}px, box ${Math.round(text.x)},${Math.round(text.y)} ${Math.round(text.width)}x${Math.round(text.height)}, ink ${boxText(before.box)}`;
  });

  await step("right-click, Convert to shapes: one group of five path shapes, one a letter, where the letters were", async () => {
    await convertByRightClick(text);
    const els = await convertedFrom(text.id);
    group = groupOfPaths(els, 5);
    await toastSaying("Converted to 5 shapes. The text can no longer be edited as text; Undo brings it back.").waitFor({ timeout: 10000 });
    const s = await state();
    if (s.sel.length !== 1 || s.sel[0] !== group.id) throw new Error("selection " + s.sel);
    // the box of the group is the box of the ink, inside the text box
    const g = [group.x, group.y, group.x + group.width, group.y + group.height];
    const tol = (await agreement(text.fontFamily, 3)).box / before.zoom; // three screen pixels (where the weight is drawn)
    if (!g.every((v, i) => near(v, before.box[i], tol))) throw new Error(`the group is at ${boxText(g.map(Math.round))}, the letters were drawn at ${boxText(before.box)}`);
    if (g[0] < text.x - 1 || g[1] < text.y - 1 || g[2] > text.x + text.width + 1 || g[3] > text.y + text.height + 1)
      throw new Error("the group is outside the text box: " + boxText(g.map(Math.round)));
    // the letters in order from left to right, each inside the group
    const lefts = group.children.map((c) => c.x);
    if (lefts.some((v, i) => i && v <= lefts[i - 1])) throw new Error("the letters are not in order: " + lefts.map(Math.round));
    if (group.children.some((c) => c.fill?.color !== INK)) throw new Error("fills " + group.children.map((c) => c.fill?.color));
    await shot("converted");
    return `group ${boxText(g.map(Math.round))}, text box ${Math.round(text.x)},${Math.round(text.y)} to ${Math.round(text.x + text.width)},${Math.round(text.y + text.height)}`;
  });

  await step("the pixels: the ink of the shapes lands where the ink of the text was", async () => {
    const after = await inkIn(REGION);
    if (!after.box) throw new Error("nothing is drawn");
    const a = await agreement(text.fontFamily);
    const tol = a.box / after.zoom;
    if (!after.box.every((v, i) => near(v, before.box[i], tol))) throw new Error(`ink at ${boxText(after.box)}, was at ${boxText(before.box)}`);
    const same = overlap(before, after, a.slack);
    if (same < a.share) throw new Error(`only ${pct(same)} of the ink is in the same place (${a.slack} px of slack)`);
    const ratio = after.count / before.count;
    if (a.count && (ratio < 0.9 || ratio > 1.1)) throw new Error(`${after.count} ink pixels, ${before.count} before`);
    await shot("converted-drawn");
    return `ink ${boxText(after.box)} (was ${boxText(before.box)}), ${pct(same)} in the same place (${a.slack} px of slack; ${pct(overlap(before, after))} with 1), ${after.count} / ${before.count} pixels`;
  });

  await step("one Ctrl+Z gives the text back exactly, Ctrl+Shift+Z converts it again", async () => {
    const pastBefore = (await state()).past;
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Control+z");
    await wait(400);
    let s = await state();
    if (s.els.length !== 1 || JSON.stringify(s.els[0]) !== JSON.stringify(text)) throw new Error("after undo: " + JSON.stringify(s.els.map((e) => [e.type, e.id])));
    if (s.past !== pastBefore - 1) throw new Error(`undo went from ${pastBefore} to ${s.past} steps`);
    const back = await inkIn(REGION);
    if (overlap(before, back) < 0.98) throw new Error("the text is not drawn as it was");
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Control+Shift+z");
    await wait(400);
    s = await state();
    if (s.els.length !== 1 || JSON.stringify(s.els[0]) !== JSON.stringify(group)) throw new Error("after redo: " + JSON.stringify(s.els.map((e) => [e.type, e.id])));
    return "the same text (id " + text.id + "), then the same group (id " + group.id + ")";
  });

  /* ---------------- the "..." menu, a variable font ---------------- */
  const weights = {};
  for (const weight of [200, 900]) {
    await step(`the "..." menu of the toolbar converts Inter at weight ${weight}, drawn as the canvas drew it`, async () => {
      const id = await setUpText("Shape", { fontFamily: "Inter", fontWeight: weight, fontSize: 200, x: 300, y: 300 });
      await settle();
      const t = (await state()).els[0];
      const was = await inkIn(REGION);
      await convertByToolbar(t);
      const els = await convertedFrom(id);
      groupOfPaths(els, 5);
      const now = await inkIn(REGION);
      const a = await agreement("Inter");
      const same = overlap(was, now, a.slack);
      if (same < a.share) throw new Error(`only ${pct(same)} of the ink is in the same place (${a.slack} px of slack)`);
      const ratio = now.count / was.count;
      if (a.count && (ratio < 0.9 || ratio > 1.1)) throw new Error(`${now.count} ink pixels, ${was.count} as text`);
      weights[weight] = now.count;
      await shot("inter-" + weight);
      return `${pct(same)} in the same place (${a.slack} px of slack; ${pct(overlap(was, now))} with 1), ${now.count} / ${was.count} pixels`;
    });
  }
  // the weight of Inter's default instance, which every engine draws as asked (see drawsWeightsOf): held to one pixel everywhere
  await step("Inter at weight 400 converts exactly as every engine draws it: 95% of the ink within a pixel, as many pixels", async () => {
    const id = await setUpText("Shape", { fontFamily: "Inter", fontWeight: 400, fontSize: 200, x: 300, y: 300 });
    await settle();
    const t = (await state()).els[0];
    const was = await inkIn(REGION);
    await convertByToolbar(t);
    groupOfPaths(await convertedFrom(id), 5);
    const now = await inkIn(REGION);
    const same = overlap(was, now);
    if (same < 0.95) throw new Error(`only ${pct(same)} of the ink is in the same place`);
    const ratio = now.count / was.count;
    if (ratio < 0.9 || ratio > 1.1) throw new Error(`${now.count} ink pixels, ${was.count} as text`);
    if (!now.box.every((v, i) => near(v, was.box[i], 2 / now.zoom))) throw new Error(`ink at ${boxText(now.box)}, was at ${boxText(was.box)}`);
    return `${pct(same)} in the same place, ${now.count} / ${was.count} pixels at a zoom of ${now.zoom.toFixed(2)}`;
  });

  await step("the weight is the one the text had: the heavy letters have far more ink than the light ones", async () => {
    if (!weights[200] || !weights[900]) throw new Error("a weight did not convert");
    const ratio = weights[900] / weights[200];
    if (ratio < 2) throw new Error(`900 has ${weights[900]} pixels, 200 has ${weights[200]}`);
    return `x${ratio.toFixed(1)}`;
  });

  /* ---------------- refusals ---------------- */
  const refused = async (name, words, patch, message) => {
    await step(name, async () => {
      await setUpText(words, patch);
      await settle();
      const t = (await state()).els[0];
      const was = await state();
      await convertByRightClick(t);
      await toastSaying(message).waitFor({ timeout: 90000 });
      await wait(500);
      const now = await state();
      if (JSON.stringify(now.els) !== JSON.stringify(was.els)) throw new Error("the page changed: " + now.els.map((e) => e.type));
      if (now.past !== was.past) throw new Error(`undo has ${now.past} steps, had ${was.past}`);
      await shot("refused-" + name.split(" ")[0]);
      await closeToasts();
      return "said so, nothing changed";
    });
  };
  await refused(
    "curved text is refused with a message that says to set Curve to 0",
    "Curved",
    { fontSize: 120, x: 300, y: 300, curve: 60 },
    "Curved text cannot be converted to shapes yet. Set Curve to 0 first, then convert.",
  );
  await refused(
    "a font Craftly has no file of is refused with a message that says to choose another or upload it",
    "System",
    { fontFamily: "Arial", fontWeight: 400, fontSize: 160, x: 300, y: 300 },
    'Craftly does not have the font file of "Arial", so the letters cannot be converted. Choose a font from the list, or upload this one under Brand kit > Your fonts.',
  );
  // 51 words of ten letters: 510 letters
  await refused(
    "more than 500 letters are refused with a message that nothing was changed",
    Array.from({ length: 51 }, () => "abcdefghij").join(" "),
    { fontSize: 24, x: 100, y: 100, width: 1700, autoWidth: false, height: 400 },
    "This text is too long to convert: it has more than 500 letters or 20,000 points. Nothing was changed.",
  );
  await step("exactly 500 letters still convert, to 500 shapes", async () => {
    const id = await setUpText(Array.from({ length: 50 }, () => "llllllllll").join(" "), { fontSize: 24, x: 100, y: 100, width: 1700, autoWidth: false, height: 400 });
    await settle();
    const t = (await state()).els[0];
    await convertByRightClick(t);
    const els = await convertedFrom(id);
    groupOfPaths(els, 500);
    await toastSaying("Converted to 500 shapes.").waitFor({ timeout: 10000 });
    await closeToasts();
    return "500 shapes";
  });

  /* ---------------- what is left out ---------------- */
  await step("a text effect and a letter the font does not have are converted without them, and said so", async () => {
    // Plus Jakarta Sans ships its Latin letters only: the Cyrillic Ж is borrowed by the browser from another font
    const id = await setUpText("AЖB", {
      fontSize: 200,
      x: 300,
      y: 300,
      effect: { kind: "shadow", color: "#9aa0aa", offset: 50, direction: 45, blur: 0, transparency: 0 },
    });
    await settle();
    const t = (await state()).els[0];
    await convertByRightClick(t);
    const els = await convertedFrom(id);
    groupOfPaths(els, 2);
    await toastSaying(
      "Converted to 2 shapes. The text can no longer be edited as text; Undo brings it back. 1 letter is not in the font and was left out. The text effect is not kept.",
    ).waitFor({
      timeout: 10000,
    });
    await closeToasts();
    return "2 shapes, the message names both";
  });

  /* ---------------- a text that wraps ---------------- */
  await step("a text that wraps converts with the line breaks of the canvas", async () => {
    const id = await setUpText("Craft your story here today", { fontSize: 120, x: 300, y: 120, width: 760, autoWidth: false, height: 750 });
    await settle();
    const region = [200, 60, 1300, 1000];
    const was = await inkIn(region);
    if (was.bands.length < 3) throw new Error("the text is drawn on " + was.bands.length + " lines: " + JSON.stringify(was.bands));
    const t = (await state()).els[0];
    await convertByRightClick(t);
    const els = await convertedFrom(id);
    groupOfPaths(els, 23);
    const now = await inkIn(region);
    const a = await agreement(t.fontFamily);
    const tol = a.box / now.zoom;
    if (now.bands.length !== was.bands.length)
      throw new Error(`${now.bands.length} lines of ink, ${was.bands.length} as text: ${JSON.stringify(now.bands)} / ${JSON.stringify(was.bands)}`);
    if (now.bands.some((b, i) => !near(b[0], was.bands[i][0], tol) || !near(b[1], was.bands[i][1], tol)))
      throw new Error(`the lines are at ${JSON.stringify(now.bands)}, were at ${JSON.stringify(was.bands)}`);
    const same = overlap(was, now, a.slack);
    if (same < a.share) throw new Error(`only ${pct(same)} of the ink is in the same place (${a.slack} px of slack)`);
    await shot("wrapped");
    return `${now.bands.length} lines at ${now.bands.map((b) => b[0] + "-" + b[1]).join(", ")}, ${pct(same)} in the same place (${a.slack} px of slack)`;
  });

  /* ---------------- SVG ---------------- */
  let svgGroup = null;
  await step("the page downloads as SVG with a path for every letter and no text, drawn where the canvas draws it", async () => {
    const id = await setUpText("Craft", { fontSize: 200, x: 300, y: 300 });
    await settle();
    const t = (await state()).els[0];
    await convertByRightClick(t);
    svgGroup = groupOfPaths(await convertedFrom(id), 5);
    await closeToasts();
    const onCanvas = await inkIn(REGION);
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await wait(500);
    await page.getByLabel("File type").click();
    await page.getByRole("option", { name: /^SVG/ }).first().click();
    await wait(300);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click()]);
    const svg = fs.readFileSync(await dl.path(), "utf8");
    fs.writeFileSync(OUT + "page.svg", svg);
    await page.keyboard.press("Escape");
    await wait(300);
    const paths = (svg.match(/<path\b/g) || []).length;
    if (paths < 5) throw new Error(paths + " paths in the SVG");
    if (/<text\b/.test(svg)) throw new Error("the SVG still has <text>");
    // the file writes each path at the size of its shape (the store keeps it in a box of 100), so the letters are counted by their ink
    const letters = (svg.match(new RegExp(`<path d="M[^"]+Z" fill="${INK}"`, "g")) || []).length;
    if (letters !== svgGroup.children.length) throw new Error(`${letters} paths of the colour of the text, ${svgGroup.children.length} letters`);
    // the file drawn by the browser: its ink box is the ink box of the canvas
    const drawn = await page.evaluate(
      async ({ svg, w, h, region }) => {
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
        const d = g.getImageData(region[0], region[1], region[2] - region[0], region[3] - region[1]).data;
        const rw = region[2] - region[0];
        let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] + d[i + 1] + d[i + 2] >= 382) continue;
          const x = (i / 4) % rw;
          const y = Math.floor(i / 4 / rw);
          l = Math.min(l, x);
          t = Math.min(t, y);
          r = Math.max(r, x + 1);
          b = Math.max(b, y + 1);
        }
        return l === Infinity ? null : [l + region[0], t + region[1], r + region[0], b + region[1]];
      },
      {
        svg,
        w: await page.evaluate(() => window.__editor.getState().design.width),
        h: await page.evaluate(() => window.__editor.getState().design.height),
        region: REGION,
      },
    );
    if (!drawn) throw new Error("the SVG draws nothing");
    const tol = 3 / onCanvas.zoom;
    if (!drawn.every((v, i) => near(v, onCanvas.box[i], tol))) throw new Error(`the SVG draws the letters at ${boxText(drawn)}, the canvas at ${boxText(onCanvas.box)}`);
    return `${paths} paths, no <text>, ${svg.length} bytes, letters at ${boxText(drawn)}`;
  });

  /* ---------------- after a reload ---------------- */
  await step("after a reload the shapes are there, and drawn as they were", async () => {
    await page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 30000 });
    const was = await inkIn(REGION);
    const kept = (await state()).els;
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 30000 });
    await wait(1500);
    const els = (await state()).els;
    if (JSON.stringify(els) !== JSON.stringify(kept)) throw new Error("the page is not as it was left: " + els.map((e) => e.type));
    const now = await inkIn(REGION);
    const same = overlap(was, now);
    if (same < 0.98) throw new Error(`only ${pct(same)} of the ink is in the same place`);
    await shot("reloaded");
    return `group ${els[0].id} of ${els[0].children.length} paths, ${pct(same)} drawn in the same place`;
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
