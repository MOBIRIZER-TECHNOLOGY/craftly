/*
 * Keyboard and screen reader basics, checked in a real browser (the things a jsdom test cannot see: the real tab order,
 * where focus goes when a dialog closes, which landmarks and headings the page really has):
 *   - a person with only a keyboard reaches the toolbar, the canvas (a named stop that walks its elements and then moves on,
 *     with a frame to show it has the keyboard) and the dialogs, and is never left on nothing
 *   - closing a dialog puts the keyboard back on what opened it
 *   - one top-level heading, no gaps between heading levels, one banner landmark even while a popover is open
 *   - the tabs of the rail never point at a panel that is not on the page
 *   - the colours of words keep their contrast where a stylesheet cannot tell (over a gradient), measured from the pixels: the
 *     top bar's labels at rest and under the pointer, the dashboard headline, the initial of the account avatar
 *   - no button, tab or field is smaller than 24 x 24 px with another one close by (WCAG 2.5.8)
 */
const { launch, outDir, BASE } = require("./lib.cjs");
const OUT = outDir("a11y");
const results = [];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  let n = 0;
  const shot = (name) => page.screenshot({ path: OUT + String(++n).padStart(2, "0") + "-" + name + ".png" });
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
  const wait = (ms) => page.waitForTimeout(ms);
  /** what has the keyboard right now: its label, or text */
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el && el !== document.body ? (el.getAttribute("aria-label") || el.innerText || el.tagName).replace(/\s+/g, " ").trim().slice(0, 60) : "(page body)";
    });

  /**
   * The contrast of one element's text over what is painted behind it, read from the pixels (a stylesheet cannot tell: the
   * background may be a gradient). The text is made transparent, the pixels in its box are read from a screenshot, and the
   * real text colour is compared with the darkest and the lightest of them (the 2 % most extreme pixels left out).
   */
  const textContrast = async (selector) => {
    const el = page.locator(selector).first();
    const info = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      probe.fillStyle = getComputedStyle(node).color; // any CSS colour, color-mix() included, as sRGB
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      return { box: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }, fg: [d[0], d[1], d[2]], alpha: d[3] / 255 };
    });
    const hide = await page.addStyleTag({
      content: "*, *::before, *::after { -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }",
    });
    await wait(80);
    const png = await page.screenshot({ clip: info.box });
    await hide.evaluate((node) => node.remove());
    return page.evaluate(
      async ({ b64, fg, alpha }) => {
        const bmp = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const lin = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        const px = [];
        for (let i = 0; i < data.length; i += 4) px.push([data[i], data[i + 1], data[i + 2]]);
        px.sort((a, b) => lum(a) - lum(b));
        const cut = Math.floor(px.length * 0.02);
        const ratio = (bg) => {
          const over = [0, 1, 2].map((k) => fg[k] * alpha + bg[k] * (1 - alpha));
          const a = lum(over),
            b = lum(bg);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        return Math.min(ratio(px[cut]), ratio(px[px.length - 1 - cut]));
      },
      { b64: png.toString("base64"), fg: info.fg, alpha: info.alpha },
    );
  };

  /** Contrast of text with a gradient fill: the page with it and without it, compared pixel by pixel where the letters are. */
  const gradientTextContrast = async (selector) => {
    const el = page.locator(selector).first();
    const box = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    });
    const withText = await page.screenshot({ clip: box });
    await el.evaluate((node) => {
      node.style.visibility = "hidden";
    });
    const without = await page.screenshot({ clip: box });
    await el.evaluate((node) => {
      node.style.visibility = "";
    });
    return page.evaluate(
      async ({ a64, b64 }) => {
        const read = async (b) => {
          const bmp = await createImageBitmap(await (await fetch("data:image/png;base64," + b)).blob());
          const canvas = document.createElement("canvas");
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0);
          return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const A = await read(a64),
          B = await read(b64);
        const lin = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        const lum = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
        let max = 0;
        const dist = [];
        for (let i = 0; i < A.length; i += 4) {
          const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
          dist.push(d);
          max = Math.max(max, d);
        }
        if (max < 30) return 0; // no letters found
        let worst = Infinity;
        dist.forEach((d, k) => {
          if (d < 0.9 * max) return; // only pixels the letters cover completely, not their anti-aliased edge
          const a = lum(A, k * 4),
            b = lum(B, k * 4);
          worst = Math.min(worst, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
        });
        return worst;
      },
      { a64: withText.toString("base64"), b64: without.toString("base64") },
    );
  };

  await step("dashboard: closing About puts the keyboard back on the Account button", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await wait(800);
    await page
      .getByRole("button", { name: /account/i })
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: /About Craftly/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor({ timeout: 8000 });
    await page.keyboard.press("Escape");
    await wait(700);
    const now = await focused();
    if (now !== "Account") throw new Error("the keyboard went to: " + now);
    return "back on Account";
  });

  await step("dashboard: the headline (gradient text) reaches 3:1 and the initial of the account avatar 4.5:1, measured from the pixels", async () => {
    const headline = await gradientTextContrast(".cf-hero__title");
    if (headline < 3) throw new Error(`the headline is ${headline.toFixed(2)}:1 at its worst`);
    const initial = await textContrast(".cf-dnav__account .cf-avatar > span:visible");
    if (initial < 4.5) throw new Error(`the account initial is ${initial.toFixed(2)}:1`);
    return `headline ${headline.toFixed(2)}:1, initial ${initial.toFixed(2)}:1`;
  });

  await step("editor: set-up, a presentation with a heading on its page", async () => {
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await page
      .getByRole("button", { name: /Add a heading/i })
      .first()
      .click();
    await wait(800);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const count = await page.evaluate(() => {
      const s = window.__editor.getState();
      return s.design.pages.find((p) => p.id === s.activePageId).elements.length;
    });
    if (count !== 1) throw new Error("expected one element on the page, found " + count);
  });

  await step("editor: the first Tab from the page itself reaches a control (it used to land nowhere), also right after a reload", async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Tab");
    const first = await focused();
    if (first === "(page body)") throw new Error("Tab went nowhere");
    // keep what was made: save now and wait until the top bar says so, or the reload could take the heading away
    await page.keyboard.press("Control+s");
    await page.getByRole("button", { name: /^All changes saved/ }).waitFor({ timeout: 8000 });
    await wait(500);
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    await page.keyboard.press("Tab");
    const second = await focused();
    if (second === "(page body)") throw new Error("Tab went nowhere after a reload");
    return `${first} / ${second}`;
  });

  await step("editor: the canvas is a named stop, Tab walks the elements on it and then moves on, Shift+Tab comes back", async () => {
    await page.getByRole("group", { name: "Design canvas" }).focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    const selected = await page.evaluate(() => window.__editor.getState().selection.length);
    const onCanvas = await focused();
    if (selected !== 1 || onCanvas !== "Design canvas") throw new Error(`Tab on the canvas: ${selected} selected, focus on ${onCanvas}`);
    await page.keyboard.press("Tab");
    const next = await focused();
    if (next === "Design canvas" || next === "(page body)") throw new Error("Tab did not move on after the last element: " + next);
    await page.keyboard.press("Shift+Tab");
    const back = await focused();
    if (back !== "Design canvas") throw new Error("Shift+Tab did not come back to the canvas: " + back);
    return `selected, then on to "${next}", and back`;
  });

  await step("editor: the canvas shows a frame while the keyboard has it", async () => {
    const frame = await page.evaluate(() => {
      const host = document.querySelector("[data-cf-workspace]");
      const cs = getComputedStyle(host, "::after");
      return { focusVisible: host.matches(":focus-visible"), content: cs.content, width: cs.borderTopWidth, style: cs.borderTopStyle };
    });
    if (!frame.focusVisible) throw new Error("the keyboard did not reach the canvas by Shift+Tab");
    if (frame.content === "none" || frame.width !== "2px" || frame.style !== "solid") throw new Error("no frame: " + JSON.stringify(frame));
    await shot("canvas-focus");
    return "2px frame";
  });

  await step("editor: one top-level heading names the design, inside the toolbar, and the headings have no gaps", async () => {
    const info = await page.evaluate(() => {
      const heads = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")];
      return {
        levels: heads.map((h) => Number(h.tagName[1])),
        h1: [...document.querySelectorAll("h1")].map((h) => ({ text: h.textContent, inToolbar: !!h.closest("header[aria-label='Design toolbar']") })),
      };
    });
    if (info.h1.length !== 1) throw new Error("h1 count: " + info.h1.length);
    if (!info.h1[0].inToolbar || !info.h1[0].text) throw new Error("the h1 is not in the toolbar or has no text: " + JSON.stringify(info.h1[0]));
    if (info.levels[0] !== 1) throw new Error("the first heading is an h" + info.levels[0]);
    for (let i = 1; i < info.levels.length; i++)
      if (info.levels[i] > info.levels[i - 1] + 1) throw new Error(`h${info.levels[i - 1]} is followed by h${info.levels[i]}: ${info.levels.join(",")}`);
    return "levels " + info.levels.join(" ");
  });

  await step("editor: the toolbar stays the one banner landmark, also while the Share panel is open", async () => {
    const before = await page.getByRole("banner").count();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("dialog", { name: "Share design" }).waitFor({ timeout: 8000 });
    const during = await page.getByRole("banner").count();
    await page.keyboard.press("Escape");
    if (before !== 1 || during !== 1) throw new Error(`banners: ${before} before, ${during} while Share is open`);
    return "1 and 1";
  });

  await step("editor: a rail tab never points at a panel that is not on the page, also while a context panel covers it", async () => {
    // the heading is selected after the walk above: open the Animate panel on it
    await page.getByRole("button", { name: "Animate" }).first().click();
    await wait(800);
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll("[role=tab][aria-selected=true][aria-controls]")].map((t) => t.getAttribute("aria-controls")).filter((id) => !document.getElementById(id)),
    );
    if (missing.length) throw new Error("these ids are not on the page: " + missing.join(", "));
    return "all present";
  });

  await step("editor: the keyboard can reach and scroll the list of shortcuts, and closing the dialog gives the keyboard back to the menu button", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "File" }).first().click();
    await page.getByRole("menuitem", { name: /^Help/ }).click();
    await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ timeout: 8000 });
    await page.keyboard.press("Tab");
    const onList = await focused();
    if (onList !== "Shortcuts") throw new Error("the next Tab stop after the search box is: " + onList);
    await page.keyboard.press("Escape");
    await wait(700);
    const back = await focused();
    if (back !== "File") throw new Error("after closing, the keyboard is on: " + back);
    return "list reachable, back on File";
  });

  await step("editor: the white labels on the top bar and the title field reach 4.5:1 over the gradient, at rest and under the pointer", async () => {
    const parts = {
      File: ".cf-topbar__btn.cf-btn--ghost[aria-haspopup=menu] .cf-btn__label",
      Resize: ".cf-topbar__lbl--keep",
      Editing: ".cf-topbar__mode .cf-topbar__lbl",
      "the title": ".cf-topbar__title-input",
      Present: ".cf-topbar__split-main .cf-topbar__lbl--share",
    };
    let worst = Infinity;
    for (const [name, selector] of Object.entries(parts)) {
      await page.mouse.move(700, 450);
      const rest = await textContrast(selector);
      await page.locator(selector).first().hover();
      const hover = await textContrast(selector);
      if (Math.min(rest, hover) < 4.5) throw new Error(`${name}: ${rest.toFixed(2)}:1 at rest, ${hover.toFixed(2)}:1 under the pointer`);
      worst = Math.min(worst, rest, hover);
    }
    await page.mouse.move(700, 450);
    return `worst ${worst.toFixed(2)}:1`;
  });

  await step("editor: the options button of a page is at least 24 × 24 px", async () => {
    await page.locator(".cf-strip__cell").first().hover();
    const box = await page
      .getByRole("button", { name: /^Page \d+ options$/ })
      .first()
      .boundingBox();
    if (!box || box.width < 23.99 || box.height < 23.99) throw new Error(`it is ${box && box.width} × ${box && box.height}`);
    return `${box.width} × ${box.height}`;
  });

  await step("editor: every page's options button has a name of its own, the add tile's caret is called Add page options, and each menu is named like its button", async () => {
    await page.evaluate(() => window.__editor.getState().actions.addPage());
    await wait(500);
    const names = await page.locator(".cf-strip__cell button[aria-label$=' options']").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    if (names.join("|") !== "Page 1 options|Page 2 options|Add page options") throw new Error("the buttons are called: " + names.join(" | "));
    await page.getByRole("button", { name: "Page 2 options" }).click();
    await page.getByRole("menu", { name: "Page 2 options" }).waitFor({ timeout: 4000 });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Add page options" }).click();
    await page.getByRole("menu", { name: "Add page options" }).waitFor({ timeout: 4000 });
    await page.keyboard.press("Escape");
    return names.join(", ");
  });

  await step("editor: every button, tab, link and field is 24 × 24 px, or has room round it (WCAG 2.5.8)", async () => {
    await page.mouse.move(700, 450);
    const { total, tooSmall } = await page.evaluate(() => {
      const SEL =
        "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=link],[role=option],[role=slider]";
      const list = [];
      for (const el of document.querySelectorAll(SEL)) {
        if (el.closest("[disabled],[aria-disabled='true'],fieldset:disabled,[inert]") || el.disabled) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || (cs.display === "inline" && el.tagName === "A")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue; // visually hidden or off screen
        list.push({ el, x: r.left, y: r.top, w: r.width, h: r.height });
      }
      const small = (t) => t.w < 23.99 || t.h < 23.99;
      // the 24 px circle round the middle of a small target must touch no other target (a big one by its box, a small one by its own circle)
      const crowded = (a, b) => {
        const cx = a.x + a.w / 2,
          cy = a.y + a.h / 2;
        if (small(b)) return Math.hypot(cx - (b.x + b.w / 2), cy - (b.y + b.h / 2)) < 24;
        return Math.hypot(Math.max(b.x - cx, 0, cx - (b.x + b.w)), Math.max(b.y - cy, 0, cy - (b.y + b.h))) < 12;
      };
      const tooSmall = list
        .filter((t) => small(t) && list.some((o) => o !== t && !o.el.contains(t.el) && !t.el.contains(o.el) && crowded(t, o)))
        .map(
          (t) => `${t.el.getAttribute("aria-label") || (t.el.textContent || "").trim().slice(0, 24) || t.el.tagName} ${Math.round(t.w * 10) / 10} × ${Math.round(t.h * 10) / 10}`,
        );
      return { total: list.length, tooSmall };
    });
    if (tooSmall.length) throw new Error("too small and too close to the next one: " + tooSmall.join("; "));
    return `${total} targets checked`;
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
