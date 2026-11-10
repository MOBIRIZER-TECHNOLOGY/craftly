/*
 * Blend modes as a person uses them in a real browser, read from the pixels: the Blend mode box in the Transparency popover of
 * the toolbar (mouse, keyboard, Normal takes the mode away), what every one of the fifteen modes draws over a backdrop and over
 * the white of the page (against the formulas of the W3C compositing standard), the same pixels in the exported PNG and in the
 * exported SVG when a browser draws that, a group that is mixed as one, a text that is mixed while it is painted and while it is
 * being edited, transparency and a mode together, undo and redo, a reload, a copy.
 *
 * The names of the modes are written out again here on purpose: if the application misspelled one, a browser would draw it as
 * Normal and this journey would see it.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("blend");
const results = [];
const logs = [];
let shotN = 0;

const MODES = [
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];
const LABELS = [
  "Darken",
  "Multiply",
  "Color burn",
  "Lighten",
  "Screen",
  "Color dodge",
  "Overlay",
  "Soft light",
  "Hard light",
  "Difference",
  "Exclusion",
  "Hue",
  "Saturation",
  "Color",
  "Luminosity",
];

/** a backdrop and a source with a different answer for every mode */
const BACKDROP = [200, 120, 45];
const SOURCE = [70, 130, 180];
const WHITE = [255, 255, 255];
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

/* ---- the formulas of https://www.w3.org/TR/compositing-1/#blending, for an opaque source over an opaque backdrop ---- */
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const clipColor = (c) => {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return out;
};
const setLum = (c, l) => {
  const d = l - lum(c);
  return clipColor(c.map((v) => v + d));
};
const sat = (c) => Math.max(...c) - Math.min(...c);
const setSat = (c, s) => {
  const [mn, md, mx] = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const out = [0, 0, 0];
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
    out[mx] = s;
  }
  return out;
};
const hardLight = (cb, cs) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));
const SEPARABLE = {
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) => hardLight(cs, cb),
  darken: Math.min,
  lighten: Math.max,
  "color-dodge": (cb, cs) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  "color-burn": (cb, cs) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  "hard-light": hardLight,
  "soft-light": (cb, cs) => {
    if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
    const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
    return cb + (2 * cs - 1) * (d - cb);
  },
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
};
/** the colour (r, g, b) that `source` gives over `backdrop` in `mode` */
const blendRgb = (mode, backdrop, source) => {
  const cb = backdrop.map((v) => v / 255);
  const cs = source.map((v) => v / 255);
  let out;
  if (SEPARABLE[mode]) out = cb.map((v, i) => SEPARABLE[mode](v, cs[i]));
  else if (mode === "hue") out = setLum(setSat(cs, sat(cb)), lum(cb));
  else if (mode === "saturation") out = setLum(setSat(cb, sat(cs)), lum(cb));
  else if (mode === "color") out = setLum(cs, lum(cb));
  else if (mode === "luminosity") out = setLum(cb, lum(cs));
  else throw new Error("no formula for " + mode);
  return out.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
};
const mix = (a, b, k) => a.map((v, i) => Math.round(v * (1 - k) + b[i] * k));
const close = (got, want, tolerance = 4) => got.every((v, i) => Math.abs(v - want[i]) <= tolerance);
const rgb = (c) => `rgb(${c.join(",")})`;

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
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 300));
      await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);

  /** the elements of the active page (what the checks need of them), the selection and whether the design is saved */
  const state = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      const brief = (e) => ({
        id: e.id,
        type: e.type,
        blend: e.blend,
        hasBlend: "blend" in e,
        opacity: e.opacity,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        children: e.children ? e.children.map(brief) : undefined,
      });
      return { sel: s.selection, saveState: s.saveState, width: s.design.width, height: s.design.height, zoom: s.zoom, els: pg.elements.map(brief) };
    });
  const act = (name, ...args) => page.evaluate(({ name, args }) => window.__editor.getState().actions[name](...args), { name, args });
  const settle = () => page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 });

  /** empties the page and puts rectangles on it ({ x, y, w, h, fill, blend?, opacity? }, in design px); gives their ids */
  const setUp = (list) =>
    page.evaluate((list) => {
      const { actions } = window.__editor.getState();
      actions.selectAll();
      actions.deleteElements();
      const els = list.map((s) => ({
        id: "x",
        type: "shape",
        shape: "rect",
        x: s.x,
        y: s.y,
        width: s.w,
        height: s.h,
        rotation: 0,
        opacity: s.opacity ?? 1,
        fill: { type: "solid", color: s.fill },
        stroke: null,
        radius: 0,
        ...(s.blend ? { blend: s.blend } : {}),
      }));
      return actions.addElements(els, { center: false, select: false });
    }, list);

  /** a screenshot of the page with nothing selected, and where the page is in it */
  const pagePicture = async () => {
    await act("clearSelection");
    await page.mouse.move(4, 4);
    await wait(350);
    const box = await page.locator(".cf-pageframe").boundingBox();
    const zoom = (await state()).zoom;
    return { png: await page.screenshot({ clip: box }), zoom };
  };
  /** the colours (r, g, b) of points of the page given in design px, as a browser shows the page */
  const colorsAt = async (points) => {
    const { png, zoom } = await pagePicture();
    return page.evaluate(
      async ({ b64, points, zoom }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        return points.map(([x, y]) => Array.from(g.getImageData(Math.round(x * zoom), Math.round(y * zoom), 1, 1).data.slice(0, 3)));
      },
      { b64: png.toString("base64"), points, zoom },
    );
  };
  /** how many pixels of a region of the page (design px) are near each of the colours */
  const countColors = async (region, colours, tolerance = 6) => {
    const { png, zoom } = await pagePicture();
    return page.evaluate(
      async ({ b64, region, colours, tolerance, zoom }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        const [x, y, w, h] = region.map((v) => Math.round(v * zoom));
        const data = g.getImageData(x, y, w, h).data;
        const counts = colours.map(() => 0);
        for (let i = 0; i < data.length; i += 4)
          colours.forEach((c, k) =>
            Math.abs(data[i] - c[0]) <= tolerance && Math.abs(data[i + 1] - c[1]) <= tolerance && Math.abs(data[i + 2] - c[2]) <= tolerance ? counts[k]++ : 0,
          );
        return counts;
      },
      { b64: png.toString("base64"), region, colours, tolerance, zoom },
    );
  };
  /** the colours of points of a picture the browser draws from a PNG or an SVG (design px, the picture as big as the design) */
  const colorsInFile = (kind, content, points, size) =>
    page.evaluate(
      async ({ kind, content, points, size }) => {
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        if (kind === "png") {
          const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          g.drawImage(bitmap, 0, 0, size.width, size.height);
        } else {
          const img = new Image();
          img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(content);
          await img.decode();
          g.drawImage(img, 0, 0, size.width, size.height);
        }
        return points.map(([x, y]) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)));
      },
      { kind, content, points, size },
    );

  /** what is wrong with what is on show inside `selector`: text with less contrast than WCAG AA asks for, controls smaller than 24 px, anything past the right edge */
  const inspect = (selector) =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return { missing: true, faint: [], small: [], outside: [] };
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
        if (!node.textContent.trim() || !el.getClientRects().length) continue;
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
      for (const el of root.querySelectorAll("button, summary, a[href], input, select, textarea, [role=button], [role=combobox], [role=option]")) {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const name = (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 28);
        if (box.width < 24 || box.height < 24) small.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
        if (box.right > window.innerWidth + 0.5) outside.push(`${name} ends at ${Math.round(box.right)} of ${window.innerWidth}`);
      }
      return { faint, small, outside };
    }, selector);

  const toolbar = () => page.locator("[role=toolbar]:not(.cf-rail)");
  const popover = () => page.getByRole("dialog", { name: "Transparency" });
  const modeBox = () => popover().getByRole("combobox", { name: "Blend mode" });
  const openTransparency = async () => {
    await toolbar().getByRole("button", { name: "Transparency", exact: true }).click();
    await popover().waitFor({ timeout: 5000 });
  };
  const closeTransparency = async () => {
    await page.keyboard.press("Escape");
    await popover().waitFor({ state: "hidden", timeout: 5000 });
  };
  const only = async (id) => (await state()).els.find((e) => e.id === id);

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
    return `${s.width}x${s.height}, ${s.els.length} elements`;
  });

  /* ---------------- the box in the toolbar ---------------- */
  let a;
  let b;
  const OVERLAP = [850, 600];
  const ONLY_B = [1200, 800];
  const ONLY_A = [400, 350];
  const pair = async (extra = {}) => {
    [a, b] = await setUp([
      { x: 300, y: 300, w: 700, h: 450, fill: hex(BACKDROP) },
      { x: 700, y: 450, w: 700, h: 450, fill: hex(SOURCE), ...extra },
    ]);
  };

  await step("the Transparency popover has a Blend mode box that says Normal, under the transparency", async () => {
    await pair();
    await act("select", [b]);
    await wait(300);
    await openTransparency();
    const text = (await modeBox().textContent()) ?? "";
    if (!/Normal/.test(text)) throw new Error("the box says " + JSON.stringify(text));
    const labelled = await popover().getByText("Blend mode", { exact: true }).count();
    const sliderBox = await popover().getByRole("slider", { name: "Transparency" }).boundingBox();
    const boxBox = await modeBox().boundingBox();
    if (!(boxBox.y > sliderBox.y)) throw new Error("the box is not under the slider");
    await shot("popover");
    return `label shown ${labelled}x, box ${Math.round(boxBox.width)}x${Math.round(boxBox.height)}`;
  });

  await step("the popover and its list have text you can read and controls you can hit", async () => {
    const seen = await inspect('[role="dialog"][aria-label="Transparency"]');
    await modeBox().click();
    await page.getByRole("listbox").waitFor({ timeout: 5000 });
    await shot("list");
    const list = await inspect(".cf-select__popover");
    const names = await page.getByRole("option").allTextContents();
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "hidden", timeout: 5000 });
    await wait(250);
    const all = [...seen.faint, ...list.faint];
    const small = [...seen.small, ...list.small];
    if (all.length) throw new Error("faint text: " + all.join("; "));
    if (small.length) throw new Error("controls under 24 px: " + small.join("; "));
    if (names.join("|") !== ["Normal", ...LABELS].join("|")) throw new Error("the list says " + names.join(", "));
    return `${names.length} options`;
  });

  await step("the box can be reached and used with the keyboard alone: slider, number, box, then the list", async () => {
    // from a popover that is closed, as a person starts
    if (
      await popover()
        .isVisible()
        .catch(() => false)
    )
      await closeTransparency();
    await openTransparency();
    await wait(250);
    const focusName = () => page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim());
    await popover().focus();
    const order = [];
    const detail = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      // a person is slower than the browser's next frame: a number field that takes the focus selects its text in that frame, and in Chrome selecting focuses
      await wait(80);
      order.push(await focusName());
      detail.push(
        await page.evaluate(() => {
          const a = document.activeElement;
          return `${a.tagName.toLowerCase()}[${a.getAttribute("role")}].${String(a.className).slice(0, 30)} value=${a.value ?? ""}`;
        }),
      );
    }
    if (order.join("|") !== "Transparency|Transparency value|Blend mode") throw new Error("the focus goes " + order.join(" > ") + " :: " + detail.join(" > "));
    await page.keyboard.press("ArrowDown");
    await page.getByRole("listbox").waitFor({ timeout: 5000 });
    await wait(150);
    const startedOn = await focusName();
    await page.keyboard.type("Scr", { delay: 60 });
    await wait(80);
    const movedTo = await focusName();
    await page.keyboard.press("Enter");
    await wait(300);
    const el = await only(b);
    if (el.blend !== "screen") throw new Error(`the mode is ${el.blend} (the list started on ${startedOn}, typing Scr moved to ${movedTo})`);
    return order.join(" > ") + ", Screen by typing its name";
  });

  await step("Screen draws the screen of the two colours where they overlap and white where the shape is over the page", async () => {
    const [overlap, onlyB, onlyA] = await colorsAt([OVERLAP, ONLY_B, ONLY_A]);
    const want = blendRgb("screen", BACKDROP, SOURCE);
    if (!close(overlap, want)) throw new Error(`overlap ${rgb(overlap)}, wanted ${rgb(want)}`);
    if (!close(onlyB, WHITE)) throw new Error(`over the page ${rgb(onlyB)}, wanted white`);
    if (!close(onlyA, BACKDROP)) throw new Error(`the backdrop changed to ${rgb(onlyA)}`);
    return `${rgb(overlap)} over the backdrop, ${rgb(onlyB)} over the page`;
  });

  await step("choosing Multiply with the mouse mixes the shape with the one under it and leaves the colour over the page alone", async () => {
    await act("select", [b]);
    await wait(300);
    await openTransparency();
    if (!/Screen/.test((await modeBox().textContent()) ?? "")) throw new Error("the box does not show the mode the shape has");
    await modeBox().click();
    await page.getByRole("option", { name: "Multiply", exact: true }).click();
    await wait(300);
    await closeTransparency();
    const el = await only(b);
    if (el.blend !== "multiply") throw new Error("the mode is " + el.blend);
    const [overlap, onlyB] = await colorsAt([OVERLAP, ONLY_B]);
    const want = blendRgb("multiply", BACKDROP, SOURCE);
    if (!close(overlap, want)) throw new Error(`overlap ${rgb(overlap)}, wanted ${rgb(want)}`);
    if (!close(onlyB, SOURCE)) throw new Error(`over the page ${rgb(onlyB)}, wanted ${rgb(SOURCE)}`);
    return `${rgb(overlap)}`;
  });

  await step("transparency and a mode work together: half transparent Multiply is half way between the backdrop and the multiplied colour", async () => {
    await act("updateElements", [b], { opacity: 0.5 });
    await wait(300);
    const [overlap, onlyB] = await colorsAt([OVERLAP, ONLY_B]);
    const want = mix(BACKDROP, blendRgb("multiply", BACKDROP, SOURCE), 0.5);
    if (!close(overlap, want)) throw new Error(`overlap ${rgb(overlap)}, wanted ${rgb(want)}`);
    const wantOver = mix(WHITE, SOURCE, 0.5);
    if (!close(onlyB, wantOver)) throw new Error(`over the page ${rgb(onlyB)}, wanted ${rgb(wantOver)}`);
    return `${rgb(overlap)}`;
  });

  await step("Normal takes the mode away, and nothing about it stays in the shape", async () => {
    await act("updateElements", [b], { opacity: 1 });
    await act("select", [b]);
    await wait(300);
    await openTransparency();
    await modeBox().click();
    await page.getByRole("option", { name: "Normal", exact: true }).click();
    await wait(300);
    await closeTransparency();
    const el = await only(b);
    if (el.hasBlend) throw new Error("the shape still has a blend: " + JSON.stringify(el.blend));
    const [overlap] = await colorsAt([OVERLAP]);
    if (!close(overlap, SOURCE)) throw new Error(`overlap ${rgb(overlap)}, wanted ${rgb(SOURCE)}`);
    return "overlap is the colour of the shape again";
  });

  await step("undo takes a mode back and redo gives it again, in the pixels too", async () => {
    await act("updateElements", [b], { blend: "multiply" });
    await wait(300);
    const [mixed] = await colorsAt([OVERLAP]);
    await act("undo");
    await wait(300);
    const [plain] = await colorsAt([OVERLAP]);
    const undone = await only(b);
    await act("redo");
    await wait(300);
    const [again] = await colorsAt([OVERLAP]);
    const redone = await only(b);
    const want = blendRgb("multiply", BACKDROP, SOURCE);
    if (!close(mixed, want) || !close(again, want)) throw new Error(`mixed ${rgb(mixed)}, again ${rgb(again)}, wanted ${rgb(want)}`);
    if (!close(plain, SOURCE) || undone.hasBlend) throw new Error(`after undo ${rgb(plain)}, blend ${undone.blend}`);
    if (redone.blend !== "multiply") throw new Error("after redo the mode is " + redone.blend);
    return "multiply > normal > multiply";
  });

  await step("a copy of the shape has its mode", async () => {
    await act("select", [b]);
    await act("duplicateSelection");
    await wait(300);
    const s = await state();
    const copy = s.els.find((e) => e.id !== a && e.id !== b && e.blend === "multiply");
    if (!copy || s.els.length !== 3) throw new Error("no copy with the mode among " + s.els.map((e) => e.blend).join(","));
    await act("undo");
    return "the copy has multiply";
  });

  await step("the mode is still there after the design is saved and the page is loaded again", async () => {
    await settle();
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    const el = await only(b);
    if (!el || el.blend !== "multiply") throw new Error("after the reload the mode is " + el?.blend);
    const [overlap] = await colorsAt([OVERLAP]);
    const want = blendRgb("multiply", BACKDROP, SOURCE);
    if (!close(overlap, want)) throw new Error(`overlap ${rgb(overlap)}, wanted ${rgb(want)}`);
    return rgb(overlap);
  });

  /* ---------------- all fifteen modes at once ---------------- */
  const COLUMNS = 5;
  const CELL = { w: 384, h: 360 };
  const cellOrigin = (i) => [(i % COLUMNS) * CELL.w, Math.floor(i / COLUMNS) * CELL.h];
  const spots = (i) => {
    const [cx, cy] = cellOrigin(i);
    return { overlap: [cx + 190, cy + 145], onlyShape: [cx + 290, cy + 240], onlyBackdrop: [cx + 80, cy + 60] };
  };
  const gridList = MODES.flatMap((mode, i) => {
    const [cx, cy] = cellOrigin(i);
    return [
      { x: cx + 40, y: cy + 30, w: 220, h: 170, fill: hex(BACKDROP) },
      { x: cx + 120, y: cy + 90, w: 200, h: 180, fill: hex(SOURCE), blend: mode },
    ];
  });

  await step("fifteen pairs of shapes are on the page, each pair with its own mode", async () => {
    await setUp(gridList);
    await wait(600);
    const s = await state();
    const modes = s.els.filter((e) => e.blend).map((e) => e.blend);
    if (modes.join() !== MODES.join()) throw new Error("modes on the page: " + modes.join());
    return `${s.els.length} shapes`;
  });

  await step("every mode draws what the compositing standard says, over a backdrop and over the white page", async () => {
    const points = MODES.flatMap((_m, i) => Object.values(spots(i)));
    const got = await colorsAt(points);
    const wrong = [];
    const seen = new Set();
    MODES.forEach((mode, i) => {
      const [overlap, onlyShape, onlyBackdrop] = got.slice(i * 3, i * 3 + 3);
      const wantOverlap = blendRgb(mode, BACKDROP, SOURCE);
      const wantOver = blendRgb(mode, WHITE, SOURCE);
      seen.add(rgb(overlap));
      if (!close(overlap, wantOverlap, 5)) wrong.push(`${mode} over the backdrop ${rgb(overlap)} wanted ${rgb(wantOverlap)}`);
      if (!close(onlyShape, wantOver, 5)) wrong.push(`${mode} over the page ${rgb(onlyShape)} wanted ${rgb(wantOver)}`);
      if (!close(onlyBackdrop, BACKDROP)) wrong.push(`${mode} changed the backdrop to ${rgb(onlyBackdrop)}`);
    });
    await shot("fifteen-modes");
    if (wrong.length) throw new Error(wrong.slice(0, 3).join(" | ") + (wrong.length > 3 ? ` (+${wrong.length - 3})` : ""));
    if (seen.size < 12) throw new Error("only " + seen.size + " different colours for fifteen modes");
    return `${seen.size} different colours over the backdrop`;
  });

  let pngB64 = "";
  let size = { width: 1920, height: 1080 };
  const download = async (kind) => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await wait(500);
    if (kind === "svg") {
      await page.getByLabel("File type").click();
      await page.getByRole("option", { name: /^SVG/ }).first().click();
      await wait(300);
    }
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click()]);
    const buf = fs.readFileSync(await dl.path());
    await page.keyboard.press("Escape");
    await wait(300);
    return { name: dl.suggestedFilename(), buf };
  };

  await step("the PNG that is downloaded has the same pixels, in every mode", async () => {
    size = { width: (await state()).width, height: (await state()).height };
    const file = await download("png");
    if (!file.name.endsWith(".png")) throw new Error("the file is " + file.name);
    pngB64 = file.buf.toString("base64");
    const points = MODES.flatMap((_m, i) => [spots(i).overlap, spots(i).onlyShape]);
    const got = await colorsInFile("png", pngB64, points, size);
    const wrong = [];
    MODES.forEach((mode, i) => {
      const wants = [blendRgb(mode, BACKDROP, SOURCE), blendRgb(mode, WHITE, SOURCE)];
      got.slice(i * 2, i * 2 + 2).forEach((c, k) => {
        if (!close(c, wants[k], 5)) wrong.push(`${mode} ${k ? "over the page" : "over the backdrop"} ${rgb(c)} wanted ${rgb(wants[k])}`);
      });
    });
    if (wrong.length) throw new Error(wrong.slice(0, 3).join(" | "));
    return `${file.name}, ${file.buf.length} bytes`;
  });

  await step("the SVG that is downloaded has a mix-blend-mode for every mode, and a browser draws the same pixels from it", async () => {
    const file = await download("svg");
    const text = file.buf.toString("utf8");
    if (!file.name.endsWith(".svg")) throw new Error("the file is " + file.name);
    const missing = MODES.filter((m) => !text.includes(`style="mix-blend-mode:${m}"`));
    if (missing.length) throw new Error("no mix-blend-mode for " + missing.join(", "));
    const points = MODES.flatMap((_m, i) => [spots(i).overlap, spots(i).onlyShape]);
    const got = await colorsInFile("svg", text, points, size);
    const wrong = [];
    MODES.forEach((mode, i) => {
      const wants = [blendRgb(mode, BACKDROP, SOURCE), blendRgb(mode, WHITE, SOURCE)];
      got.slice(i * 2, i * 2 + 2).forEach((c, k) => {
        if (!close(c, wants[k], 8)) wrong.push(`${mode} ${k ? "over the page" : "over the backdrop"} ${rgb(c)} wanted ${rgb(wants[k])}`);
      });
    });
    if (wrong.length) throw new Error(wrong.slice(0, 3).join(" | ") + (wrong.length > 3 ? ` (+${wrong.length - 3})` : ""));
    return `${file.name}, ${text.length} characters`;
  });

  /* ---------------- a group ---------------- */
  const GREEN = [0, 200, 0];
  const BLUE = [0, 0, 200];
  let group = "";
  await step("a group is mixed as one: where its shapes overlap, only the one on top shows through", async () => {
    const [, p, q] = await setUp([
      { x: 300, y: 300, w: 900, h: 600, fill: hex(BACKDROP) },
      { x: 400, y: 400, w: 400, h: 300, fill: hex(GREEN) },
      { x: 600, y: 500, w: 400, h: 300, fill: hex(BLUE) },
    ]);
    await act("select", [p, q]);
    await act("groupSelection");
    await wait(300);
    const s = await state();
    group = s.els.find((e) => e.type === "group").id;
    await act("updateElements", [group], { blend: "multiply" });
    await wait(300);
    const [onlyP, both, onlyQ, away] = await colorsAt([
      [450, 450],
      [700, 600],
      [900, 750],
      [350, 850],
    ]);
    const wantP = blendRgb("multiply", BACKDROP, GREEN);
    const wantQ = blendRgb("multiply", BACKDROP, BLUE);
    if (!close(onlyP, wantP)) throw new Error(`the first shape ${rgb(onlyP)}, wanted ${rgb(wantP)}`);
    if (!close(both, wantQ)) throw new Error(`where they overlap ${rgb(both)}, wanted ${rgb(wantQ)} (the shape on top, once)`);
    if (!close(onlyQ, wantQ)) throw new Error(`the second shape ${rgb(onlyQ)}, wanted ${rgb(wantQ)}`);
    if (!close(away, BACKDROP)) throw new Error(`the backdrop ${rgb(away)}`);
    await shot("group");
    return `overlap ${rgb(both)}`;
  });

  await step("ungrouping gives the mode to the shapes, which then mix one after the other, and undo makes the group again", async () => {
    await act("select", [group]);
    await act("ungroupSelection");
    await wait(300);
    const s = await state();
    const modes = s.els.filter((e) => e.type === "shape" && e.blend).length;
    if (modes !== 2) throw new Error(modes + " shapes with a mode after ungrouping");
    const [both] = await colorsAt([[700, 600]]);
    const want = blendRgb("multiply", blendRgb("multiply", BACKDROP, GREEN), BLUE);
    if (!close(both, want)) throw new Error(`where they overlap ${rgb(both)}, wanted ${rgb(want)}`);
    await act("undo");
    await wait(300);
    const back = await state();
    if (!back.els.some((e) => e.type === "group" && e.blend === "multiply")) throw new Error("no group with its mode after undo");
    return `overlap ${rgb(both)} instead of the group's`;
  });

  /* ---------------- a text ---------------- */
  const REGION = [150, 150, 1500, 700];
  await step("a text with a mode is mixed with what is under it, and keeps its mode when it has been edited", async () => {
    await setUp([{ x: 100, y: 100, w: 1600, h: 800, fill: hex(BACKDROP) }]);
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await wait(300);
    await page.getByRole("button", { name: /Add a text box/ }).click();
    await page.keyboard.type("BLEND", { delay: 10 });
    await page.keyboard.press("Escape");
    await wait(300);
    const id = (await state()).sel[0];
    await act("updateElements", [id], { fontSize: 420, fontWeight: 900, color: hex(SOURCE), x: 220, y: 250 });
    await act("select", [id]);
    await wait(300);
    await openTransparency();
    await modeBox().click();
    await page.getByRole("option", { name: "Multiply", exact: true }).click();
    await wait(300);
    await closeTransparency();
    if ((await only(id)).blend !== "multiply") throw new Error("the text has no mode");
    const multiplied = blendRgb("multiply", BACKDROP, SOURCE);
    const [painted] = await countColors(REGION, [multiplied]);
    const [plainPainted] = await countColors(REGION, [SOURCE]);
    if (painted < 3000) throw new Error(`only ${painted} pixels have the multiplied colour ${rgb(multiplied)}`);
    if (plainPainted > painted / 50) throw new Error(`${plainPainted} pixels still have the plain colour ${rgb(SOURCE)}`);
    // while it is edited the box over the page shows the text in its own colour (it is a layer above the canvas, with nothing to mix with): the picture is for the record
    await act("startTextEdit", id);
    await wait(500);
    await shot("text-edit");
    await page.keyboard.press("Escape");
    await wait(300);
    const edited = await only(id);
    if (edited.blend !== "multiply") throw new Error("after the edit the mode is " + edited.blend);
    const [after] = await countColors(REGION, [multiplied]);
    if (Math.abs(after - painted) > painted / 20) throw new Error(`${after} pixels have the multiplied colour after the edit, ${painted} before`);
    return `${painted} pixels before the edit, ${after} after`;
  });

  /* ---------------- a phone ---------------- */
  await step("in a window as narrow as a phone the popover and its list fit, and a mode can still be chosen", async () => {
    await pair();
    await page.setViewportSize({ width: 375, height: 812 });
    await wait(700);
    try {
      await act("select", [b]);
      await wait(500);
      await openTransparency();
      const dialog = await popover().boundingBox();
      if (dialog.x < -0.5 || dialog.x + dialog.width > 375.5) throw new Error(`the popover spans ${Math.round(dialog.x)} to ${Math.round(dialog.x + dialog.width)} of 375`);
      const small = await inspect('[role="dialog"][aria-label="Transparency"]');
      if (small.small.length || small.faint.length || small.outside.length) throw new Error(JSON.stringify(small));
      await modeBox().click();
      await page.getByRole("listbox").waitFor({ timeout: 5000 });
      await wait(600);
      // the panel that scrolls, not the list inside it (which is as tall as all its options)
      const list = await page.locator(".cf-select__popover").boundingBox();
      if (list.x < -0.5 || list.x + list.width > 375.5 || list.y < -0.5 || list.y + list.height > 812.5)
        throw new Error(`the list is at ${Math.round(list.x)},${Math.round(list.y)} ${Math.round(list.width)}x${Math.round(list.height)}`);
      await shot("phone");
      await page.getByRole("option", { name: "Overlay", exact: true }).click();
      await wait(300);
      if ((await only(b)).blend !== "overlay") throw new Error("the mode is " + (await only(b)).blend);
      return `popover ${Math.round(dialog.width)} px wide, list ${Math.round(list.width)}x${Math.round(list.height)}`;
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
      await wait(500);
    }
  });

  /* ---------------- the page ---------------- */
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
