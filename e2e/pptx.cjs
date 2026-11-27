/*
 * The PowerPoint download, as a person makes it in a real browser: a presentation of two pages (a heading on a red page with
 * presenter notes, a second page in blue), then Share > Download > PowerPoint (PPTX), once without the notes and once with them.
 * The downloaded file is read back as the ZIP it is: the list of content types comes first, every text part is XML that the
 * browser's own parser takes, every relationship leads to a part that is there, the slides are as large as the pages, and each
 * picture is a JPEG that the browser decodes, of the size it was painted at and in the colour of its page. The notes are in the
 * file only when they were asked for.
 *
 * What this cannot do is open the file in PowerPoint, Keynote or Google Slides: that takes a person.
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("pptx");
const results = [];
const logs = [];
let shotN = 0;

const RED = "#e11d48"; // rgb(225, 29, 72)
const BLUE = "#1f4fd8"; // rgb(31, 79, 216)
const EMU_PER_PX = 9525;

/* ---------------- reading the ZIP ---------------- */

/** The files of an archive by name, through its central directory, each checked against its CRC-32. */
function readZip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no end record: not a ZIP");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map();
  const order = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("the central directory is damaged at entry " + i);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(name + ": no local header where the directory says");
    const from = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(from, from + packed);
    const data = method === 0 ? raw : zlib.inflateRawSync(raw);
    if (zlib.crc32(data) !== crc) throw new Error(name + ": the checksum is wrong");
    files.set(name, data);
    order.push(name);
    at += 46 + nameLength + extra + comment;
  }
  return { files, order };
}

/** Width and height of a JPEG, from its frame header. */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let at = 2;
  while (at < buf.length) {
    if (buf[at] !== 0xff) throw new Error("a marker is missing in the JPEG");
    const marker = buf[at + 1];
    const length = buf.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  throw new Error("no frame header in the JPEG");
}

const folder = (name) => name.slice(0, name.lastIndexOf("/") + 1);
function resolve(from, target) {
  const out = from.split("/").filter(Boolean);
  for (const step of target.split("/")) {
    if (step === "..") out.pop();
    else out.push(step);
  }
  return out.join("/");
}

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
  const dl = page.locator(".cf-dl");

  let design = null;

  /** Chooses PowerPoint in the open panel, sets the notes switch, downloads, and reads the file back. */
  const download = async (withNotes, as) => {
    const sw = dl.getByRole("switch", { name: "Include speaker notes" });
    if ((await sw.isChecked()) !== withNotes) await sw.click();
    const [got] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), dl.getByRole("button", { name: "Download", exact: true }).click()]);
    const suggested = got.suggestedFilename();
    if (!/\.pptx$/.test(suggested)) throw new Error("the file is called " + suggested);
    const target = OUT + as;
    await got.saveAs(target);
    const bytes = fs.readFileSync(target);
    return { name: suggested, bytes, ...readZip(bytes) };
  };

  const openPanel = async () => {
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await dl.waitFor({ timeout: 5000 });
    await wait(300);
    await page.getByLabel("File type").click();
    await page
      .getByRole("option", { name: /^PowerPoint/ })
      .first()
      .click();
    await wait(300);
  };

  /* ---------------- the design ---------------- */
  await step("setup: a presentation of a red page with a heading and notes, and a blue page", async () => {
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
    await page.keyboard.type("Slide one", { delay: 10 });
    await page.keyboard.press("Escape");
    await wait(300);
    design = await page.evaluate(
      ({ RED, BLUE }) => {
        const { actions } = window.__editor.getState();
        const first = window.__editor.getState().activePageId;
        actions.setTitle("Quarterly <review> & plans");
        actions.setPageBackground({ type: "solid", color: RED }, first);
        actions.setPageName(first, "Opening");
        actions.setPageNotes(first, "Welcome everybody.\nMention the <new> team & the plan.");
        const second = actions.addPage();
        actions.setPageBackground({ type: "solid", color: BLUE }, second);
        actions.setActivePage(first);
        actions.clearSelection();
        const d = window.__editor.getState().design;
        return { width: d.width, height: d.height, pages: d.pages.length };
      },
      { RED, BLUE },
    );
    if (design.pages !== 2) throw new Error("pages: " + design.pages);
    await wait(400);
    await shot("design");
    return `${design.width} x ${design.height} px, ${design.pages} pages`;
  });

  /* ---------------- the panel ---------------- */
  await step("Share > Download offers PowerPoint, says what stays a picture and what can be edited, and keeps the notes out to begin with", async () => {
    await openPanel();
    const text = await dl.innerText();
    if (!/One \.pptx file with a slide for every page/.test(text)) throw new Error("the panel does not say what the file is");
    if (!/Complex content stays in a background picture/.test(text)) throw new Error("the panel does not say what stays a picture");
    if (!/Plain text and common solid-colour shapes become editable PowerPoint objects/.test(text)) throw new Error("the panel does not say what can be edited");
    if (await dl.getByRole("switch", { name: "Include speaker notes" }).isChecked()) throw new Error("the notes are switched on to begin with");
    if (!/Notes are private and stay out of the file/.test(text)) throw new Error("the panel does not say the notes stay out");
    await shot("panel");
    return "PowerPoint (PPTX), notes off";
  });

  /* ---------------- without notes ---------------- */
  let plain = null;
  await step("the presentation downloads, named after the design", async () => {
    const t0 = Date.now();
    plain = await download(false, "plain.pptx");
    if (plain.name !== "Quarterly review & plans.pptx" && !/^Quarterly.*\.pptx$/.test(plain.name)) throw new Error("name: " + plain.name);
    return `${plain.name}, ${Math.round(plain.bytes.length / 1024)} KB, ${plain.order.length} parts in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  });

  await step("the package begins with its content types and holds a slide and a picture for each page", async () => {
    if (plain.order[0] !== "[Content_Types].xml") throw new Error("first part: " + plain.order[0]);
    const slides = plain.order.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const media = plain.order.filter((n) => n.startsWith("ppt/media/"));
    if (slides.join() !== "ppt/slides/slide1.xml,ppt/slides/slide2.xml") throw new Error("slides: " + slides);
    if (media.join() !== "ppt/media/image1.jpeg,ppt/media/image2.jpeg") throw new Error("pictures: " + media);
    for (const need of [
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/theme/theme1.xml",
    ])
      if (!plain.files.has(need)) throw new Error(need + " is missing");
    return `${slides.length} slides, ${media.length} pictures`;
  });

  const checkXml = async (pack) => {
    const texts = [...pack.files].filter(([name]) => /\.(xml|rels)$/.test(name)).map(([name, data]) => [name, data.toString("utf8")]);
    const bad = await page.evaluate(
      (list) => list.filter(([, xml]) => new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror")).map(([name]) => name),
      texts,
    );
    if (bad.length) throw new Error("not XML: " + bad.join(", "));
    return texts;
  };

  const checkRelationships = (pack, texts) => {
    let n = 0;
    for (const [name, xml] of texts) {
      if (name.endsWith(".rels")) {
        const from = name.replace(/_rels\/[^/]+$/, "");
        for (const [, target] of xml.matchAll(/Target="([^"]+)"/g)) {
          n++;
          if (!pack.files.has(resolve(from, target))) throw new Error(`${name} points at ${target}, which is not in the file`);
        }
      } else if (name !== "[Content_Types].xml") {
        const rels = pack.files.get(`${folder(name)}_rels/${name.slice(folder(name).length)}.rels`);
        const known = new Set([...(rels ? rels.toString("utf8") : "").matchAll(/Id="([^"]+)"/g)].map((hit) => hit[1]));
        for (const [, id] of xml.matchAll(/r:(?:id|embed)="([^"]+)"/g)) if (!known.has(id)) throw new Error(`${name} uses ${id}, which its relationships do not have`);
      }
    }
    const types = pack.files.get("[Content_Types].xml").toString("utf8");
    for (const [, part] of types.matchAll(/PartName="\/([^"]+)"/g)) if (!pack.files.has(part)) throw new Error(`a content type names ${part}, which is not in the file`);
    for (const name of pack.order)
      if (name.endsWith(".xml") && name !== "[Content_Types].xml" && !types.includes(`PartName="/${name}"`)) throw new Error(name + " has no content type");
    return n;
  };

  await step("every text part is XML to the browser's parser, and every relationship and content type leads to a part", async () => {
    const texts = await checkXml(plain);
    return `${texts.length} parts of XML, ${checkRelationships(plain, texts)} relationships`;
  });

  await step("the slides are as large as the pages, the title is the design's, and the page's name is on its slide", async () => {
    const presentation = plain.files.get("ppt/presentation.xml").toString("utf8");
    const want = `<p:sldSz cx="${design.width * EMU_PER_PX}" cy="${design.height * EMU_PER_PX}"/>`;
    if (!presentation.includes(want)) throw new Error("no " + want);
    const core = plain.files.get("docProps/core.xml").toString("utf8");
    if (!core.includes("<dc:title>Quarterly &lt;review&gt; &amp; plans</dc:title>"))
      throw new Error("title: " + core.slice(core.indexOf("<dc:title>"), core.indexOf("</dc:title>") + 11));
    const slide = plain.files.get("ppt/slides/slide1.xml").toString("utf8");
    if (!slide.includes('<p:cSld name="Opening">')) throw new Error("the slide does not carry the name of its page");
    if (!slide.includes(`<a:ext cx="${design.width * EMU_PER_PX}" cy="${design.height * EMU_PER_PX}"/>`)) throw new Error("the picture does not fill the slide");
    return `${design.width * EMU_PER_PX} x ${design.height * EMU_PER_PX} EMU`;
  });

  await step("each picture is a JPEG the browser decodes, painted at 2,560 px, in the colour of its page", async () => {
    const out = [];
    for (const [i, colour] of [RED, BLUE].entries()) {
      const data = plain.files.get(`ppt/media/image${i + 1}.jpeg`);
      const size = jpegSize(data);
      const scale = Math.min(2, 2560 / Math.max(design.width, design.height));
      const want = { width: Math.round(design.width * scale), height: Math.round(design.height * scale) };
      if (size.width !== want.width || size.height !== want.height) throw new Error(`picture ${i + 1} is ${size.width} x ${size.height}, not ${want.width} x ${want.height}`);
      const corner = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const c2d = canvas.getContext("2d");
        c2d.drawImage(bitmap, 0, 0);
        return [...c2d.getImageData(bitmap.width - 20, bitmap.height - 20, 1, 1).data.slice(0, 3)];
      }, data.toString("base64"));
      const rgb = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
      if (corner.some((v, k) => Math.abs(v - rgb[k]) > 6)) throw new Error(`picture ${i + 1} is rgb(${corner}) near its corner, not rgb(${rgb})`);
      out.push(`${size.width} x ${size.height} rgb(${corner})`);
    }
    return out.join(", ");
  });

  await step("without the switch the notes are nowhere in the file", async () => {
    if (plain.order.some((n) => n.includes("notes"))) throw new Error("parts: " + plain.order.filter((n) => n.includes("notes")));
    for (const [name, data] of plain.files) if (/\.(xml|rels)$/.test(name) && data.toString("utf8").includes("Welcome everybody")) throw new Error("the notes are in " + name);
    return "no notes part, no notes text";
  });

  /* ---------------- with notes ---------------- */
  let noted = null;
  await step("with Include speaker notes the page that has notes gets a notes page, and the other none", async () => {
    await openPanel();
    noted = await download(true, "notes.pptx");
    const notes = noted.order.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    if (notes.join() !== "ppt/notesSlides/notesSlide1.xml") throw new Error("notes pages: " + notes);
    if (!noted.files.has("ppt/notesMasters/notesMaster1.xml") || !noted.files.has("ppt/theme/theme2.xml")) throw new Error("no notes master with a theme of its own");
    const xml = noted.files.get("ppt/notesSlides/notesSlide1.xml").toString("utf8");
    if (!xml.includes("<a:t>Welcome everybody.</a:t>")) throw new Error("the first line of the notes is not there");
    if (!xml.includes("<a:t>Mention the &lt;new&gt; team &amp; the plan.</a:t>")) throw new Error("the second line is not there, escaped");
    if (!noted.files.get("ppt/presentation.xml").toString("utf8").includes("<p:notesMasterIdLst>")) throw new Error("the presentation does not name the notes master");
    const texts = await checkXml(noted);
    return `${noted.order.length} parts, ${checkRelationships(noted, texts)} relationships`;
  });

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 4).join(" | "));
    return "clean";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  console.log("FILES:", path.join(OUT, "plain.pptx"), path.join(OUT, "notes.pptx"));
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
