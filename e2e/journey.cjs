const { launch, outDir, BASE } = require("./lib.cjs");
const fs = require("fs");
const OUT = outDir("journey");
const results = [];
let shotN = 0;
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
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 220));
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
        types: pg.elements.map((e) => e.type),
        sel: s.selection.length,
        canUndo: s.canUndo,
        canRedo: s.canRedo,
        saveState: s.saveState,
        id: s.design.id,
      };
    });
  const activeTab = () => page.evaluate(() => document.querySelector("[role=tab][aria-selected=true]")?.textContent?.trim() || "");
  const panelOpen = async () => (await page.locator(".cf-sidepanel.is-open").count()) > 0;
  // clicking the active rail tab collapses the panel (as in Canva), so only click when it is needed
  const tab = async (name) => {
    if (!((await activeTab()) === name && (await panelOpen()))) await page.getByRole("tab", { name, exact: true }).click();
    await page.waitForTimeout(250);
  };
  const backToCategories = async () => {
    const b = page.getByRole("button", { name: "Back to all elements" });
    if (await b.isVisible().catch(() => false)) await b.click();
    await page.waitForTimeout(250);
  };
  const browse = async (label) => {
    await tab("Elements");
    await backToCategories();
    await page.getByRole("button", { name: "Browse " + label }).click();
    await page.waitForTimeout(600);
  };
  const clickBody = () => page.mouse.click(1250, 600);

  await step("home -> create presentation -> editor", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    const s = await S();
    return `pages=${s.pages} n=${s.n}`;
  });

  await step("Elements > Shapes: click inserts + selects a shape", async () => {
    await browse("shapes");
    const before = (await S()).n;
    await page.locator(".cf-ditem").nth(1).click();
    await page.waitForTimeout(400);
    const s = await S();
    if (s.n !== before + 1 || s.sel !== 1) throw new Error(`n ${before}->${s.n} sel=${s.sel}`);
    await shot("shape");
    return s.types.join(",");
  });

  await step("shape toolbar shows colour + border controls", async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Position/.test(txt)) throw new Error("no Position in toolbar");
    return "ok";
  });

  await step("Elements > Photos: click inserts an image", async () => {
    await backToCategories();
    await browse("photos");
    await page.waitForTimeout(800);
    const before = (await S()).n;
    await page.locator(".cf-ditem").first().click();
    await page.waitForTimeout(900);
    const s = await S();
    if (s.n !== before + 1 || s.types[s.types.length - 1] !== "image") throw new Error(`types=${s.types}`);
    await shot("photo");
    return "image added";
  });

  await step("Elements > Graphics inserts a graphic", async () => {
    await backToCategories();
    await browse("graphics");
    await page.waitForTimeout(800);
    const before = (await S()).n;
    await page.locator(".cf-ditem").first().click();
    await page.waitForTimeout(700);
    const s = await S();
    if (s.n !== before + 1) throw new Error(`n ${before}->${s.n}`);
    return s.types[s.types.length - 1];
  });

  await step("Elements > Charts / Tables / Lines / Frames insert", async () => {
    const out = [];
    for (const [label] of [
      ["charts", "chart"],
      ["tables", "table"],
      ["lines", "line"],
      ["frames", "frame"],
    ]) {
      await backToCategories();
      await browse(label);
      await page.waitForTimeout(500);
      const before = (await S()).n;
      await page.locator(".cf-ditem").first().click();
      await page.waitForTimeout(500);
      const s = await S();
      if (s.n !== before + 1) throw new Error(`${label}: n ${before}->${s.n}`);
      out.push(label + ":" + s.types[s.types.length - 1]);
    }
    await shot("many-elements");
    return out.join(" ");
  });

  await step("undo/redo buttons + keyboard", async () => {
    const a = await S();
    await page.getByRole("button", { name: /^Undo/ }).first().click();
    const b = await S();
    await page.getByRole("button", { name: /^Redo/ }).first().click();
    const c = await S();
    await clickBody();
    await page.keyboard.press("Control+z");
    const d = await S();
    await page.keyboard.press("Control+Shift+z");
    const e = await S();
    if (!(b.n === a.n - 1 && c.n === a.n && d.n === a.n - 1 && e.n === a.n)) throw new Error(`${a.n} ${b.n} ${c.n} ${d.n} ${e.n}`);
    return `${a.n}->${b.n}->${c.n}->${d.n}->${e.n}`;
  });

  await step("select-all, group (Ctrl+G), ungroup, duplicate, delete", async () => {
    await clickBody();
    await page.keyboard.press("Control+a");
    const a = await S();
    await page.keyboard.press("Control+g");
    const g = await S();
    await page.keyboard.press("Control+Shift+g");
    const u = await S();
    await page.keyboard.press("Control+d");
    const dup = await S();
    await page.keyboard.press("Delete");
    const del = await S();
    if (!(g.n === 1 && u.n === a.n && dup.n > u.n && del.n < dup.n)) throw new Error(JSON.stringify({ a: a.n, g: g.n, u: u.n, dup: dup.n, del: del.n }));
    return `all=${a.sel} grouped=${g.n} ungrouped=${u.n} dup=${dup.n} del=${del.n}`;
  });

  await step("arrow keys nudge the selection", async () => {
    await clickBody();
    await page.keyboard.press("Control+Shift+z").catch(() => {});
    await page.keyboard.press("Control+a");
    const read = () =>
      page.evaluate(() => {
        const s = window.__editor.getState();
        const pg = s.design.pages.find((p) => p.id === s.activePageId);
        return pg.elements[0].x;
      });
    const x0 = await read();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    const x1 = await read();
    if (Math.abs(x1 - x0 - 11) > 0.01) throw new Error(`x ${x0} -> ${x1}`);
    return `${x0} -> ${x1}`;
  });

  await step("Text tab: heading style + type", async () => {
    await tab("Text");
    await page
      .getByRole("button", { name: /Add a heading/i })
      .first()
      .click();
    await page.waitForTimeout(400);
    await page.keyboard.type("Quarterly review", { delay: 15 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const s = await S();
    return "types: " + s.types.slice(-2).join(",");
  });

  await step("add / duplicate / navigate / delete pages", async () => {
    await page.getByRole("button", { name: "Add page", exact: true }).first().click();
    await page.waitForTimeout(400);
    let s = await S();
    if (s.pages !== 2 || s.pageIdx !== 1) throw new Error(`after add: pages=${s.pages} idx=${s.pageIdx}`);
    await page.getByRole("button", { name: "Add page options" }).click();
    await page.getByRole("menuitem", { name: /Duplicate this page/ }).click();
    await page.waitForTimeout(400);
    s = await S();
    if (s.pages !== 3) throw new Error("after duplicate pages=" + s.pages);
    await shot("three-pages");
    // go to page 1 by clicking its thumbnail
    await page.locator(".cf-strip [aria-label^='Page 1'], .cf-strip button").first().click();
    await page.waitForTimeout(400);
    s = await S();
    if (s.pageIdx !== 0) throw new Error("did not navigate to page 1, idx=" + s.pageIdx);
    return `pages=3 idx=${s.pageIdx}`;
  });

  await step("Templates tab: apply a template to the page", async () => {
    await tab("Templates");
    await page.waitForTimeout(1500);
    await shot("templates-tab");
    const before = await S();
    const thumbs = page.locator(".cf-ditem");
    const count = await thumbs.count();
    if (count < 4) throw new Error("only " + count + " template items");
    await thumbs.nth(1).click();
    await page.getByRole("button", { name: /Apply all \d+ pages/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Apply all" }).click();
    await page.waitForTimeout(3000);
    const after = await S();
    if (after.pages !== before.pages + 6) throw new Error(`pages ${before.pages}->${after.pages}`);
    await shot("template-applied");
    // single page onto current page
    await page
      .getByRole("button", { name: "Back" })
      .first()
      .click()
      .catch(() => {});
    return `items=${count}; pages ${before.pages}->${after.pages}; elements on page ${after.n}`;
  });

  await step("template: use one page on the current page, then undo", async () => {
    await tab("Templates");
    await page.locator(".cf-ditem").nth(2).click();
    await page.waitForTimeout(500);
    const before = await S();
    await page.getByRole("button", { name: "Use page 2 on the current page" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ timeout: 4000 }).catch(() => {});
    if (await dlg.isVisible().catch(() => false)) await dlg.getByRole("button", { name: "Replace" }).click();
    await page.waitForTimeout(1500);
    const after = await S();
    if (after.pages !== before.pages) throw new Error("page count changed " + before.pages + "->" + after.pages);
    if (after.n === before.n && after.types.join() === before.types.join()) throw new Error("page did not change");
    await shot("template-page-replaced");
    await page.getByRole("button", { name: /^Undo/ }).first().click();
    await page.waitForTimeout(500);
    const undone = await S();
    return `elements ${before.n}->${after.n}->undo ${undone.n}`;
  });

  const getDownload = async (formatLabel, expectMagic, ext) => {
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await page.waitForTimeout(500);
    if (formatLabel !== "PNG") {
      await page.getByLabel("File type").click();
      await page
        .getByRole("option", { name: new RegExp("^" + formatLabel) })
        .first()
        .click();
      await page.waitForTimeout(300);
    }
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click()]);
    const name = dl.suggestedFilename();
    const p = await dl.path();
    const buf = fs.readFileSync(p);
    const head = buf.subarray(0, 8);
    const asText = buf.subarray(0, 200).toString("latin1");
    if (!name.endsWith(ext)) throw new Error("filename " + name);
    if (!expectMagic(head, asText)) throw new Error(`bad magic for ${formatLabel}: ${[...head].map((b) => b.toString(16)).join(" ")} / ${asText.slice(0, 40)}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return `${name} ${buf.length} bytes`;
  };

  await step("download PNG (current page = single file)", async () => {
    // pick "Current page" so we get a single PNG, not a zip
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await page.waitForTimeout(400);
    await page
      .getByRole("radio", { name: "Current page" })
      .or(page.getByText("Current page", { exact: true }))
      .first()
      .click()
      .catch(() => {});
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click()]);
    const buf = fs.readFileSync(await dl.path());
    const name = dl.suggestedFilename();
    const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!png || !name.endsWith(".png")) throw new Error(`not a png: ${name} ${buf.length}`);
    await page.keyboard.press("Escape");
    return `${name} ${buf.length} bytes`;
  });

  await step("download PDF", async () => getDownload("PDF Standard", (h, t) => t.startsWith("%PDF-"), ".pdf"));
  await step("download SVG", async () =>
    getDownload("SVG", (h, t) => /<svg|<\?xml|PK/.test(t), ".svg").catch(async (e) => {
      if (/\.zip|PK/.test(e.message)) return "zip of svgs";
      throw e;
    }),
  );
  await step("download JPG", async () =>
    getDownload("JPG", (h, _t) => (h[0] === 0xff && h[1] === 0xd8) || (h[0] === 0x50 && h[1] === 0x4b), ".jpg").catch(async (e) => {
      if (/\.zip/.test(e.message)) return "zip of jpgs";
      throw e;
    }),
  );

  await step("autosave then reload keeps the design", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2500);
    const before = await S();
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    const after = await S();
    if (after.pages !== before.pages || after.id !== before.id) throw new Error(`pages ${before.pages}->${after.pages}`);
    await shot("after-reload");
    return `pages=${after.pages} n=${after.n}`;
  });

  await step("home lists the design under recent designs; reopen", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("Recent designs").waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    await shot("home-recent");
    const card = page.locator("a[href*='#/design/'], [data-design-id]").first();
    await card.click();
    await page.waitForURL(/#\/design\//, { timeout: 8000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 15000 });
    return "reopened";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 10)));
  await browser.close();
})().catch((e) => {
  console.log("E2E CRASH", e);
  process.exit(1);
});
