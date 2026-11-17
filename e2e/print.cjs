/*
 * The print PDF, as a person makes it in a real browser: a presentation whose red background reaches every edge and a blue box
 * that hangs over the left edge, then Share > Download > PDF Print with a 3 mm bleed, crop marks, registration marks and CMYK
 * colours, chosen in the panel. The downloaded file is read back byte by byte: the TrimBox is the page, the BleedBox 3 mm more,
 * the MediaBox holds the marks; the page picture is a deflated 8-bit DeviceCMYK image at 300 dpi; the marks are thin vector
 * lines outside the bleed; the text is still there, invisible. The picture is decoded (zlib and the PNG predictors) to check that
 * the background fills the bleed all around and that the box continues into it. Chrome's own PDF viewer then draws the file when
 * it can (a headless browser often cannot show PDFs: that part says SKIP).
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { pathToFileURL } = require("node:url");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("print");
const results = [];
const logs = [];
let shotN = 0;

const RED = "#e11d48"; // rgb(225, 29, 72)
const BLUE = "#1f4fd8"; // rgb(31, 79, 216)
const MM_TO_PT = 72 / 25.4;
const ROOM_PT = 27; // CROP_MARK_ROOM_PT of src/export/pdf.ts: the room the marks get beyond the bleed

/* ---------------- reading the PDF ---------------- */

/** Every object of the file, through the xref table (so every offset and every /Length is checked on the way). */
function readObjects(buf) {
  const text = buf.toString("latin1");
  const tail = text.match(/startxref\n(\d+)\n%%EOF\n$/);
  if (!tail) throw new Error("no startxref at the end of the file");
  const xref = Number(tail[1]);
  const size = Number(text.slice(xref).match(/^xref\n0 (\d+)\n/)[1]);
  const table = text.slice(xref + `xref\n0 ${size}\n`.length);
  const objects = new Map();
  for (let n = 1; n < size; n++) {
    const offset = Number(table.slice(n * 20, n * 20 + 10));
    const head = `${n} 0 obj\n`;
    if (text.slice(offset, offset + head.length) !== head) throw new Error(`object ${n} is not where the xref says`);
    const start = offset + head.length;
    const end = text.indexOf("endobj\n", start);
    const streamAt = text.indexOf(">>\nstream\n", start);
    if (streamAt >= 0 && streamAt < end) {
      const dict = text.slice(start, streamAt + 2);
      const length = Number(dict.match(/\/Length (\d+)/)[1]);
      const from = streamAt + ">>\nstream\n".length;
      if (text.slice(from + length, from + length + 11) !== "\nendstream\n") throw new Error(`the /Length of object ${n} is wrong`);
      objects.set(n, { dict, stream: buf.subarray(from, from + length) });
    } else objects.set(n, { dict: text.slice(start, end).trim() });
  }
  return objects;
}

const box = (dict, name) => {
  const m = dict.match(new RegExp(`/${name} \\[([^\\]]*)\\]`));
  return m ? m[1].split(" ").map(Number) : null;
};

/** Undoes the PNG predictors of rows of 4-byte pixels, as a PDF reader does. */
function unpredict(bytes, width, rows) {
  const stride = width * 4;
  const out = new Uint8Array(stride * rows);
  for (let row = 0; row < rows; row++) {
    const type = bytes[row * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const raw = bytes[row * (stride + 1) + 1 + i];
      const left = i >= 4 ? out[row * stride + i - 4] : 0;
      const up = row > 0 ? out[(row - 1) * stride + i] : 0;
      const corner = row > 0 && i >= 4 ? out[(row - 1) * stride + i - 4] : 0;
      let p = 0;
      if (type === 1) p = left;
      else if (type === 2) p = up;
      else if (type === 3) p = (left + up) >> 1;
      else if (type === 4) {
        const q = left + up - corner;
        const [pa, pb, pc] = [Math.abs(q - left), Math.abs(q - up), Math.abs(q - corner)];
        p = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      } else if (type !== 0) throw new Error(`unknown PNG filter ${type} in row ${row}`);
      out[row * stride + i] = (raw + p) & 0xff;
    }
  }
  return out;
}

const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;
const sameBox = (a, b) => a && b && a.length === 4 && a.every((v, i) => near(v, b[i]));
const fmt = (b) => "[" + b.map((v) => Math.round(v * 1000) / 1000).join(" ") + "]";

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  const shot = (name, p = page) => p.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push((typeof r === "string" && r.startsWith("SKIP") ? "SKIP " : "PASS ") + name + (r ? "  " + r.replace(/^SKIP /, "") : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const dl = page.locator(".cf-dl");

  let design = null;
  let file = null;
  let pdf = null;

  /* ---------------- the design ---------------- */
  await step("setup: a presentation with a red background, a heading, and a blue box over the left edge", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await page
      .getByRole("button", { name: /Add a heading/i })
      .first()
      .click();
    await page.keyboard.type("Print me", { delay: 10 });
    await page.keyboard.press("Escape");
    await wait(300);
    design = await page.evaluate(
      ({ RED, BLUE }) => {
        const s = window.__editor.getState();
        const { actions } = s;
        const pg = s.design.pages.find((p) => p.id === s.activePageId);
        actions.setPageBackground({ type: "solid", color: RED }, pg.id);
        actions.addElements(
          [
            {
              id: "x",
              type: "shape",
              shape: "rect",
              x: -60,
              y: 400,
              width: 300,
              height: 300,
              rotation: 0,
              opacity: 1,
              fill: { type: "solid", color: BLUE },
              stroke: null,
              radius: 0,
            },
          ],
          { center: false, select: false },
        );
        actions.clearSelection();
        const d = window.__editor.getState().design;
        return { width: d.width, height: d.height, elements: d.pages[0].elements.map((e) => e.type) };
      },
      { RED, BLUE },
    );
    if (!design.elements.includes("text") || !design.elements.includes("shape")) throw new Error("elements: " + design.elements.join(", "));
    await wait(400);
    await shot("design");
    return `${design.width} x ${design.height} px, ${design.elements.join(" + ")}`;
  });

  /* ---------------- the panel ---------------- */
  await step("Share > Download > PDF Print offers bleed, crop marks, registration marks, CMYK and the print resolution", async () => {
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await dl.waitFor({ timeout: 5000 });
    await wait(300);
    await page.getByLabel("File type").click();
    await page
      .getByRole("option", { name: /^PDF Print/ })
      .first()
      .click();
    await wait(300);
    const bleed = dl.getByRole("radiogroup", { name: "Bleed" });
    // WebKit's innerText ends each choice with a line break (the label is a flex item, and WebKit does not drop the trailing
    // break that a block-level box adds, as Chrome does): trimmed, or "None\n|3 mm\n|..." fails and the message, cut at the
    // first line break, reads only "None". The four radios are there in WebKit as in Chrome.
    const choices = (await bleed.getByRole("radio").allInnerTexts()).map((t) => t.trim());
    if (choices.join("|") !== "None|3 mm|0.125 in|Custom") throw new Error("bleed choices: " + JSON.stringify(choices));
    // chosen by keyboard: from None, one step to the right is 3 mm
    await bleed.getByRole("radio", { name: "None" }).click();
    await page.keyboard.press("ArrowRight");
    if ((await bleed.getByRole("radio", { name: "3 mm" }).getAttribute("aria-checked")) !== "true") throw new Error("3 mm is not chosen");
    if ((await dl.getByRole("radiogroup", { name: "Print resolution" }).getByRole("radio", { name: "300 dpi" }).getAttribute("aria-checked")) !== "true")
      throw new Error("300 dpi is not the default");
    for (const name of ["Crop marks", "Registration marks", "CMYK colours"]) {
      const sw = dl.getByRole("switch", { name });
      if (!(await sw.isChecked())) await sw.click();
      if (!(await sw.isChecked())) throw new Error(name + " did not switch on");
    }
    const text = await dl.innerText();
    if (!/not an ICC colour-managed one/.test(text)) throw new Error("the panel does not say the conversion is not colour-managed");
    await dl.getByText("Registration marks").scrollIntoViewIfNeeded();
    await shot("panel");
    return "3 mm, 300 dpi, crop and registration marks, CMYK";
  });

  await step("the print PDF downloads", async () => {
    const t0 = Date.now();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 240000 }), dl.getByRole("button", { name: "Download", exact: true }).click()]);
    const target = OUT + download.suggestedFilename();
    await download.saveAs(target);
    file = target;
    pdf = fs.readFileSync(target);
    if (!/\.pdf$/.test(target)) throw new Error("file " + target);
    return `${path.basename(target)}, ${Math.round(pdf.length / 1024)} KB in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  });

  /* ---------------- the file ---------------- */
  let objects = null;
  let pageDict = "";
  let content = "";
  let image = null;
  await step("the file is sound and has one page with TrimBox, BleedBox and a MediaBox that holds the marks", async () => {
    if (!pdf) throw new Error("no file");
    if (pdf.subarray(0, 8).toString("latin1") !== "%PDF-1.4") throw new Error("not a PDF");
    objects = readObjects(pdf);
    const pages = [...objects.values()].filter((o) => /\/Type \/Page\b/.test(o.dict) && !/\/Type \/Pages/.test(o.dict));
    if (pages.length !== 1) throw new Error(pages.length + " pages");
    pageDict = pages[0].dict;
    content = objects.get(Number(pageDict.match(/\/Contents (\d+) 0 R/)[1])).stream.toString("latin1");
    image = objects.get(Number(pageDict.match(/\/Im0 (\d+) 0 R/)[1]));
    const w = design.width * 0.75;
    const h = design.height * 0.75;
    const bleed = 3 * MM_TO_PT;
    const room = bleed + ROOM_PT;
    const trim = box(pageDict, "TrimBox");
    const bleedBox = box(pageDict, "BleedBox");
    const media = box(pageDict, "MediaBox");
    if (!sameBox(trim, [room, room, room + w, room + h])) throw new Error("TrimBox " + fmt(trim || []));
    if (!sameBox(bleedBox, [room - bleed, room - bleed, room + w + bleed, room + h + bleed])) throw new Error("BleedBox " + fmt(bleedBox || []));
    if (!sameBox(media, [0, 0, w + room * 2, h + room * 2])) throw new Error("MediaBox " + fmt(media || []));
    return `TrimBox ${fmt(trim)}, BleedBox ${fmt(bleedBox)}, MediaBox ${fmt(media)}`;
  });

  await step("the page picture is a deflated 8-bit DeviceCMYK image at 300 dpi that covers the BleedBox", async () => {
    if (!image) throw new Error("no image");
    const d = image.dict;
    for (const want of ["/Subtype /Image", "/ColorSpace /DeviceCMYK", "/BitsPerComponent 8", "/Filter /FlateDecode", "/Predictor 15 /Colors 4"])
      if (!d.includes(want)) throw new Error("the image has no " + want + ": " + d.slice(0, 200));
    if (d.includes("/DCTDecode")) throw new Error("the image is a JPEG");
    const width = Number(d.match(/\/Width (\d+)/)[1]);
    const height = Number(d.match(/\/Height (\d+)/)[1]);
    const bleedPx = 3 * (96 / 25.4) * 2;
    const want = [Math.round((design.width + bleedPx) * (300 / 96)), Math.round((design.height + bleedPx) * (300 / 96))];
    if (width !== want[0] || height !== want[1]) throw new Error(`${width} x ${height} px, not ${want.join(" x ")}`);
    const bleedBox = box(pageDict, "BleedBox");
    const placed = content.match(/^q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im0 Do Q/);
    if (!placed || !sameBox(placed.slice(1, 5).map(Number), [bleedBox[2] - bleedBox[0], bleedBox[3] - bleedBox[1], bleedBox[0], bleedBox[1]]))
      throw new Error("the picture is placed at " + (placed ? placed[0] : content.slice(0, 80)));
    return `${width} x ${height} px, Flate with PNG predictors`;
  });

  await step("the crop marks and registration targets are 0.25 pt lines in registration colour, outside the bleed", async () => {
    if (!pageDict.includes("/Separation /All /DeviceCMYK")) throw new Error("no registration colour");
    const strokes = content.split("\n").filter((l) => l.startsWith("q 0.25 w /CS0 CS 1 SCN ") && l.endsWith(" S Q"));
    if (strokes.length !== 2) throw new Error(strokes.length + " stroked groups");
    const seg = (l) => [...l.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l/g)].map((m) => m.slice(1, 5).map(Number));
    const crop = seg(strokes[0]);
    const targets = seg(strokes[1]);
    const curves = (strokes[1].match(/ c /g) || []).length;
    if (crop.length !== 8) throw new Error(crop.length + " crop marks");
    if (targets.length !== 8 || curves !== 16) throw new Error(`registration: ${targets.length} lines, ${curves} curves`);
    const [bx0, by0, bx1, by1] = box(pageDict, "BleedBox");
    const [tx0, ty0, tx1, ty1] = box(pageDict, "TrimBox");
    const [, , mw, mh] = box(pageDict, "MediaBox");
    for (const [x1, y1, x2, y2] of [...crop, ...targets]) {
      const outside = Math.max(x1, x2) < bx0 || Math.min(x1, x2) > bx1 || Math.max(y1, y2) < by0 || Math.min(y1, y2) > by1;
      if (!outside) throw new Error(`a mark reaches into the bleed: ${x1} ${y1} ${x2} ${y2}`);
      if ([x1, x2].some((v) => v <= 0 || v >= mw) || [y1, y2].some((v) => v <= 0 || v >= mh)) throw new Error("a mark leaves the sheet");
    }
    // every crop mark is in line with an edge of the trim
    for (const [x1, y1, x2, y2] of crop) {
      const horizontal = near(y1, y2);
      const ok = horizontal ? near(y1, ty0) || near(y1, ty1) : near(x1, tx0) || near(x1, tx1);
      if (!ok || !(horizontal || near(x1, x2))) throw new Error(`crop mark ${x1} ${y1} ${x2} ${y2} is not in line with the trim`);
    }
    return "8 crop marks, 4 targets";
  });

  await step("the text is still in the file, invisible over the picture", async () => {
    const bt = content.match(/BT 3 Tr [^\n]*ET/g) || [];
    // "Print me" in WinAnsi hex, possibly split by the spaces between the words
    const hex = bt.join(" ");
    if (!/5072696E74/.test(hex) || !/6D65/.test(hex)) throw new Error("no 'Print me' in the text layer: " + hex.slice(0, 200));
    const fonts = [...objects.values()].filter((o) => o.dict.includes("/ToUnicode"));
    if (!fonts.length) throw new Error("no font with a ToUnicode map: the text could not be copied");
    return bt.length + " line(s) in text rendering mode 3";
  });

  await step("the red background fills the bleed all around, and the blue box continues into it", async () => {
    const d = image.dict;
    const width = Number(d.match(/\/Width (\d+)/)[1]);
    const height = Number(d.match(/\/Height (\d+)/)[1]);
    const pixels = unpredict(zlib.inflateSync(image.stream), width, height);
    const at = (x, y) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
    const scale = width / (design.width + 2 * 3 * (96 / 25.4));
    const bleedPx = Math.floor(3 * (96 / 25.4) * scale); // rows and columns of the picture that are bleed
    // red rgb(225, 29, 72) is about 0/87/68/12, blue rgb(31, 79, 216) about 86/63/0/15
    const isRed = ([c, m, y]) => c < 15 && m > 190 && y > 140;
    const isBlue = ([c, m, y]) => c > 190 && m > 120 && y < 15;
    const bad = [];
    // every pixel of the bleed band, all the way round, is ink: never the white of the paper
    let checked = 0;
    for (let x = 0; x < width; x += 7)
      for (const y of [0, 1, bleedPx - 2, height - 1, height - bleedPx + 1]) {
        checked++;
        if (!isRed(at(x, y)) && !isBlue(at(x, y))) bad.push(`(${x}, ${y}) ${at(x, y)}`);
      }
    for (let y = 0; y < height; y += 7)
      for (const x of [0, 1, bleedPx - 2, width - 1, width - bleedPx + 1]) {
        checked++;
        if (!isRed(at(x, y)) && !isBlue(at(x, y))) bad.push(`(${x}, ${y}) ${at(x, y)}`);
      }
    if (bad.length) throw new Error(`${bad.length} of ${checked} bleed pixels are neither red nor blue: ${bad.slice(0, 3).join(" ")}`);
    // the corners are background
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ])
      if (!isRed(at(x, y))) throw new Error(`corner (${x}, ${y}) is ${at(x, y)}`);
    // the box hangs over the left edge: at its middle (y = 550 px of the design) the left bleed is blue
    const boxY = Math.round((550 + 3 * (96 / 25.4)) * scale);
    if (!isBlue(at(1, boxY)) || !isBlue(at(bleedPx - 2, boxY))) throw new Error(`the left bleed beside the box is ${at(1, boxY)}`);
    // and above the box, the same column is red again
    const aboveY = Math.round((300 + 3 * (96 / 25.4)) * scale);
    if (!isRed(at(1, aboveY))) throw new Error(`the left bleed above the box is ${at(1, aboveY)}`);
    return `${checked} bleed pixels inked, corners ${at(0, 0).join("/")}, box in the bleed ${at(1, boxY).join("/")}`;
  });

  /* ---------------- Chrome's PDF viewer ---------------- */
  await step("Chrome's PDF viewer draws the file", async () => {
    const viewer = await ctx.newPage();
    try {
      let loaded = true;
      await viewer.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 20000 }).catch(() => {
        loaded = false;
      });
      if (!loaded) return "SKIP this browser downloads the PDF instead of showing it (headless has no PDF viewer)";
      await viewer.waitForTimeout(3000);
      const isViewer = await viewer.evaluate(() => !!document.querySelector("embed[type='application/pdf'], embed[type='application/x-google-chrome-pdf']"));
      const png = await viewer.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-viewer.png" });
      const counts = await page.evaluate(async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        let blue = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 130) red++;
          if (d[i] < 100 && d[i + 1] < 130 && d[i + 2] > 160) blue++;
        }
        return { red, blue, all: d.length / 4 };
      }, Array.from(png));
      if (counts.red < counts.all * 0.05)
        return isViewer
          ? `SKIP the viewer showed no page (${counts.red} red pixels): it may not draw PDFs here`
          : "SKIP the PDF viewer is not available in this browser (headless)";
      if (counts.blue < 50) throw new Error("the viewer drew the page without the blue box");
      return `${Math.round((counts.red / counts.all) * 100)} % of the window is the red page, the box is there`;
    } finally {
      await viewer.close();
    }
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
