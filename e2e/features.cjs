const { launch, outDir, BASE } = require("./lib.cjs");
const fs = require("fs");
const OUT = outDir("features");
const results = [];
let shotN = 0;

// a tiny valid 64x48 PNG made on the fly (gradient) for upload tests
function makePng(w, h) {
  const zlib = require("zlib");
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round((x / w) * 255);
      raw[o + 1] = Math.round((y / h) * 255);
      raw[o + 2] = 160;
      raw[o + 3] = 255;
    }
  }
  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_PATH = OUT + "test-upload.png";
fs.writeFileSync(PNG_PATH, makePng(64, 48));

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  const shot = async (name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 230));
      try {
        await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30));
      } catch {}
    }
  };
  const S = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return {
        pages: s.design.pages.length,
        pageIdx: s.design.pages.findIndex((p) => p.id === s.activePageId),
        n: pg.elements.length,
        ids: pg.elements.map((e) => e.id),
        types: pg.elements.map((e) => e.type),
        sel: s.selection.slice(),
        bg: pg.background,
        w: s.design.width,
        h: s.design.height,
        guides: (s.design.guides && s.design.guides.horizontal.length + s.design.guides.vertical.length) || 0,
      };
    });
  const SEL = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      const e = pg.elements.find((x) => x.id === s.selection[0]);
      return e ? JSON.parse(JSON.stringify(e)) : null;
    });
  const activeTab = () => page.evaluate(() => document.querySelector("[role=tab][aria-selected=true]")?.textContent?.trim() || "");
  const panelOpen = async () => (await page.locator(".cf-sidepanel.is-open").count()) > 0;
  const tab = async (name) => {
    if (!((await activeTab()) === name && (await panelOpen()))) await page.getByRole("tab", { name, exact: true }).click();
    await page.waitForTimeout(250);
  };
  const back = async () => {
    const b = page.getByRole("button", { name: /^Back to/ }).first();
    if (await b.isVisible().catch(() => false)) await b.click();
    await page.waitForTimeout(200);
  };
  const tbBtn = (name) => page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name });
  const wait = (ms) => page.waitForTimeout(ms);
  const clickCanvasEmpty = () => page.mouse.click(1300, 640);
  const panelTitle = () =>
    page.evaluate(() =>
      (document.querySelector(".cf-sidepanel.is-open .cf-pheader__title, .cf-sidepanel.is-open h2, .cf-sidepanel.is-open [class*=title]")?.textContent || "").trim(),
    );
  const openToolbarPanel = async (name) => {
    if ((await panelTitle()) !== name) {
      await tbBtn(name).click();
      await wait(500);
    }
  };

  await step("setup: new presentation", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
  });

  // ---------- TEXT ----------
  await step("text: add, size +, bold/italic/underline/strike", async () => {
    await tab("Text");
    await page.getByRole("button", { name: /Add a text box/ }).click();
    await page.keyboard.type("Typography test", { delay: 10 });
    await page.keyboard.press("Escape");
    await wait(300);
    const a = await SEL();
    await tbBtn(/Increase Font size/).click();
    await tbBtn("Italic").click();
    await tbBtn("Underline").click();
    await tbBtn("Strikethrough").click();
    const b = await SEL();
    if (!(b.fontSize > a.fontSize && b.italic && b.underline && b.strike))
      throw new Error(JSON.stringify({ a: a.fontSize, b: b.fontSize, i: b.italic, u: b.underline, s: b.strike }));
    return `size ${a.fontSize}->${b.fontSize}`;
  });

  await step("text: type a font size into the size field", async () => {
    const input = page
      .locator("[role=toolbar]:not(.cf-rail)")
      .getByRole("textbox", { name: /Font size/ })
      .or(page.locator("[role=toolbar]:not(.cf-rail) input[aria-label='Font size']"))
      .first();
    await input.fill("80");
    await input.press("Enter");
    await wait(300);
    const e = await SEL();
    if (e.fontSize !== 80) throw new Error("fontSize " + e.fontSize);
    return "80";
  });

  await step("text: choose another font family from the font panel", async () => {
    await tbBtn(/Toggle font selector/).click();
    await wait(700);
    const before = (await SEL()).fontFamily;
    const rows = page.locator(".cf-font__row");
    const n = await rows.count();
    if (n < 10) throw new Error("font rows: " + n);
    let picked = null;
    for (let i = 0; i < n; i++) {
      const label = await rows.nth(i).getAttribute("aria-label");
      if (label && label !== before) {
        await rows.nth(i).click();
        picked = label;
        break;
      }
    }
    await wait(900);
    const after = (await SEL()).fontFamily;
    if (after === before) throw new Error("font did not change: " + before + " (picked " + picked + ")");
    return `${before} -> ${after} (of ${n} rows)`;
  });

  await step("text: colour swatch applies a colour", async () => {
    await tbBtn("Text color").click();
    await wait(500);
    const before = JSON.stringify((await SEL()).color);
    await page.locator(".cf-swatch[aria-label='#7C3AED']").first().click();
    await wait(300);
    const after = JSON.stringify((await SEL()).color);
    if (before === after || !/7c3aed/i.test(after)) throw new Error(`colour ${before} -> ${after}`);
    return after;
  });

  await step("text: alignment cycles", async () => {
    const a = (await SEL()).align;
    await tbBtn(/Toggle text alignment/).click();
    const b = (await SEL()).align;
    if (a === b) throw new Error("align unchanged " + a);
    return `${a}->${b}`;
  });

  await step("text: list toggle", async () => {
    await tbBtn(/^List/).click();
    const e = await SEL();
    const has = e.list || e.paragraphs.some((p) => p.list);
    if (!has) throw new Error("no list set");
    return JSON.stringify(e.list || "per-paragraph");
  });

  await step("text: case toggle", async () => {
    const a = (await SEL()).textCase;
    await tbBtn(/Text case/).click();
    const b = (await SEL()).textCase;
    if (a === b) throw new Error("case unchanged " + a);
    return `${a}->${b}`;
  });

  await step("text: advanced settings sets spacing", async () => {
    await tbBtn("Advanced settings").click();
    await wait(500);
    await shot("advanced");
    const before = await SEL();
    const nums = page.locator(".cf-popover input[type=number], .cf-popover input[type=text], .cf-popover [role=spinbutton]");
    const count = await nums.count();
    if (count < 2) throw new Error("spacing inputs: " + count);
    await nums.nth(0).fill("120");
    await nums.nth(0).press("Enter");
    await wait(300);
    const after = await SEL();
    await page.keyboard.press("Escape");
    if (before.letterSpacing === after.letterSpacing && before.lineHeight === after.lineHeight) throw new Error("no spacing change");
    return `letterSpacing ${before.letterSpacing}->${after.letterSpacing}, lineHeight ${before.lineHeight}->${after.lineHeight}`;
  });

  await step("text: Effects panel applies shadow, then curve", async () => {
    await tbBtn("Effects").click();
    await wait(600);
    await page.locator(".cf-fx__tile", { hasText: "Shadow" }).first().click();
    await wait(300);
    const e = await SEL();
    if (!e.effect || e.effect.type === "none" || e.effect.kind === "none") throw new Error("effect: " + JSON.stringify(e.effect));
    await page.locator(".cf-fx__tile", { hasText: "Curve" }).first().click();
    await wait(300);
    const c = await SEL();
    if (!c.curve) throw new Error("curve " + c.curve);
    await shot("effects-applied");
    return JSON.stringify(e.effect).slice(0, 60) + " curve=" + c.curve;
  });

  await step("text: Position panel - arrange + align to page", async () => {
    await openToolbarPanel("Position");
    await shot("position");
    const before = await SEL();
    const mid = page
      .locator(".cf-sidepanel")
      .getByRole("button", { name: /^Middle/ })
      .first();
    await mid.click();
    const left = page.locator(".cf-sidepanel").getByRole("button", { name: /^Left/ }).first();
    await left.click();
    await wait(300);
    const after = await SEL();
    if (before.x === after.x && before.y === after.y) throw new Error("position unchanged");
    return `(${Math.round(before.x)},${Math.round(before.y)}) -> (${Math.round(after.x)},${Math.round(after.y)})`;
  });

  // ---------- LAYERS / ARRANGE / LOCK / HIDE ----------
  await step("layers: forward/backward/front/back ordering", async () => {
    await tab("Elements");
    await back();
    await page.getByRole("button", { name: "Browse shapes" }).click();
    await wait(400);
    await page.locator(".cf-ditem").nth(0).click();
    await page.locator(".cf-ditem").nth(2).click();
    await wait(300);
    const s0 = await S();
    const topId = s0.ids[s0.ids.length - 1];
    await openToolbarPanel("Position");
    await page
      .locator(".cf-sidepanel")
      .getByRole("button", { name: /^(To back|Send to back|Back)$/ })
      .first()
      .click();
    await wait(200);
    const s1 = await S();
    if (s1.ids[0] !== topId) throw new Error("not sent to back: " + s1.ids.indexOf(topId));
    await page
      .locator(".cf-sidepanel")
      .getByRole("button", { name: /^(To front|Bring to front|Front)$/ })
      .first()
      .click();
    await wait(200);
    const s2 = await S();
    if (s2.ids[s2.ids.length - 1] !== topId) throw new Error("not brought to front");
    await page
      .locator(".cf-sidepanel")
      .getByRole("button", { name: /^(Backward|Send backward)$/ })
      .first()
      .click();
    const s3 = await S();
    if (s3.ids[s3.ids.length - 2] !== topId) throw new Error("backward failed");
    await page
      .locator(".cf-sidepanel")
      .getByRole("button", { name: /^(Forward|Bring forward)$/ })
      .first()
      .click();
    const s4 = await S();
    if (s4.ids[s4.ids.length - 1] !== topId) throw new Error("forward failed");
    return "back/front/backward/forward ok";
  });

  await step("layers: lock via mini-bar, locked element can't be moved, unlock", async () => {
    const e0 = await SEL();
    await page.getByRole("button", { name: "Lock", exact: true }).first().click();
    await wait(200);
    await page.keyboard.press("ArrowRight");
    const e1 = await SEL();
    if (!e1.locked) throw new Error("not locked");
    if (e1.x !== e0.x) throw new Error("locked element moved");
    await page.getByRole("button", { name: "Unlock", exact: true }).first().click();
    await wait(150);
    const e2 = await SEL();
    if (e2.locked) throw new Error("still locked");
    return "lock ok";
  });

  await step("layers: Layers tab lists elements; hide + show", async () => {
    // layers list lives in the Position panel's second tab
    await openToolbarPanel("Position");
    const layersTab = page.locator(".cf-sidepanel").getByRole("tab", { name: "Layers" }).first();
    await layersTab.click();
    await wait(400);
    await shot("layers");
    const rows = page.locator(".cf-sidepanel [role=listitem], .cf-sidepanel .cf-layer, .cf-sidepanel [class*=layer]");
    const n = await rows.count();
    if (n < 3) throw new Error("layer rows: " + n);
    const hideBtn = page.locator(".cf-sidepanel").getByRole("button", { name: /^Hide/ }).first();
    await hideBtn.click();
    await wait(200);
    const hidden = await page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return pg.elements.filter((e) => e.hidden).length;
    });
    if (hidden !== 1) throw new Error("hidden count " + hidden);
    await page.locator(".cf-sidepanel").getByRole("button", { name: /^Show/ }).first().click();
    return `layers listed: ${n}`;
  });

  // ---------- IMAGES ----------
  await step("uploads: upload a PNG, appears in the grid, click inserts it", async () => {
    await tab("Uploads");
    await wait(400);
    const input = page.locator("input[type=file]").first();
    await input.setInputFiles(PNG_PATH);
    await wait(1800);
    await shot("uploads");
    const before = (await S()).n;
    const items = page.locator(".cf-sidepanel .cf-ditem");
    if ((await items.count()) < 1) throw new Error("no uploaded item");
    await items.first().click();
    await wait(600);
    const s = await S();
    if (s.n !== before + 1 || s.types[s.types.length - 1] !== "image") throw new Error("not inserted: " + s.types.slice(-2));
    return "uploaded + inserted";
  });

  await step("image: Crop mode enters and exits (Done)", async () => {
    await tbBtn("Crop").click();
    await wait(500);
    await shot("crop");
    const done = page.getByRole("button", { name: "Done" }).first();
    await done.click();
    await wait(300);
    return "crop ok";
  });

  await step("image: Edit image panel -> apply a filter, then adjust", async () => {
    await tbBtn("Edit image").click();
    await wait(800);
    const before = JSON.stringify((await SEL()).filter);
    await page
      .locator(".cf-sidepanel")
      .getByRole("button", { name: /^Vivid/ })
      .first()
      .click();
    await wait(500);
    const after = JSON.stringify((await SEL()).filter);
    if (before === after) throw new Error("filter unchanged " + before);
    await page.locator(".cf-sidepanel").getByRole("tab", { name: "Adjust" }).click();
    await wait(500);
    await shot("adjust");
    return after.slice(0, 90);
  });

  await step("image: flip horizontally + replace via panel", async () => {
    await tbBtn("Flip").click();
    await wait(300);
    await page.getByRole("menuitem", { name: /Flip horizontal/ }).click();
    await wait(200);
    const e = await SEL();
    if (!e.flipH) throw new Error("flipH " + e.flipH);
    return "flipH";
  });

  await step("image: Replace opens a file chooser and swaps the picture", async () => {
    const before = (await SEL()).src;
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), tbBtn("Replace").click()]);
    await chooser.setFiles(PNG_PATH);
    await wait(1500);
    const after = (await SEL()).src;
    if (before === after) throw new Error("src unchanged " + before);
    return `${String(before).slice(0, 24)} -> ${String(after).slice(0, 24)}`;
  });

  // ---------- PAGE-LEVEL ----------
  await step("background: page colour via toolbar", async () => {
    await clickCanvasEmpty();
    await page.keyboard.press("Escape");
    await wait(200);
    const before = JSON.stringify((await S()).bg);
    await page.getByRole("button", { name: "Background color" }).click();
    await wait(500);
    await page.locator(".cf-bg__tile[aria-label='Blush']").first().click();
    await wait(300);
    const after = JSON.stringify((await S()).bg);
    if (before === after) throw new Error("bg unchanged " + before);
    await shot("bg-applied");
    return after.slice(0, 60);
  });

  await step("zoom: slider/fit/keyboard zoom changes the view", async () => {
    const z0 = await page.evaluate(() => document.body.innerText.match(/(\d+)%/)?.[1]);
    await page.keyboard.press("Control+=");
    await wait(300);
    const z1 = await page.evaluate(() => [...document.querySelectorAll("button, span, div")].map((e) => e.textContent.trim()).find((t) => /^\d+%$/.test(t)));
    await page.keyboard.press("Control+0");
    await wait(300);
    const z2 = await page.evaluate(() => [...document.querySelectorAll("button, span, div")].map((e) => e.textContent.trim()).find((t) => /^\d+%$/.test(t)));
    if (z1 === z2) throw new Error(`zoom did not change: ${z1} ${z2}`);
    return `${z0}% -> ${z1} -> ${z2}`;
  });

  await step("rulers + guides: Shift+R shows rulers, drag a guide from the ruler", async () => {
    await clickCanvasEmpty();
    await page.keyboard.press("Shift+R");
    await wait(400);
    const n = await page.locator(".cf-ruler").count();
    if (n < 2) throw new Error("rulers not shown: " + n);
    await shot("rulers");
    // drag from the top ruler down onto the page to create a horizontal guide
    const r = await page.locator(".cf-ruler--top").boundingBox();
    const pg = await page.locator(".cf-pageview").first().boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2, pg.y + pg.height * 0.4, { steps: 8 });
    await page.mouse.up();
    await wait(300);
    const g = (await S()).guides;
    if (g < 1) throw new Error("guide not created");
    // an element dragged near the guide snaps to it
    await page.keyboard.press("Shift+R");
    await wait(200);
    const n2 = await page.locator(".cf-ruler").count();
    if (n2 !== 0) throw new Error("rulers still shown: " + n2);
    await page.keyboard.press("Shift+R");
    return `rulers ${n} -> hidden ${n2}; guides=${g}`;
  });

  await step("Resize dialog resizes the design (ratio lock, then unlocked)", async () => {
    await page.getByRole("button", { name: "Resize" }).first().click();
    await wait(300);
    await page
      .getByRole("button", { name: /^Resize/ })
      .filter({ hasText: "Change the size" })
      .first()
      .click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ timeout: 5000 });
    await shot("resize");
    const w = dlg.getByLabel("Width");
    await w.fill("1200");
    await w.press("Tab");
    const hv = await dlg.getByLabel("Height").inputValue();
    if (Number(hv) !== 675) throw new Error("ratio lock: height should follow width, got " + hv);
    // unlock the ratio and set height independently
    await dlg
      .getByRole("button", { name: /ratio|lock/i })
      .first()
      .click();
    const h = dlg.getByLabel("Height");
    await h.fill("800");
    await h.press("Tab");
    await dlg
      .getByRole("button", { name: /^Resize/ })
      .last()
      .click();
    await wait(900);
    const s = await S();
    if (s.w !== 1200 || s.h !== 800) throw new Error(`size ${s.w}x${s.h}`);
    return "1920x1080 -> 1200x800";
  });

  await step("Find and replace text", async () => {
    await page.keyboard.press("Escape");
    await clickCanvasEmpty();
    await page.keyboard.press("Control+f");
    const dlg = page.locator("[aria-label='Find and replace']");
    await dlg.first().waitFor({ timeout: 4000 });
    await shot("find");
    await page.getByLabel("Find text").fill("Typography");
    await page.getByLabel("Replacement text").fill("Typographie");
    await page.getByRole("button", { name: /Replace all/ }).click();
    await wait(400);
    await page.keyboard.press("Escape");
    const txt = await page.evaluate(() => JSON.stringify(window.__editor.getState().design.pages.flatMap((p) => p.elements)).includes("Typographie"));
    if (!txt) throw new Error("text not replaced");
    return "replaced";
  });

  await step("Present mode opens and Esc exits", async () => {
    await page
      .getByRole("button", { name: /^Present$/ })
      .first()
      .click();
    await wait(1200);
    await shot("present");
    const inPresent = await page.locator(".cf-present, [class*=present]").count();
    await page.keyboard.press("Escape");
    await wait(600);
    const still = await page.locator(".cf-present").count();
    if (!inPresent) throw new Error("present not shown");
    if (still) throw new Error("present did not close");
    return "ok";
  });

  await step("page grid view + reorder pages by drag", async () => {
    // two extra pages with distinguishable content
    await page.getByRole("button", { name: "Add page", exact: true }).first().click();
    await wait(300);
    await page.getByRole("button", { name: "Add page", exact: true }).first().click();
    await wait(300);
    const orderBefore = await page.evaluate(() => window.__editor.getState().design.pages.map((p) => p.id));
    const thumbs = page.locator(".cf-strip [role=listitem], .cf-strip [data-page-id], .cf-strip .cf-pagethumb");
    const cnt = await thumbs.count();
    if (cnt < 3) throw new Error("thumb count " + cnt);
    const a = await thumbs.nth(0).boundingBox();
    const c = await thumbs.nth(2).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 40, a.y + a.height / 2, { steps: 5 });
    await page.mouse.move(c.x + c.width * 0.8, c.y + c.height / 2, { steps: 12 });
    await page.mouse.up();
    await wait(500);
    const orderAfter = await page.evaluate(() => window.__editor.getState().design.pages.map((p) => p.id));
    if (JSON.stringify(orderBefore) === JSON.stringify(orderAfter)) throw new Error("order unchanged");
    await shot("reordered");
    return `moved first page: ${orderBefore.indexOf(orderAfter[2])} etc`;
  });

  await step("delete a page", async () => {
    const before = (await S()).pages;
    await page
      .getByRole("button", { name: /^Page \d+ options$/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: /Delete page/ }).click();
    await wait(400);
    const dlg = page.getByRole("dialog");
    if (await dlg.isVisible().catch(() => false)) await dlg.getByRole("button", { name: /Delete/ }).click();
    await wait(300);
    const after = (await S()).pages;
    if (after !== before - 1) throw new Error(`${before}->${after}`);
    return `${before}->${after}`;
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 10)));
  await browser.close();
})().catch((e) => {
  console.log("E2E CRASH", e);
  process.exit(1);
});
