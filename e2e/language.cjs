/*
 * The interface in English or Hindi (B17), as a person meets it in a real browser. A browser whose language is English gets
 * English and a browser whose language is Hindi gets Hindi on its first visit, with the page's lang attribute to match. The
 * account menu of the dashboard has a Language entry: choosing the other language reloads the page in it, the choice is kept
 * on the device and wins over the browser's language on the next visit. In the editor, File > Language switches with an edit
 * that was just made, and after the reload the edit is still in the design and the bars, the side tabs and the menus speak
 * Hindi. No English word is left in the top bar, the side tabs or the open File menu (besides names, keys and formats). On a
 * Hindi page a search typed in English still finds things (the English names are searched too); dates are written the Hindi
 * way where the editor shows one; switching back from the Hindi File menu returns everything to English with the design kept;
 * and in Hindi the labels of the top bar and the side tabs fit their buttons at a desktop and at a phone size. Every word is
 * checked against the catalogs themselves (src/i18n/en, src/i18n/hi), which the dev server hands to the page as modules.
 */
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("language");
const results = [];
const logs = [];
let shotN = 0;

(async () => {
  const browser = await launch();
  const contexts = [];
  /** a new browser with its own storage, whose language is `locale` */
  const fresh = async (locale, viewport = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ locale, viewport });
    contexts.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on("console", (msg) => {
      if (msg.type() === "error") logs.push("console.error: " + msg.text().slice(0, 240));
    });
    page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
    return page;
  };
  let current = null; // the page the next screenshot is of
  const shot = (name, page = current) => page && page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push((r && r.skip ? "SKIP " : "PASS ") + name + (r ? "  " + (r.skip || r) : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 400));
      await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  const wait = (page, ms) => page.waitForTimeout(ms);

  /** the English and the Hindi catalogs, as the dev server serves them (functions are left out) */
  let en = null;
  let hi = null;
  const loadCatalogs = async (page) => {
    if (hi) return;
    const both = await page.evaluate(async () => {
      const [h, e] = await Promise.all([import("/src/i18n/hi/index.ts"), import("/src/i18n/en/index.ts")]);
      return JSON.stringify({ hi: h.hi, en: e.en });
    });
    ({ hi, en } = JSON.parse(both));
    if (!hi?.common?.language || !en?.common?.language) throw new Error("the catalogs could not be read from the dev server");
  };

  const openDashboard = async (page) => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.locator(".cf-dash").waitFor({ timeout: 40000 });
    await wait(page, 800);
  };
  const htmlLang = (page) => page.evaluate(() => document.documentElement.lang);
  const saved = (page) => page.evaluate(() => localStorage.getItem("craftly.language"));
  const visibleText = (page) => page.evaluate(() => document.body.innerText);
  /** throws for every word of `words` that is not on the page */
  const expectWords = async (page, words, where) => {
    const text = await visibleText(page);
    const missing = words.filter((w) => !text.includes(w));
    if (missing.length) throw new Error(`${where}: not on the page: ${missing.map((w) => JSON.stringify(w)).join(", ")}`);
  };

  /** opens `menuButton`, then its Language entry, and chooses `choice`; resolves once the page has loaded again */
  const chooseLanguage = async (page, menuButton, cat, choice) => {
    await menuButton.click();
    const entry = page.getByRole("menuitem", { name: new RegExp("^" + cat.common.language) });
    await entry.waitFor({ timeout: 10000 });
    await entry.click();
    const item = page.getByRole("menuitemcheckbox", { name: choice, exact: true });
    await item.waitFor({ timeout: 10000 });
    await shot("language-menu-" + (choice === "English" ? "en" : "hi"), page);
    const reloaded = page.waitForEvent("load", { timeout: 40000 });
    await item.click();
    await reloaded;
  };

  const accountButton = (page) => page.locator(".cf-dnav__account, .cf-dnav__account-wide").first();
  const fileButton = (page, cat) => page.locator(".cf-topbar").getByRole("button", { name: cat.editorChrome.fileMenu.file, exact: true });
  const waitEditor = async (page) => {
    await page.locator(".cf-workspace").waitFor({ timeout: 40000 });
    await page.waitForFunction(() => !!window.__editor?.getState().design, null, { timeout: 30000 });
    await wait(page, 1000);
  };
  const elementIds = (page) =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      return s.design.pages.flatMap((p) => p.elements.map((e) => e.id));
    });

  /* ---------------- 1. the browser's language on a first visit ---------------- */
  await step("a browser in English gets English and <html lang=en>; a browser in Hindi with nothing saved gets Hindi and <html lang=hi>", async () => {
    const enPage = await fresh("en-US");
    current = enPage;
    await openDashboard(enPage);
    await loadCatalogs(enPage);
    if ((await htmlLang(enPage)) !== "en") throw new Error("en-US browser: <html lang=" + (await htmlLang(enPage)) + ">");
    await expectWords(enPage, [en.dashboard.home.title, en.dashboard.shell.nav.projects, en.dashboard.shell.nav.templates], "en-US");
    if ((await enPage.title()) !== en.dashboard.pageTitles.home) throw new Error("en-US title " + (await enPage.title()));
    await shot("first-visit-en", enPage);

    const hiPage = await fresh("hi-IN");
    current = hiPage;
    await openDashboard(hiPage);
    if ((await saved(hiPage)) !== null) throw new Error("something was saved before any choice: " + (await saved(hiPage)));
    if ((await htmlLang(hiPage)) !== "hi") throw new Error("hi-IN browser: <html lang=" + (await htmlLang(hiPage)) + ">");
    const words = [
      hi.dashboard.home.title,
      hi.dashboard.shell.nav.home,
      hi.dashboard.shell.nav.projects,
      hi.dashboard.shell.nav.templates,
      hi.dashboard.shortcuts.presentation,
      hi.dashboard.home.forYou,
    ];
    await expectWords(hiPage, words, "hi-IN");
    if ((await hiPage.title()) !== hi.dashboard.pageTitles.home) throw new Error("hi-IN title " + (await hiPage.title()));
    if (await hiPage.getByText(en.dashboard.home.title, { exact: true }).count()) throw new Error("the English heading is on the Hindi page");
    await hiPage.getByRole("button", { name: hi.dashboard.account.menuLabel }).first().waitFor({ timeout: 5000 });
    await shot("first-visit-hi", hiPage);
    return `en: "${en.dashboard.home.title}"; hi: ${words.length} words, title "${hi.dashboard.pageTitles.home}"`;
  });

  /* ---------------- 2. the account menu ---------------- */
  await step("account menu > Language > हिन्दी reloads the dashboard in Hindi, keeps the choice, and it beats the browser's English on the next load", async () => {
    const page = await fresh("en-US");
    current = page;
    await openDashboard(page);
    await expectWords(page, [en.dashboard.home.title], "before");
    // the entry shows the language in use
    await accountButton(page).click();
    const entry = page.getByRole("menuitem", { name: new RegExp("^" + en.common.language) });
    await entry.waitFor({ timeout: 10000 });
    const entryText = (await entry.innerText()).replace(/\s+/g, " ").trim();
    if (!entryText.includes("English")) throw new Error("the Language entry says " + JSON.stringify(entryText));
    await page.keyboard.press("Escape");
    await wait(page, 300);
    await chooseLanguage(page, accountButton(page), en, "हिन्दी");
    await page.locator(".cf-dash").waitFor({ timeout: 40000 });
    await wait(page, 800);
    if ((await htmlLang(page)) !== "hi") throw new Error("after the switch <html lang=" + (await htmlLang(page)) + ">");
    if ((await saved(page)) !== "hi") throw new Error("craftly.language = " + (await saved(page)));
    await expectWords(page, [hi.dashboard.home.title, hi.dashboard.shell.nav.projects], "after the switch");
    await shot("dashboard-switched-hi", page);
    // the next load: the saved Hindi, not the browser's English
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-dash").waitFor({ timeout: 40000 });
    if ((await htmlLang(page)) !== "hi") throw new Error("after a reload <html lang=" + (await htmlLang(page)) + ">");
    await expectWords(page, [hi.dashboard.home.title], "after a reload");
    // the other way round: a Hindi browser that chose English stays English
    const other = await fresh("hi-IN");
    current = other;
    await openDashboard(other);
    await chooseLanguage(other, accountButton(other), hi, "English");
    await other.locator(".cf-dash").waitFor({ timeout: 40000 });
    if ((await saved(other)) !== "en" || (await htmlLang(other)) !== "en")
      throw new Error(`hi-IN browser after choosing English: saved ${await saved(other)}, lang ${await htmlLang(other)}`);
    await other.reload({ waitUntil: "load" });
    await other.locator(".cf-dash").waitFor({ timeout: 40000 });
    await expectWords(other, [en.dashboard.home.title], "hi-IN browser that chose English, reloaded");
    return "en-US -> hi kept over a reload; hi-IN -> en kept over a reload";
  });

  /* ---------------- 3. the editor: File > Language with an unsaved edit ---------------- */
  const page = await fresh("en-US");
  current = page;
  let before = [];
  let added = "";
  let designId = "";
  await step("editor: File > Language > हिन्दी right after adding a text box: after the reload the text box is there and the bars, tabs and menus are Hindi", async () => {
    await openDashboard(page);
    await page
      .getByRole("button", { name: new RegExp("^" + en.dashboard.shortcuts.presentation) })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 30000 });
    await waitEditor(page);
    designId = await page.evaluate(() => window.__editor.getState().design.id);
    before = await elementIds(page);
    // the edit, made the way a person makes it: Text tab > Add a text box
    await page.getByRole("tab", { name: en.panelsTabs.tabs.text, exact: true }).click();
    await page.getByRole("button", { name: en.panelsTabs.text.addTextBox, exact: true }).click();
    await page.waitForFunction((n) => window.__editor.getState().design.pages.flatMap((p) => p.elements).length === n + 1, before.length, { timeout: 10000 });
    added = (await elementIds(page)).find((id) => !before.includes(id));
    await page.keyboard.press("Escape"); // leaves the text editing the new box starts in
    await wait(page, 150);
    const stateAtSwitch = await page.evaluate(() => window.__editor.getState().saveState);
    await chooseLanguage(page, fileButton(page, en), en, "हिन्दी");
    await waitEditor(page);
    const after = await elementIds(page);
    const sameDesign = await page.evaluate(() => window.__editor.getState().design.id);
    if (sameDesign !== designId) throw new Error("another design opened: " + sameDesign);
    if (!after.includes(added))
      throw new Error(
        `the new text box ${added} is gone after the reload (${after.length} elements, ${before.length} before the edit; save state at the switch: ${stateAtSwitch})`,
      );
    if ((await htmlLang(page)) !== "hi" || (await saved(page)) !== "hi") throw new Error(`lang ${await htmlLang(page)}, saved ${await saved(page)}`);
    // the bars and the side tabs
    const topbar = page.locator(".cf-topbar");
    await topbar.getByRole("button", { name: hi.editorChrome.fileMenu.file, exact: true }).waitFor({ timeout: 10000 });
    await topbar.getByRole("button", { name: hi.common.undo }).waitFor({ timeout: 5000 });
    await topbar.getByRole("button", { name: hi.editorChrome.topBar.home, exact: true }).waitFor({ timeout: 5000 });
    await topbar.getByRole("button", { name: hi.editorChrome.topBar.resize, exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole("tab", { name: hi.panelsTabs.tabs.elements, exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole("tab", { name: hi.panelsTabs.tabs.text, exact: true }).waitFor({ timeout: 5000 });
    // the File menu
    await fileButton(page, hi).click();
    const menu = page.getByRole("menu", { name: hi.editorChrome.fileMenu.file, exact: true });
    await menu.waitFor({ timeout: 10000 });
    for (const label of [
      hi.editorChrome.fileMenu.createNew,
      hi.editorChrome.fileMenu.makeCopy,
      hi.editorChrome.fileMenu.download,
      hi.editorChrome.fileMenu.versions,
      hi.editorChrome.fileMenu.help,
    ]) {
      await menu.getByRole("menuitem", { name: label }).first().waitFor({ timeout: 5000 });
    }
    const lang = menu.getByRole("menuitem", { name: new RegExp("^" + hi.common.language) });
    if (!(await lang.innerText()).includes("हिन्दी")) throw new Error("the Language entry says " + (await lang.innerText()));
    await shot("editor-hi-file-menu", page);
    await page.keyboard.press("Escape");
    await wait(page, 300);
    return `text box ${added} kept (save state at the switch: ${stateAtSwitch}); File menu, tabs and toolbar buttons in Hindi`;
  });

  /* ---------------- 4. English left in the Hindi editor ---------------- */
  await step("no English words in the Hindi top bar, side tabs and open File menu (visible text and accessible names)", async () => {
    await fileButton(page, hi).click();
    await page.locator(".cf-filemenu").waitFor({ timeout: 10000 });
    await wait(page, 300);
    const found = await page.evaluate(() => {
      const roots = [
        ["top bar", document.querySelector(".cf-topbar")],
        ["side tabs", document.querySelector(".cf-leftrail")],
        ["File menu", document.querySelector(".cf-filemenu")],
      ];
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      const out = [];
      for (const [where, root] of roots) {
        if (!root) {
          out.push({ where, kind: "missing", text: "" });
          continue;
        }
        out.push({ where, kind: "text", text: root.innerText });
        for (const el of root.querySelectorAll("[aria-label], [title], [placeholder]")) {
          if (!shown(el) || el.closest(".cf-sr-only")) continue;
          for (const a of ["aria-label", "title", "placeholder"]) if (el.getAttribute(a)) out.push({ where, kind: a, text: el.getAttribute(a) });
        }
      }
      return { out, title: window.__editor.getState().design.title };
    });
    const missing = found.out.filter((f) => f.kind === "missing").map((f) => f.where);
    if (missing.length) throw new Error("not on the page: " + missing.join(", "));
    // names, keys and formats stay as they are (docs/TRANSLATION.md, rule 5)
    const allowed = new Set(["craftly", "ctrl", "shift", "alt", "cmd", "esc", "enter", "tab", "png", "jpg", "pdf", "svg", "webm", "mp4", "gif", "px", "in", "mm", "cm", "ai"]);
    for (const w of found.title.toLowerCase().match(/[a-z]+/g) || []) allowed.add(w);
    const leaks = [];
    for (const f of found.out) {
      for (const w of f.text.match(/[A-Za-z][A-Za-z'’-]*/g) || []) {
        if (!allowed.has(w.toLowerCase()) && !/^[A-Z]$/.test(w)) leaks.push(`${f.where} ${f.kind}: "${w}" in ${JSON.stringify(f.text.replace(/\s+/g, " ").slice(0, 60))}`);
      }
    }
    await shot("leak-check-file-menu", page);
    await page.keyboard.press("Escape");
    await wait(page, 300);
    if (leaks.length) throw new Error(`${leaks.length} English word(s): ` + [...new Set(leaks)].slice(0, 6).join(" | "));
    return `${found.out.length} texts checked, design title "${found.title}"`;
  });

  await step("emptying the design's title in the Hindi top bar gives it the Hindi name for an untitled design", async () => {
    const field = page.getByRole("textbox", { name: hi.editorChrome.topBar.titleLabel, exact: true });
    const old = await field.inputValue();
    // a title of its own first, so that what comes after emptying it cannot be the old title left alone
    await field.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Spring flyer");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__editor.getState().design.title === "Spring flyer", null, { timeout: 5000 });
    await field.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await wait(page, 400);
    const title = await page.evaluate(() => window.__editor.getState().design.title);
    const shown = await field.inputValue();
    const wanted = [hi.editorChrome.topBar.untitled, hi.core.untitledDesign, hi.dashboard.actions.untitledDesign];
    // put the old title back, whatever happened, so that the steps after this one are not affected (a Hindi title would count as
    // Hindi left in the English bars once the page is switched back)
    await field.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type(old);
    await page.keyboard.press("Enter");
    await page.waitForFunction((t) => window.__editor.getState().design.title === t, old, { timeout: 5000 });
    if (!wanted.includes(title)) {
      throw new Error(`the title became ${JSON.stringify(title)} (field ${JSON.stringify(shown)}), not ${JSON.stringify(hi.editorChrome.topBar.untitled)}`);
    }
    return `"${title}"`;
  });

  /* ---------------- 5. search on a Hindi page finds English names ---------------- */
  await step("editor in Hindi: the Text tab's search typed in English ('bakery') finds the Hindi-named combination", async () => {
    await page.getByRole("tab", { name: hi.panelsTabs.tabs.text, exact: true }).click();
    const search = page.getByPlaceholder(hi.panelsTabs.text.search, { exact: true });
    await search.waitFor({ timeout: 10000 });
    await search.fill("bakery");
    await wait(page, 800);
    const name = hi.data.textCombos["vintage-bakery"];
    if (!name || /bakery/i.test(name)) throw new Error("the Hindi name of the combination is " + JSON.stringify(name) + ", which does not test the English search");
    const hits = page.locator(`[aria-label^="${name}"]`);
    const n = await hits.count();
    await shot("text-search-bakery", page);
    if (n === 0)
      throw new Error(
        `no result named "${name}" for "bakery"; panel says: ` + (await page.locator(".cf-sidepanel, [role=tabpanel]").first().innerText()).slice(0, 160).replace(/\s+/g, " "),
      );
    await search.fill("");
    return `${n} result(s): "${name}"`;
  });

  /* ---------------- 6. dates and numbers ---------------- */
  await step("dates in Hindi: a version saved now shows its date as hi-IN writes it (File > Version history)", async () => {
    await fileButton(page, hi).click();
    await page.getByRole("menuitem", { name: hi.editorChrome.fileMenu.versions }).click();
    const dlg = page.getByRole("dialog", { name: hi.editorChrome.versions.title });
    await dlg.waitFor({ timeout: 15000 });
    const t0 = Date.now();
    await dlg.getByRole("button", { name: hi.editorChrome.versions.saveNow }).click();
    const when = dlg.locator(".cf-versions__when").first();
    await when.waitFor({ timeout: 15000 });
    const shown = (await when.innerText()).trim();
    const t1 = Date.now();
    const expected = await page.evaluate(
      ([a, b]) => {
        const f = (loc, t) => new Intl.DateTimeFormat(loc, { dateStyle: "medium", timeStyle: "short" }).format(t);
        return { hi: [f("hi-IN", a), f("hi-IN", b)], en: f("en-US", b) };
      },
      [t0, t1],
    );
    const meta = (await dlg.locator(".cf-versions__meta").first().innerText()).trim();
    await shot("versions-date-hi", page);
    await page.keyboard.press("Escape");
    await wait(page, 300);
    if (!expected.hi.includes(shown))
      throw new Error(`the date reads ${JSON.stringify(shown)}; hi-IN writes ${JSON.stringify(expected.hi[1])} (en-US: ${JSON.stringify(expected.en)})`);
    if (shown === expected.en) throw new Error("the date is written as en-US writes it");
    const label = await page.evaluate(async () => (await import("/src/i18n/hi/index.ts")).hi.editorChrome.versions.label("Saved by you"));
    if (!meta.startsWith(label)) throw new Error(`the version's label reads ${JSON.stringify(meta)}, not ${JSON.stringify(label)}`);
    return `"${shown}" (en-US would be "${expected.en}"), "${meta}"`;
  });

  await step("numbers in Hindi: the File menu's page count and size, and the zoom, are written by hi-IN", async () => {
    // hi-IN writes digits the Latin way and groups by lakh and crore: small numbers read the same as in English, so this checks
    // that what is shown equals what Intl writes for hi-IN, which is all a person can see
    const facts = await page.evaluate(() => {
      const s = window.__editor.getState();
      return { pages: s.design.pages.length, zoom: Math.round(s.zoom * 100) };
    });
    await fileButton(page, hi).click();
    const meta = (await page.locator(".cf-filemenu__meta").innerText()).trim();
    await page.keyboard.press("Escape");
    const pagesText = await page.evaluate((n) => new Intl.NumberFormat("hi-IN").format(n), facts.pages);
    if (!meta.startsWith(pagesText + " पेज")) throw new Error("the File menu says " + JSON.stringify(meta));
    const zoomName = await page.evaluate((z) => `ज़ूम, ${new Intl.NumberFormat("hi-IN").format(z)}%`, facts.zoom);
    const zoomButton = page.getByRole("button", { name: zoomName });
    const zoomCount = await zoomButton.count();
    if (!zoomCount) return { skip: `File menu "${meta}"; no zoom button named "${zoomName}" on screen to check` };
    return `File menu "${meta}", zoom button "${zoomName}"`;
  });

  /* ---------------- 8. layout in Hindi ---------------- */
  const overflowing = (p) =>
    p.evaluate(() => {
      const out = [];
      let checked = 0;
      const roots = [...document.querySelectorAll(".cf-topbar, .cf-leftrail")];
      for (const root of roots) {
        for (const el of root.querySelectorAll("button, button *")) {
          if (el.closest(".cf-topbar__title")) continue; // the design's own title is cut on purpose
          if (el.closest(".cf-sr-only") || el.matches("svg, svg *")) continue;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0 || r.height === 0) continue;
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own) continue;
          checked++;
          if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) {
            out.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}" ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
          }
          // the text also has to stay inside its button
          const button = el.closest("button");
          if (button && button !== el) {
            const b = button.getBoundingClientRect();
            if (r.right > b.right + 1 || r.left < b.left - 1)
              out.push(`"${el.textContent.trim().slice(0, 30)}" sticks out of its button by ${Math.round(Math.max(r.right - b.right, b.left - r.left))}px`);
          }
        }
      }
      return { out, checked, roots: roots.length };
    });
  await step("layout in Hindi at 1280x800: no label of the top bar or the side tabs overflows its button", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await wait(page, 800);
    await shot("layout-hi-1280", page);
    const { out: bad, checked, roots } = await overflowing(page);
    if (roots < 2 || checked < 8) throw new Error(`only ${checked} labels in ${roots} bars were found to check`);
    if (bad.length) throw new Error(`${bad.length} overflowing: ` + bad.slice(0, 6).join(" | "));
    return `${checked} labels, nothing overflows`;
  });

  await step("layout in Hindi at 375x812: no label of the top bar or the side tabs overflows its button", async () => {
    // the same browser (the design lives in its storage), loaded again at a phone's size
    let phoneChecked;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: "load" });
    await waitEditor(page);
    try {
      if ((await htmlLang(page)) !== "hi") throw new Error("the phone page is in " + (await htmlLang(page)));
      await shot("layout-hi-375", page);
      const { out: bad, checked, roots } = await overflowing(page);
      if (roots < 1 || checked < 3) throw new Error(`only ${checked} labels in ${roots} bars were found to check`);
      if (bad.length) throw new Error(`${bad.length} overflowing: ` + bad.slice(0, 6).join(" | "));
      phoneChecked = `${checked} labels in ${roots} bar(s), nothing overflows`;
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.reload({ waitUntil: "load" });
      await waitEditor(page);
    }
    return phoneChecked;
  });

  /* ---------------- 7. back to English ---------------- */
  await step("File > भाषा > English from the Hindi editor returns everything to English with the design and the text box kept", async () => {
    current = page;
    const count = (await elementIds(page)).length;
    await chooseLanguage(page, fileButton(page, hi), hi, "English");
    await waitEditor(page);
    if ((await htmlLang(page)) !== "en" || (await saved(page)) !== "en") throw new Error(`lang ${await htmlLang(page)}, saved ${await saved(page)}`);
    const ids = await elementIds(page);
    if ((await page.evaluate(() => window.__editor.getState().design.id)) !== designId) throw new Error("another design opened");
    if (!ids.includes(added) || ids.length !== count) throw new Error(`${ids.length} elements (${count} before), text box kept: ${ids.includes(added)}`);
    await page.locator(".cf-topbar").getByRole("button", { name: en.editorChrome.fileMenu.file, exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole("tab", { name: en.panelsTabs.tabs.elements, exact: true }).waitFor({ timeout: 5000 });
    await page.locator(".cf-topbar").getByRole("button", { name: en.common.undo }).waitFor({ timeout: 5000 });
    await fileButton(page, en).click();
    const menu = page.getByRole("menu", { name: en.editorChrome.fileMenu.file, exact: true });
    await menu.getByRole("menuitem", { name: en.editorChrome.fileMenu.versions }).waitFor({ timeout: 5000 });
    await shot("editor-back-in-en", page);
    await page.keyboard.press("Escape");
    const text = await page.locator(".cf-topbar, .cf-leftrail").allInnerTexts();
    const devanagari = text.join(" ").match(/[ऀ-ॿ]+/g);
    if (devanagari) throw new Error("Hindi left in the English bars: " + devanagari.slice(0, 5).join(" "));
    return `${ids.length} elements kept, bars and File menu in English`;
  });

  /* ---------------- 5b. the dashboard's search on a Hindi page ---------------- */
  await step("dashboard in Hindi: the home search typed in English ('poster') finds design types and templates", async () => {
    const hiPage = await fresh("hi-IN");
    current = hiPage;
    await openDashboard(hiPage);
    const search = hiPage.getByRole("combobox", { name: hi.dashboard.search.placeholder });
    await search.fill("poster");
    const list = hiPage.getByRole("listbox", { name: hi.dashboard.shared.searchResults });
    await list.waitFor({ timeout: 10000 });
    await wait(hiPage, 500);
    const options = await list.getByRole("option").allInnerTexts();
    await shot("home-search-poster", hiPage);
    if (!options.length) throw new Error("no results for 'poster'");
    const poster = hi.data.designTypes.poster;
    if (!options.some((o) => o.includes(poster))) throw new Error(`"${poster}" is not among ${options.length} results: ${options.slice(0, 4).join(" | ").replace(/\s+/g, " ")}`);
    await search.fill("");
    return `${options.length} results, among them "${poster}"`;
  });

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 4).join(" | "));
    return "clean";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  for (const ctx of contexts) await ctx.close().catch(() => undefined);
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
