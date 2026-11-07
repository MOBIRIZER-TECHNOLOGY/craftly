/* Animate: element animations, page animations, timing, transitions, preview, persistence and motion templates. */
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("animate");
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
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
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
        pages: s.design.pages.map((p) => ({ dur: p.duration, tr: p.transition })),
        idx: s.design.pages.findIndex((p) => p.id === s.activePageId),
        els: pg.elements.map((e) => ({ id: e.id, type: e.type, anim: e.animation })),
        sel: s.selection.slice(),
      };
    });
  const tb = () => page.locator("[role=toolbar]:not(.cf-rail)");
  const tile = (kind, phase) => page.locator(`.cf-an__tile[data-kind='${kind}']${phase ? `[data-phase='${phase}']` : ""}`).first();
  const previewing = () => page.evaluate(() => !!document.querySelector(".cf-workspace.is-previewing"));

  await step("setup: new presentation with a shape and a heading", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(800);
    await page.getByRole("button", { name: "Browse shapes" }).click();
    await wait(400);
    await page.locator(".cf-ditem").nth(2).click();
    await wait(300);
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await page
      .getByRole("button", { name: /Add a heading/i })
      .first()
      .click();
    await page.keyboard.type("Animate me", { delay: 10 });
    await page.keyboard.press("Escape");
    await wait(400);
    const s = await S();
    if (s.els.length !== 2) throw new Error("elements " + s.els.length);
  });

  await step("the Animate button is on the text, shape, image and page toolbars", async () => {
    const out = [];
    const has = async () => (await tb().getByRole("button", { name: "Animate" }).count()) > 0;
    out.push("text:" + (await has()));
    await page.keyboard.press("Escape");
    await page.mouse.click(1300, 700);
    out.push("page:" + (await has()));
    // the shape: click the circle in the middle of the page
    await page.mouse.click(925, 405);
    await wait(250);
    out.push("any:" + (await has()));
    if (out.some((x) => x.endsWith("false"))) throw new Error(out.join(" "));
    // an image
    await page.getByRole("tab", { name: "Elements", exact: true }).click();
    await page
      .getByRole("button", { name: "Back to all elements" })
      .click()
      .catch(() => {});
    await page.getByRole("button", { name: "Browse photos" }).click();
    await wait(800);
    await page.locator(".cf-ditem").first().click();
    await wait(700);
    out.push("image:" + (await has()));
    if (!(await has())) throw new Error(out.join(" "));
    await page.keyboard.press("Delete");
    return out.join(" ");
  });

  await step("choose Rise as an entrance; undo and redo it", async () => {
    // select the heading (last element) via the store so the test does not depend on pixel positions
    await page.evaluate(() => {
      const s = window.__editor.getState();
      const els = s.design.pages[0].elements;
      s.actions.select([els[els.length - 1].id]);
    });
    await tb().getByRole("button", { name: "Animate" }).click();
    await wait(500);
    await tile("rise", "in").click();
    await wait(300);
    let s = await S();
    const text = s.els[s.els.length - 1];
    if (!text.anim || text.anim.in?.kind !== "rise") throw new Error("not set: " + JSON.stringify(text.anim));
    if (!(await previewing())) throw new Error("the page did not start previewing");
    await shot("rise-preview");
    await page.keyboard.press("Escape"); // stops the preview first
    await wait(150);
    if (await previewing()) throw new Error("Esc did not stop the preview");
    await page.getByRole("button", { name: /^Undo/ }).first().click();
    s = await S();
    if (s.els[s.els.length - 1].anim) throw new Error("undo kept the animation");
    await page.getByRole("button", { name: /^Redo/ }).first().click();
    s = await S();
    if (s.els[s.els.length - 1].anim?.in?.kind !== "rise") throw new Error("redo lost the animation");
    return "rise set, previewed, undone and redone";
  });

  await step("direction, duration and delay settings change the animation", async () => {
    await page.getByRole("radio", { name: "Towards the left" }).click();
    let s = await S();
    let a = s.els[s.els.length - 1].anim.in;
    if (a.direction !== "left") throw new Error("direction " + a.direction);
    // sliders: focus the Duration slider's thumb and use the keyboard
    const sliders = page.locator(".cf-an__settings [role=slider]");
    const n = await sliders.count();
    if (n < 2) throw new Error("sliders: " + n);
    await sliders.nth(0).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await sliders.nth(1).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    s = await S();
    a = s.els[s.els.length - 1].anim.in;
    if (!(a.duration > 0.8) || !(a.delay > 0)) throw new Error(`duration ${a.duration} delay ${a.delay}`);
    return `duration ${a.duration}, delay ${a.delay}`;
  });

  await step("an exit and an emphasis join the entrance; remove them all", async () => {
    await tile("fade", "out").click();
    await tile("breathe", "loop").click();
    await wait(300);
    let s = await S();
    const keys = Object.keys(s.els[s.els.length - 1].anim || {})
      .sort()
      .join(",");
    if (keys !== "in,loop,out") throw new Error("phases " + keys);
    await page.getByRole("button", { name: "Remove all animations" }).click();
    await wait(200);
    s = await S();
    if (s.els[s.els.length - 1].anim) throw new Error("animation left: " + JSON.stringify(s.els[s.els.length - 1].anim));
    return "in,loop,out then none";
  });

  await step("page animation staggers every element; None removes it", async () => {
    await page.getByRole("tab", { name: "Page animations" }).click();
    await wait(300);
    await tile("pop").click();
    await wait(300);
    let s = await S();
    const kinds = s.els.map((e) => e.anim?.in?.kind);
    const delays = s.els.map((e) => e.anim?.in?.delay);
    if (!kinds.every((k) => k === "pop")) throw new Error("kinds " + kinds);
    if (!(delays[1] > delays[0])) throw new Error("not staggered " + delays);
    await page.locator(".cf-an__tile[data-kind='none']").first().click();
    await wait(200);
    s = await S();
    if (s.els.some((e) => e.anim)) throw new Error("animations left");
    return `pop, delays ${delays.join("/")}`;
  });

  await step("page duration slider and 'apply to all pages'", async () => {
    await page.getByRole("button", { name: "Add page", exact: true }).first().click();
    await wait(500);
    await page.evaluate(() => {
      const s = window.__editor.getState();
      s.actions.setActivePage(s.design.pages[0].id);
    });
    await wait(300);
    const dur = page
      .locator(".cf-ctx")
      .getByRole("slider", { name: /Page duration/ })
      .first();
    await dur.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    let s = await S();
    const first = s.pages[0].dur;
    if (!(first > 5)) throw new Error("duration " + first);
    await page.getByRole("checkbox", { name: "Apply to all pages" }).first().check();
    await dur.focus();
    await page.keyboard.press("ArrowRight");
    s = await S();
    if (s.pages[1].dur !== s.pages[0].dur) throw new Error("not applied to all: " + JSON.stringify(s.pages));
    await page.getByRole("checkbox", { name: "Apply to all pages" }).first().uncheck();
    return `durations ${s.pages.map((p) => p.dur).join("/")}`;
  });

  await step("transitions: choose, tune, apply to all, first page has none", async () => {
    await page.evaluate(() => {
      const s = window.__editor.getState();
      s.actions.setActivePage(s.design.pages[1].id);
    });
    await wait(500);
    await tile("t-push").click();
    await wait(300);
    let s = await S();
    if (s.pages[1].tr?.kind !== "push") throw new Error("transition " + JSON.stringify(s.pages[1].tr));
    await page.getByRole("radio", { name: "Upwards" }).click();
    s = await S();
    if (s.pages[1].tr.direction !== "up") throw new Error("direction " + s.pages[1].tr.direction);
    await shot("transition-panel");
    // first page: a note instead of the choices
    await page.evaluate(() => {
      const st = window.__editor.getState();
      st.actions.setActivePage(st.design.pages[0].id);
    });
    await wait(400);
    const note = await page.locator(".cf-an__note").last().innerText();
    if (!/first page/i.test(note)) throw new Error("note: " + note);
    return "push up on page 2; page 1 explains it has none";
  });

  await step("a preview of the whole page plays and ends by itself", async () => {
    await page.getByRole("button", { name: "Play the page" }).click();
    await wait(200);
    if (!(await previewing())) throw new Error("not previewing");
    const seconds = (await S()).pages[0].dur ?? 5;
    await wait((seconds + 1) * 1000);
    if (await previewing()) throw new Error("still previewing after the page's duration");
    return `ended after ${seconds} s`;
  });

  await step("animation, durations and transitions survive a reload", async () => {
    await page.evaluate(() => {
      const s = window.__editor.getState();
      const els = s.design.pages[0].elements;
      s.actions.setAnimation([els[els.length - 1].id], "in", { kind: "zoom", duration: 1.1, delay: 0.3 });
    });
    await wait(2800);
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(1200);
    const s = await S();
    const last = s.els[s.els.length - 1];
    if (last.anim?.in?.kind !== "zoom") throw new Error("animation lost: " + JSON.stringify(last.anim));
    if (s.pages[1].tr?.kind !== "push") throw new Error("transition lost: " + JSON.stringify(s.pages));
    return "zoom + push kept";
  });

  await step("templates ship with motion: a deck has transitions and staggered entrances", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(800);
    await page.getByRole("tab", { name: "Templates", exact: true }).click();
    await wait(1200);
    await page.locator(".cf-ditem").first().click();
    await page.getByRole("button", { name: /Apply all \d+ pages/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Apply all|Replace/ })
      .click()
      .catch(() => {});
    await wait(2500);
    const s = await S();
    const withTransition = s.pages.filter((p) => p.tr).length;
    const animated = await page.evaluate(() => window.__editor.getState().design.pages.filter((p) => p.elements.some((e) => e.animation)).length);
    if (s.pages.length < 5 || withTransition < 4 || animated < 4) throw new Error(`pages ${s.pages.length}, transitions ${withTransition}, animated pages ${animated}`);
    return `${s.pages.length} pages, ${withTransition} transitions, ${animated} animated pages`;
  });

  console.log(results.join("\n"));
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.log("E2E CRASH", e);
  process.exit(1);
});
