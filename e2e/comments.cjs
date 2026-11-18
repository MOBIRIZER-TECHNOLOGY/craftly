/*
 * Comments, as a person leaves them in a real browser: the Comment tool is the last tool of the Tools palette, and choosing it there
 * (or pressing M) and clicking the page places a pin with a small editor; Enter posts the note, Post posts it too, and Esc takes
 * the pin away again. A pin placed on a shape belongs to it: dragging the shape with the mouse takes the pin along on the screen.
 * The Comments button of the top bar carries the number of open comments and opens the panel, which lists the threads; a reply is
 * added there, one's own comment is edited, and Delete asks first with the keyboard on Keep (Enter on Keep keeps) before it
 * deletes. Resolve hides the pin and lowers the number, "Show resolved pins" shows it again, and Reopen brings it back. Undo after
 * posting takes back the step before it (the drag) and never the comment. Text written like markup is shown as text, and nothing
 * in it runs (no dialog, no element made of it). A PNG download has no pin drawn in it (read from its pixels at each pin), and
 * Present shows no pin either. After a reload the comments, their replies, the edit and the resolved state are all there.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("comments");
const results = [];
const logs = [];
const dialogs = [];
let shotN = 0;

const BLUE = "#1f4fd8";
const WHITE = "#ffffff";
const MARKUP = "<b>x</b><img src=x onerror=alert(1)>";

/* where things are on the page, in design px */
const SHAPE = { x: 1100, y: 350, width: 500, height: 300 };
const EMPTY_SPOT = [300, 250];
const ON_SHAPE = [1200, 420]; // inside the shape, away from its middle, so that the drag below starts on the shape and not on the pin
const CANCELLED_SPOT = [600, 800];
const UNDO_SPOT = [1600, 150];
const MARKUP_SPOT = [300, 650];
const DRAG_FROM = [1450, 580];
const DRAG_BY = [-400, 250];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  page.on("dialog", (d) => {
    dialogs.push(d.type() + ": " + d.message());
    d.dismiss().catch(() => undefined);
  });
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

  /** the comments of the design, the tool and what is saved */
  const state = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return {
        tool: s.tool,
        saveState: s.saveState,
        past: s.past.length,
        width: s.design.width,
        height: s.design.height,
        els: pg.elements.map((e) => ({ id: e.id, x: e.x, y: e.y })),
        comments: (s.design.comments ?? []).map((c) => ({
          id: c.id,
          text: c.text,
          anchor: c.anchor,
          resolved: c.resolved,
          edited: c.editedAt !== undefined,
          author: c.author.name,
          replies: c.replies.map((r) => r.text),
        })),
      };
    });
  const comments = async () => (await state()).comments;

  /** empties the page, makes it white and puts one blue box on it; gives its id */
  const setUp = () =>
    page.evaluate(
      ({ BLUE, WHITE, SHAPE }) => {
        const { actions } = window.__editor.getState();
        actions.selectAll();
        actions.deleteElements();
        actions.setPageBackground({ type: "solid", color: WHITE });
        const [id] = actions.addElements(
          [{ id: "x", type: "shape", shape: "rect", ...SHAPE, rotation: 0, opacity: 1, fill: { type: "solid", color: BLUE }, stroke: null, radius: 0 }],
          { center: false, select: false },
        );
        actions.clearSelection();
        return id;
      },
      { BLUE, WHITE, SHAPE },
    );

  /** where a point of the page (design px) is on the screen */
  const screenAt = async (x, y) => {
    const box = await page.locator(".cf-pageframe").boundingBox();
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    return [box.x + x * zoom, box.y + y * zoom];
  };
  const click = async (x, y) => {
    const [sx, sy] = await screenAt(x, y);
    await page.mouse.click(sx, sy);
    await wait(250);
  };
  const drag = async (from, to) => {
    const [fx, fy] = await screenAt(...from);
    const [tx, ty] = await screenAt(...to);
    await page.mouse.move(fx, fy);
    await page.mouse.down();
    await page.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 8 });
    await page.mouse.move(tx, ty, { steps: 8 });
    await page.mouse.up();
    await wait(400);
  };

  const pins = () => page.locator(".cf-comment-pin[data-comment-id]");
  const pinOf = (id) => page.locator(`.cf-comment-pin[data-comment-id="${id}"]`);
  /** the middle of a pin on the screen */
  const pinAt = async (id) => {
    const b = await pinOf(id).boundingBox();
    if (!b) throw new Error("no pin for " + id);
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const draftBox = () => page.getByRole("textbox", { name: "Comment", exact: true });
  const commentsButton = () => page.locator("[data-cf-comments-button]");
  const panel = () => page.getByRole("complementary", { name: "Comments" });
  const thread = (n) =>
    panel()
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { level: 4, name: new RegExp("^Comment " + n + "(?!\\d)") }) });
  const openPanel = async () => {
    if (!(await panel().count())) await commentsButton().click();
    await panel().waitFor({ timeout: 10000 });
    await wait(200);
  };
  const closePanel = async () => {
    if (await panel().count()) await panel().getByRole("button", { name: "Close comments" }).click();
    await wait(200);
  };
  const focusedText = () => page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim());
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
  /** the tool back to Select, from the canvas (Esc, as a person does it) */
  const putToolDown = async () => {
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Escape");
    await wait(200);
    const { tool } = await state();
    if (tool !== "select") throw new Error("Esc left the tool at " + tool);
  };
  /** places a pin with the Comment tool (pressing M) and posts it with Enter; gives the new comment */
  const postWithKey = async (spot, text) => {
    const before = (await comments()).length;
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("m");
    await click(...spot);
    await draftBox().waitFor({ timeout: 10000 });
    await draftBox().fill(text);
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => (window.__editor.getState().design.comments ?? []).length === n, before + 1, { timeout: 10000 });
    await wait(200);
    return (await comments())[before];
  };

  /** the pixels of a PNG (bytes), read in the page: for each point (a fraction of its width and height), the colour farthest from `expected` within `r` px */
  const worstAround = (bytes, points, r = 5) =>
    page.evaluate(
      async ({ bytes, points, r }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        return {
          size: [bitmap.width, bitmap.height],
          points: points.map(([fx, fy, expected]) => {
            const want = hex(expected);
            const cx = Math.round(fx * bitmap.width);
            const cy = Math.round(fy * bitmap.height);
            const d = g.getImageData(cx - r, cy - r, 2 * r + 1, 2 * r + 1).data;
            let worst = 0;
            for (let i = 0; i < d.length; i += 4) worst = Math.max(worst, Math.abs(d[i] - want[0]) + Math.abs(d[i + 1] - want[1]) + Math.abs(d[i + 2] - want[2]));
            return worst;
          }),
        };
      },
      { bytes: Array.from(bytes), points, r },
    );

  /* ---------------- a new design ---------------- */
  let shapeId = "";
  let W = 0;
  let H = 0;
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
    shapeId = await setUp();
    ({ width: W, height: H } = await state());
    const n = (await comments()).length;
    if (n) throw new Error("a new design with " + n + " comments");
    return `${W} x ${H}, one box ${shapeId}, no comments`;
  });

  /* ---------------- placing pins ---------------- */
  let c1 = null;
  await step("the Comment tool is the last tool of the Tools palette, and choosing it there sets it", async () => {
    await page.getByRole("tab", { name: "Tools", exact: true }).click();
    const palette = page.getByRole("toolbar", { name: "Tools" });
    await palette.waitFor({ timeout: 10000 });
    const last = await palette.evaluate((el) => {
      const tools = Array.from(el.querySelectorAll("button")).filter((b) => b.closest(".cf-tools__card"));
      return tools.at(-1)?.getAttribute("aria-label");
    });
    if (last !== "Comment") throw new Error("the last tool is " + last);
    await palette.getByRole("button", { name: "Comment", exact: true }).click();
    await wait(300);
    const { tool } = await state();
    if (tool !== "comment") throw new Error("the tool is " + tool);
    return "last, chosen";
  });

  await step("a click on an empty spot places a pin with an editor that takes the keyboard; Enter posts it and the keyboard goes to the pin", async () => {
    await click(...EMPTY_SPOT);
    await draftBox().waitFor({ timeout: 10000 });
    if (!(await draftBox().evaluate((el) => el === document.activeElement))) throw new Error("the editor does not have the keyboard");
    await shot("draft");
    await page.keyboard.type("Make the heading bigger");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (window.__editor.getState().design.comments ?? []).length === 1, null, { timeout: 10000 });
    await wait(300);
    c1 = (await comments())[0];
    if (c1.text !== "Make the heading bigger" || c1.author !== "You") throw new Error(JSON.stringify(c1));
    if (c1.anchor.elementId) throw new Error("the pin on an empty spot is on " + c1.anchor.elementId);
    if (!near(c1.anchor.x, EMPTY_SPOT[0], 3) || !near(c1.anchor.y, EMPTY_SPOT[1], 3)) throw new Error("the pin is at " + JSON.stringify(c1.anchor));
    if (await draftBox().count()) throw new Error("the editor is still open");
    const pin = page.getByRole("button", { name: "Comment 1 by You: Make the heading bigger", exact: true });
    await pin.waitFor({ timeout: 5000 });
    if (!(await pin.evaluate((el) => el === document.activeElement))) throw new Error("the keyboard is on " + (await focusedText()));
    // the pin is drawn where the page was clicked
    const [px, py] = await pinAt(c1.id);
    const [sx, sy] = await screenAt(...EMPTY_SPOT);
    if (!near(px, sx, 3) || !near(py, sy, 3)) throw new Error(`the pin is at ${px}, ${py}, the click at ${sx}, ${sy}`);
    return `at ${Math.round(c1.anchor.x)}, ${Math.round(c1.anchor.y)}, named "Comment 1 by You: …", focused`;
  });

  let c2 = null;
  await step("with M, a click on the shape places a pin on it, and the Post button posts it", async () => {
    await putToolDown();
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("m");
    await wait(200);
    if ((await state()).tool !== "comment") throw new Error("M did not choose the Comment tool");
    await click(...ON_SHAPE);
    await draftBox().waitFor({ timeout: 10000 });
    const post = page.getByRole("form", { name: "New comment" }).getByRole("button", { name: "Post", exact: true });
    if (!(await post.isDisabled())) throw new Error("Post is offered for an empty comment");
    await page.keyboard.type("Is this blue right?");
    await post.click();
    await page.waitForFunction(() => (window.__editor.getState().design.comments ?? []).length === 2, null, { timeout: 10000 });
    await wait(300);
    c2 = (await comments())[1];
    if (c2.anchor.elementId !== shapeId) throw new Error("the pin is not on the shape: " + JSON.stringify(c2.anchor));
    if (!near(c2.anchor.dx, ON_SHAPE[0] - SHAPE.x, 3) || !near(c2.anchor.dy, ON_SHAPE[1] - SHAPE.y, 3)) throw new Error("its place on the shape is " + JSON.stringify(c2.anchor));
    await page.getByRole("button", { name: "Comment 2 by You: Is this blue right?", exact: true }).waitFor({ timeout: 5000 });
    return `on ${shapeId} at +${Math.round(c2.anchor.dx)}, +${Math.round(c2.anchor.dy)}`;
  });

  await step("Esc in the editor of a third pin takes it away: no comment, no pin, the keyboard back on the canvas; Cancel does the same", async () => {
    await click(...CANCELLED_SPOT);
    await draftBox().waitFor({ timeout: 10000 });
    await page.keyboard.type("Never mind");
    await page.keyboard.press("Escape");
    await wait(300);
    if (await draftBox().count()) throw new Error("the editor is still open after Esc");
    if (await page.locator(".cf-comment-draft").count()) throw new Error("the pin being placed is still there");
    let s = await state();
    if (s.comments.length !== 2) throw new Error(s.comments.length + " comments");
    if ((await pins().count()) !== 2) throw new Error((await pins().count()) + " pins");
    const onCanvas = await page.evaluate(() => !!document.activeElement?.closest("[data-cf-workspace]"));
    if (!onCanvas) throw new Error("the keyboard is on " + (await focusedText()));
    // and with the Cancel button
    await click(...CANCELLED_SPOT);
    await draftBox().waitFor({ timeout: 10000 });
    await page.keyboard.type("Not this either");
    await page.getByRole("form", { name: "New comment" }).getByRole("button", { name: "Cancel", exact: true }).click();
    await wait(300);
    s = await state();
    if ((await draftBox().count()) || s.comments.length !== 2 || (await pins().count()) !== 2) throw new Error("Cancel left " + s.comments.length + " comments");
    await putToolDown();
    return "2 comments, 2 pins";
  });

  /* ---------------- the button and the panel ---------------- */
  await step("the Comments button says how many are open, and opens the panel with the threads of this page", async () => {
    const name = await commentsButton().getAttribute("aria-label");
    const badge = (await commentsButton().locator(".cf-comments-button__badge").textContent())?.trim();
    if (name !== "Comments, 2 open" || badge !== "2") throw new Error(`the button says "${name}", its badge "${badge}"`);
    await commentsButton().click();
    await panel().waitFor({ timeout: 10000 });
    if ((await commentsButton().getAttribute("aria-pressed")) !== "true") throw new Error("the button is not pressed");
    const sections = await panel().getByRole("heading", { level: 3 }).allTextContents();
    if (sections[0] !== "On this page") throw new Error("sections " + JSON.stringify(sections));
    const titles = await panel().getByRole("article").getByRole("heading", { level: 4 }).allTextContents();
    if (JSON.stringify(titles) !== JSON.stringify(["Comment 1", "Comment 2"])) throw new Error("threads " + JSON.stringify(titles));
    const texts = await panel().locator(".cf-comment__text").allTextContents();
    if (texts[0] !== "Make the heading bigger" || texts[1] !== "Is this blue right?") throw new Error("texts " + JSON.stringify(texts));
    await shot("panel");
    return `"${name}", ${titles.length} threads`;
  });

  /* ---------------- reply, edit, delete ---------------- */
  await step("replies are added from the box of a thread with Enter", async () => {
    const box = thread(1).getByRole("textbox", { name: "Reply to comment 1 by You" });
    await box.click();
    await page.keyboard.type("On it");
    await page.keyboard.press("Enter");
    await wait(300);
    await box.click();
    await page.keyboard.type("Remove me later");
    await thread(1).getByRole("button", { name: "Reply", exact: true }).click();
    await wait(300);
    const c = (await comments())[0];
    if (JSON.stringify(c.replies) !== JSON.stringify(["On it", "Remove me later"])) throw new Error("replies " + JSON.stringify(c.replies));
    const shown = await panel().getByRole("list", { name: "Replies to comment 1" }).textContent();
    if (!shown.includes("On it") || !shown.includes("Remove me later")) throw new Error("the panel shows " + shown);
    if (await box.inputValue()) throw new Error("the reply box was not emptied");
    return "2 replies";
  });

  await step("Edit changes one's own comment: the box takes the keyboard, Enter saves, and it says (edited)", async () => {
    await thread(1).getByRole("button", { name: "Edit comment", exact: true }).click();
    const box = panel().getByRole("textbox", { name: "Edit your comment" });
    await box.waitFor({ timeout: 5000 });
    if (!(await box.evaluate((el) => el === document.activeElement))) throw new Error("the keyboard is on " + (await focusedText()));
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Make the heading much bigger");
    await page.keyboard.press("Enter");
    await wait(300);
    const c = (await comments())[0];
    if (c.text !== "Make the heading much bigger" || !c.edited) throw new Error(JSON.stringify(c));
    if (!(await thread(1).getByText("(edited)", { exact: true }).count())) throw new Error("no (edited)");
    await page.getByRole("button", { name: "Comment 1 by You: Make the heading much bigger", exact: true }).waitFor({ timeout: 5000 });
    return "edited, the pin's name too";
  });

  await step("Delete asks first with the keyboard on Keep; Enter on Keep keeps; Delete then deletes", async () => {
    const del = () => thread(1).getByRole("button", { name: "Delete reply", exact: true }).nth(1);
    await del().click();
    const ask = panel().getByRole("group", { name: "Delete this reply" });
    await ask.waitFor({ timeout: 5000 });
    const question = await ask.textContent();
    if (!question.includes("This cannot be undone")) throw new Error("it asks " + question);
    const keep = ask.getByRole("button", { name: "Keep", exact: true });
    if (!(await keep.evaluate((el) => el === document.activeElement))) throw new Error("the keyboard is on " + (await focusedText()));
    await shot("delete-asks");
    await page.keyboard.press("Enter");
    await wait(300);
    if ((await comments())[0].replies.length !== 2) throw new Error("Enter on Keep deleted the reply");
    if (await ask.count()) throw new Error("the question is still there after Keep");
    await del().click();
    await panel().getByRole("group", { name: "Delete this reply" }).getByRole("button", { name: "Delete", exact: true }).click();
    await wait(300);
    const replies = (await comments())[0].replies;
    if (JSON.stringify(replies) !== JSON.stringify(["On it"])) throw new Error("replies " + JSON.stringify(replies));
    return "kept, then deleted: 1 reply left";
  });

  /* ---------------- resolve ---------------- */
  await step("Resolve hides the pin and lowers the number; Show resolved pins shows it; Reopen brings it back", async () => {
    await thread(1).getByRole("button", { name: "Resolve", exact: true }).click();
    await wait(400);
    if (!(await comments())[0].resolved) throw new Error("not resolved");
    if ((await commentsButton().getAttribute("aria-label")) !== "Comments, 1 open") throw new Error("the button says " + (await commentsButton().getAttribute("aria-label")));
    if (await pinOf(c1.id).count()) throw new Error("the resolved pin is still shown");
    if ((await pins().count()) !== 1) throw new Error((await pins().count()) + " pins");
    // the Open filter no longer lists it
    if (await thread(1).count()) throw new Error("the Open filter lists the resolved thread");
    await panel().getByRole("checkbox", { name: "Show resolved pins on the page" }).check();
    await wait(300);
    const shown = page.getByRole("button", { name: "Comment 1 by You: Make the heading much bigger (resolved)", exact: true });
    if (!(await shown.count())) throw new Error("Show resolved pins does not show it");
    await shot("resolved-shown");
    await panel().getByRole("checkbox", { name: "Show resolved pins on the page" }).uncheck();
    await wait(300);
    if (await pinOf(c1.id).count()) throw new Error("unchecked, the pin is still shown");
    await panel().getByRole("radio", { name: "Resolved", exact: true }).check();
    await wait(300);
    const listed = await panel().getByRole("article").getByRole("heading", { level: 4 }).allTextContents();
    if (listed.length !== 1 || !listed[0].startsWith("Comment 1")) throw new Error("Resolved lists " + JSON.stringify(listed));
    await thread(1).getByRole("button", { name: "Reopen", exact: true }).click();
    await wait(400);
    if ((await comments())[0].resolved) throw new Error("not reopened");
    if ((await commentsButton().getAttribute("aria-label")) !== "Comments, 2 open") throw new Error("the button says " + (await commentsButton().getAttribute("aria-label")));
    if (!(await pinOf(c1.id).count())) throw new Error("the reopened pin is not shown");
    await panel().getByRole("radio", { name: "All", exact: true }).check();
    await wait(200);
    return "2 -> 1 -> 2 open";
  });

  /* ---------------- the pin follows its shape ---------------- */
  await step("dragging the shape with the mouse takes its pin along on the screen; the other pin stays", async () => {
    await closePanel();
    await putToolDown();
    await wait(300);
    const zoom = await page.evaluate(() => window.__editor.getState().zoom);
    const [ax, ay] = await pinAt(c2.id);
    const [ox, oy] = await pinAt(c1.id);
    await drag(DRAG_FROM, [DRAG_FROM[0] + DRAG_BY[0], DRAG_FROM[1] + DRAG_BY[1]]);
    const s = await state();
    const box = s.els.find((e) => e.id === shapeId);
    if (!near(box.x, SHAPE.x + DRAG_BY[0], 12) || !near(box.y, SHAPE.y + DRAG_BY[1], 12)) throw new Error(`the shape is at ${box.x}, ${box.y}`);
    const [bx, by] = await pinAt(c2.id);
    const want = [(box.x - SHAPE.x) * zoom, (box.y - SHAPE.y) * zoom];
    if (!near(bx - ax, want[0], 3) || !near(by - ay, want[1], 3))
      throw new Error(`the pin moved ${Math.round(bx - ax)}, ${Math.round(by - ay)}; the shape ${Math.round(want[0])}, ${Math.round(want[1])}`);
    const [px, py] = await pinAt(c1.id);
    if (!near(px, ox, 1) || !near(py, oy, 1)) throw new Error("the other pin moved");
    await shot("dragged");
    return `shape and pin moved ${Math.round(bx - ax)}, ${Math.round(by - ay)} screen px`;
  });

  /* ---------------- undo ---------------- */
  let c3 = null;
  await step("Ctrl+Z right after posting takes back the drag, not the comment, and the pin goes back with its shape", async () => {
    const before = await state();
    c3 = await postWithKey(UNDO_SPOT, "Undo must leave me");
    const after = await state();
    if (after.past !== before.past) throw new Error(`posting made a step of undo (${before.past} -> ${after.past})`);
    // the keyboard is on the new pin, as after any post; Ctrl+Z from there
    await page.keyboard.press("Control+z");
    await wait(500);
    const s = await state();
    if (s.comments.length !== 3 || !s.comments.find((c) => c.id === c3.id)) throw new Error("undo took the comment: " + s.comments.length + " comments");
    const box = s.els.find((e) => e.id === shapeId);
    if (!near(box.x, SHAPE.x, 1) || !near(box.y, SHAPE.y, 1)) throw new Error(`undo did not take the drag back: the shape is at ${box.x}, ${box.y}`);
    const [px, py] = await pinAt(c2.id);
    const [sx, sy] = await screenAt(...ON_SHAPE);
    if (!near(px, sx, 3) || !near(py, sy, 3)) throw new Error("the pin did not go back with its shape");
    if (!(await pinOf(c3.id).count())) throw new Error("the new pin is gone");
    // redo moves the shape again, and undo takes it back again: the comments stay as they are each time
    await page.keyboard.press("Control+Shift+z");
    await wait(300);
    let mid = await state();
    if (mid.comments.length !== 3 || !near(mid.els.find((e) => e.id === shapeId).x, SHAPE.x + DRAG_BY[0], 12)) throw new Error("redo: " + mid.comments.length + " comments");
    await page.keyboard.press("Control+z");
    await wait(300);
    mid = await state();
    const shape = mid.els.find((e) => e.id === shapeId);
    if (mid.comments.length !== 3 || !near(shape.x, SHAPE.x, 1)) throw new Error("undo again: " + mid.comments.length + " comments, the shape at " + shape.x);
    if (mid.comments[1].anchor.elementId !== shapeId) throw new Error("the pin left its shape: " + JSON.stringify(mid.comments[1].anchor));
    return "3 comments after undo, redo and undo; the pin still on its shape";
  });

  await step("a whole comment is deleted from the panel after asking, and the number goes down", async () => {
    await putToolDown();
    await openPanel();
    const t = thread(3);
    await t.getByRole("button", { name: "Delete comment", exact: true }).click();
    const ask = panel().getByRole("group", { name: "Delete this comment" });
    await ask.waitFor({ timeout: 5000 });
    if (!(await ask.getByRole("button", { name: "Keep", exact: true }).evaluate((el) => el === document.activeElement)))
      throw new Error("the keyboard is on " + (await focusedText()));
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await wait(400);
    const s = await state();
    if (s.comments.length !== 2 || s.comments.find((c) => c.id === c3.id)) throw new Error(s.comments.length + " comments");
    if (await pinOf(c3.id).count()) throw new Error("its pin is still there");
    if ((await commentsButton().getAttribute("aria-label")) !== "Comments, 2 open") throw new Error("the button says " + (await commentsButton().getAttribute("aria-label")));
    await closePanel();
    return "2 left";
  });

  /* ---------------- the panel beside the page ---------------- */
  await step("the panel is a column beside the page: the workspace and every control of the bottom bar stay uncovered, and the Share popover opens over it", async () => {
    await putToolDown();
    await openPanel();
    await wait(400);
    const geometry = await page.evaluate(() => {
      const rect = (el) => el && el.getBoundingClientRect();
      const panelEl = document.querySelector(".cf-comments-panel");
      const p = rect(panelEl);
      const ws = rect(document.querySelector(".cf-workspace"));
      const bar = rect(document.querySelector(".cf-bottombar"));
      // every control of the bottom bar is the topmost thing at its own middle
      const covered = [...document.querySelectorAll(".cf-bottombar button, .cf-bottombar input, .cf-bottombar [role=slider]")]
        .filter((el) => el.getClientRects().length)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !top || !(el === top || el.contains(top));
        })
        .map((el) => el.getAttribute("aria-label") || el.textContent.trim());
      const controls = document.querySelectorAll(".cf-bottombar button").length;
      return { panel: [p.left, p.right], workspaceRight: ws.right, barRight: bar.right, covered, controls, inMain: !!panelEl.closest("main") };
    });
    if (geometry.inMain) throw new Error("the panel is inside the page area");
    if (geometry.workspaceRight > geometry.panel[0] + 1) throw new Error(`the workspace runs under the panel (${geometry.workspaceRight} > ${geometry.panel[0]})`);
    if (geometry.barRight > geometry.panel[0] + 1) throw new Error(`the bottom bar runs under the panel (${geometry.barRight} > ${geometry.panel[0]})`);
    if (geometry.covered.length) throw new Error("covered controls of the bottom bar: " + JSON.stringify(geometry.covered));
    // the zoom, Pages and full-screen controls can be used with the panel open
    await page.locator(".cf-bottombar__zoombtn").click();
    await page.getByRole("menu", { name: "Zoom" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await wait(200);
    if (!(await panel().count())) throw new Error("the Esc that closed the zoom menu closed the panel too");
    // the Share popover is over the panel where they meet
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    const pop = page.locator(".cf-popover").filter({ hasText: "Share design" }).first();
    await pop.waitFor({ timeout: 5000 });
    await wait(300);
    const onTop = await pop.evaluate((el) => {
      const panelBox = document.querySelector(".cf-comments-panel").getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const x = Math.max(r.left, panelBox.left) + 20;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { overlaps: r.right > panelBox.left, top: !!top && el.contains(top) };
    });
    await shot("panel-and-share");
    if (onTop.overlaps && !onTop.top) throw new Error("the Share popover is under the Comments panel");
    await page.keyboard.press("Escape");
    await pop.waitFor({ state: "detached", timeout: 5000 });
    if (!(await panel().count())) throw new Error("the Esc that closed Share closed the panel too");
    return `panel ${Math.round(geometry.panel[0])}-${Math.round(geometry.panel[1])} px, workspace to ${Math.round(geometry.workspaceRight)}, ${geometry.controls} bottom-bar controls uncovered, Share over the panel`;
  });

  await step("Esc closes the panel from outside it (the Share button, the canvas); a draft pin with the keyboard takes Esc first", async () => {
    // the keyboard was given back to the Share button: Esc from there
    await page.keyboard.press("Escape");
    await wait(200);
    if (await panel().count()) throw new Error("Esc from the top bar left the panel open");
    // a pin being placed: its Esc cancels it, the panel stays; the next Esc puts the tool down, the one after closes the panel
    await openPanel();
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("m");
    await click(...MARKUP_SPOT);
    await draftBox().waitFor({ timeout: 10000 });
    await page.keyboard.type("Never posted");
    await page.keyboard.press("Escape");
    await wait(200);
    if (await draftBox().count()) throw new Error("Esc left the draft");
    if (!(await panel().count())) throw new Error("the Esc of the draft closed the panel");
    await putToolDown();
    if (!(await panel().count())) throw new Error("the Esc that put the tool down closed the panel");
    await page.locator(".cf-workspace").focus();
    await page.keyboard.press("Escape");
    await wait(200);
    if (await panel().count()) throw new Error("Esc on the canvas left the panel open");
    if ((await comments()).length !== 2) throw new Error((await comments()).length + " comments");
    return "closed from the top bar and from the canvas, after the draft and the tool";
  });

  await step("the panel starts closed when the design is opened again after going to Home", async () => {
    await openPanel();
    const url = page.url();
    await page
      .getByRole("button", { name: /^(Home|Back to home)/ })
      .first()
      .click();
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page.goto(url);
    await page.locator(".cf-workspace").waitFor({ timeout: 30000 });
    await wait(800);
    if (await panel().count()) throw new Error("the panel is open again");
    if ((await comments()).length !== 2) throw new Error((await comments()).length + " comments after coming back");
    return "closed";
  });

  /* ---------------- markup is text ---------------- */
  let c4 = null;
  await step("text written like markup is shown as text in the pin's name and the panel, and nothing in it runs", async () => {
    c4 = await postWithKey(MARKUP_SPOT, MARKUP);
    if (c4.text !== MARKUP) throw new Error("kept as " + c4.text);
    await putToolDown();
    await openPanel();
    await wait(1500); // time for an image that should never exist to fail and run its onerror
    const label = await pinOf(c4.id).getAttribute("aria-label");
    if (!label.includes("<b>x</b><img src=x")) throw new Error("the pin is named " + label);
    const t = thread(3);
    const text = await t.locator(".cf-comment__text").first().textContent();
    if (text !== MARKUP) throw new Error("the panel shows " + text);
    const made = await page.evaluate(() => document.querySelectorAll(".cf-comments-layer img, .cf-comments-layer b, .cf-comments-panel img, .cf-comments-panel b").length);
    if (made) throw new Error(made + " elements were made of the text");
    if (dialogs.length) throw new Error("a dialog opened: " + dialogs.join(" | "));
    await shot("markup");
    await closePanel();
    return "as text, no element, no dialog";
  });

  /* ---------------- downloads and Present ---------------- */
  const pinPoints = () => [
    [EMPTY_SPOT[0] / W, EMPTY_SPOT[1] / H, WHITE],
    [ON_SHAPE[0] / W, ON_SHAPE[1] / H, BLUE],
    [MARKUP_SPOT[0] / W, MARKUP_SPOT[1] / H, WHITE],
  ];
  await step("a PNG download has no pin in it: the page's own colours where each pin is", async () => {
    await page.evaluate(() => window.__editor.getState().actions.clearSelection());
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await wait(800);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.locator(".cf-dl").getByRole("button", { name: "Download", exact: true }).click()]);
    const buf = fs.readFileSync(await dl.path());
    const name = dl.suggestedFilename();
    await page.keyboard.press("Escape");
    await wait(400);
    if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || !name.endsWith(".png")) throw new Error(`not a png: ${name} ${buf.length}`);
    fs.writeFileSync(OUT + "download.png", buf);
    const read = await worstAround(buf, pinPoints());
    // and the check can see a pin: the box's edge next to the white page is found as "not white"
    const edge = await worstAround(buf, [[SHAPE.x / W, (SHAPE.y + 100) / H, WHITE]]);
    if (edge.points[0] < 200) throw new Error("the pixel check cannot tell colours apart: " + edge.points[0]);
    const bad = read.points.map((d, i) => (d > 30 ? i + 1 : 0)).filter(Boolean);
    if (bad.length) throw new Error("something is drawn at pin " + bad.join(", ") + ": " + JSON.stringify(read.points));
    return `${name} ${read.size.join(" x ")}, differences at the pins ${read.points.join(", ")}`;
  });

  await step("Present shows no pin: none in the page, and the slide's own colours where they are", async () => {
    await page
      .getByRole("button", { name: /^Present$/ })
      .first()
      .click();
    await page.locator(".cf-present").waitFor({ timeout: 15000 });
    // the first frame is painted when the corner is white
    const px = (fx, fy) =>
      page.evaluate(
        ([x, y]) => {
          const c = document.querySelector("canvas.cf-present__page");
          if (!c || !c.width) return null;
          const d = c.getContext("2d").getImageData(Math.min(c.width - 1, Math.floor(c.width * x)), Math.min(c.height - 1, Math.floor(c.height * y)), 1, 1).data;
          return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        },
        [fx, fy],
      );
    const t0 = Date.now();
    while (!((await px(0.03, 0.03)) === WHITE && (await px(ON_SHAPE[0] / W, ON_SHAPE[1] / H)) === BLUE)) {
      if (Date.now() - t0 > 15000) throw new Error("the slide was never painted");
      await wait(100);
    }
    await wait(500);
    await shot("present");
    const inDom = await page.locator(".cf-comment-pin").count();
    if (inDom) throw new Error(inDom + " pins in the page while presenting");
    const seen = [];
    for (const [fx, fy, want] of pinPoints()) {
      const got = await px(fx, fy);
      seen.push(got);
      if (got !== want) throw new Error(`at ${fx.toFixed(3)}, ${fy.toFixed(3)} the show has ${got}, the slide ${want}`);
    }
    await page.keyboard.press("Escape");
    await page.locator(".cf-present").waitFor({ state: "detached", timeout: 15000 });
    await wait(500);
    if ((await pins().count()) !== 3) throw new Error("after the show " + (await pins().count()) + " pins");
    return "no pin; " + seen.join(", ");
  });

  /* ---------------- reload ---------------- */
  await step("after a reload the comments, the reply, the edit and the resolved state are there", async () => {
    // the first comment resolved again, from the panel, so that a resolved one is kept too
    await openPanel();
    await panel().getByRole("radio", { name: "All", exact: true }).check();
    await thread(1).getByRole("button", { name: "Resolve", exact: true }).click();
    await wait(300);
    await closePanel();
    await page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 30000 });
    const before = await comments();
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 30000 });
    await wait(1500);
    const after = await comments();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("before " + JSON.stringify(before).slice(0, 120) + " after " + JSON.stringify(after).slice(0, 120));
    const [one, two, three] = after;
    if (!one.resolved || !one.edited || JSON.stringify(one.replies) !== JSON.stringify(["On it"])) throw new Error("the first comment came back as " + JSON.stringify(one));
    if (two.anchor.elementId !== shapeId || two.resolved) throw new Error("the second came back as " + JSON.stringify(two));
    if (three.text !== MARKUP) throw new Error("the third came back as " + JSON.stringify(three));
    await commentsButton().waitFor({ timeout: 10000 });
    if ((await commentsButton().getAttribute("aria-label")) !== "Comments, 2 open") throw new Error("the button says " + (await commentsButton().getAttribute("aria-label")));
    const shown = await pins().evaluateAll((els) => els.map((e) => e.getAttribute("data-comment-id")));
    if (shown.length !== 2 || shown.includes(one.id)) throw new Error("pins " + JSON.stringify(shown));
    await openPanel();
    await panel().getByRole("radio", { name: "All", exact: true }).check();
    await wait(300);
    const listed = await panel().getByRole("article").getByRole("heading", { level: 4 }).allTextContents();
    if (listed.length !== 3 || !/^Comment 1.*\(resolved\)/.test(listed[0])) throw new Error("the panel lists " + JSON.stringify(listed));
    if (!(await panel().getByRole("list", { name: "Replies to comment 1" }).textContent()).includes("On it")) throw new Error("the reply is not shown");
    if (!(await thread(1).getByText("(edited)", { exact: true }).count())) throw new Error("(edited) is not shown");
    await shot("reloaded");
    return `${after.length} comments, 1 resolved, 1 reply, 2 pins`;
  });

  /* ---------------- undo and redo of the element a pin is on ---------------- */
  await step("a shape that undo (or Delete) takes away and redo (or undo) brings back has its pin on it again", async () => {
    await closePanel();
    await putToolDown();
    // a new box from the keyboard (R, one step of undo), and a pin on it
    await page.keyboard.press("r");
    await wait(400);
    const made = await state();
    const box = made.els[made.els.length - 1];
    const spot = [box.x + 40, box.y + 40];
    const c = await postWithKey(spot, "On the new box");
    if (c.anchor.elementId !== box.id) throw new Error("the pin is not on the new box: " + JSON.stringify(c.anchor));
    const [sx, sy] = await pinAt(c.id);
    await page.keyboard.press("Control+z"); // takes the box away
    await wait(400);
    let s = await state();
    if (s.els.some((e) => e.id === box.id)) throw new Error("undo did not take the box away");
    const [ux, uy] = await pinAt(c.id);
    if (!near(ux, sx, 2) || !near(uy, sy, 2)) throw new Error("without its box the pin moved");
    await page.keyboard.press("Control+Shift+z"); // brings it back
    await wait(400);
    s = await state();
    if (!s.els.some((e) => e.id === box.id)) throw new Error("redo did not bring the box back");
    const lost = [];
    const back = s.comments.find((x) => x.id === c.id);
    if (back.anchor.elementId !== box.id) lost.push("after undo and redo of the box's making: " + JSON.stringify(back.anchor));
    // and the same with the Delete key and one undo, as a person takes back a deletion
    const other = (await comments()).find((x) => x.anchor.elementId === shapeId);
    if (!other) throw new Error("no comment is on the first box any more");
    await putToolDown();
    await click(SHAPE.x + SHAPE.width - 40, SHAPE.y + SHAPE.height - 40);
    if (JSON.stringify(await page.evaluate(() => window.__editor.getState().selection)) !== JSON.stringify([shapeId])) throw new Error("the click did not select the first box");
    await page.keyboard.press("Delete");
    await wait(400);
    await page.keyboard.press("Control+z");
    await wait(400);
    s = await state();
    if (!s.els.some((e) => e.id === shapeId)) throw new Error("undo did not bring the deleted box back");
    const again = s.comments.find((x) => x.id === other.id);
    if (again.anchor.elementId !== shapeId) lost.push("after Delete and Ctrl+Z: " + JSON.stringify(again.anchor));
    if (lost.length) throw new Error("the pin is no longer on its box " + lost.join("; "));
    return "the pins are on their boxes again";
  });

  await step("no dialog opened at any time", async () => {
    if (dialogs.length) throw new Error(dialogs.join(" | "));
    return "none";
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
