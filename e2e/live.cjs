/*
 * Editing one design together, as people do it in real browsers: one person starts a live session from the Share panel and gets two
 * links; a second person opens the edit link and is in the same design; a third opens the view link and can only look. What one does
 * with the real pointer shows up for the others, changes made at the same moment on different properties both survive, undo takes
 * back only the person's own change, a person who reloads comes back to the live design, and stopping to share sends the others away
 * and leaves everyone their own copy. Whatever a socket is opened with, no key is in its address: each connection shows its key in its
 * first message.
 *
 * The server is the real one (`npm run server:build`, then dist-server/live.mjs, started here with a folder of its own, on a free
 * port or on LIVE_PORT when the page is served under a Content-Security-Policy that names the origin of the server); the editor is
 * whatever BASE serves, which has to expose the store (the dev server does).
 */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { launch, outDir, joinIfAsked, BASE, isChromium } = require("./lib.cjs");

const OUT = outDir("live");
const ROOT = path.resolve(__dirname, "..");
const results = [];
const logs = [];
let shotN = 0;

/** starts the server for shared designs and gives its address; the folder it keeps rooms in is thrown away at the end */
async function startServer() {
  const built = spawnSync("npm", ["run", "server:build"], { cwd: ROOT, shell: true, encoding: "utf8" });
  if (built.status !== 0) throw new Error("the server did not build: " + (built.stderr || built.stdout).slice(0, 400));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "craftly-live-"));
  const child = spawn(process.execPath, [path.join(ROOT, "dist-server", "live.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PORT: process.env.LIVE_PORT || "0", HOST: "127.0.0.1", DATA_DIR: data, ALLOW_ORIGIN: "*" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const address = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("the server did not start: " + text.slice(0, 300))), 15000);
    child.stdout.on("data", (chunk) => {
      text += chunk;
      const match = /on (http:\/\/127\.0\.0\.1:\d+)/.exec(text);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("exit", (code) => reject(new Error("the server stopped: " + code + " " + text.slice(0, 300))));
  });
  return {
    address,
    stop: () => {
      child.removeAllListeners("exit");
      child.kill();
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

(async () => {
  const server = await startServer();
  const browser = await launch();
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // the clipboard permissions are Chromium's: another engine names neither, and refuses the context that asks for them
    if (isChromium) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => undefined);
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) logs.push(`${name} console.error: ` + m.text().slice(0, 240));
    });
    page.on("pageerror", (e) => logs.push(`${name} PAGEERROR ` + e.message.slice(0, 240)));
    // every socket the page opens: its address, and the first thing it says
    const sockets = [];
    page.on("websocket", (ws) => {
      const entry = { url: ws.url(), first: null };
      sockets.push(entry);
      ws.on("framesent", (frame) => {
        if (entry.first === null) entry.first = String(frame.payload);
      });
    });
    return { ctx, page, name, sockets };
  };
  const [ann, bob, cat] = [await open("ann"), await open("bob"), await open("cat")];
  const shot = (who, name) => who.page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + who.name + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      await shot(ann, "FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  const wait = (ms) => ann.page.waitForTimeout(ms);

  /** the elements of the open page of a person's browser, and the state of their design */
  const look = (who) =>
    who.page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return {
        title: s.design.title,
        live: s.live,
        mode: s.mode,
        canUndo: s.canUndo,
        link: s.design.live ? { role: s.design.live.role, room: s.design.live.room } : null,
        els: pg.elements.map((e) => ({
          id: e.id,
          type: e.type,
          x: Math.round(e.x),
          y: Math.round(e.y),
          fill: e.fill && e.fill.color,
          start: e.start && e.start.elementId,
          end: e.end && e.end.elementId,
        })),
      };
    });
  const until = async (what, who, check, ms = 12000) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      last = await look(who);
      if (check(last)) return last;
      await who.page.waitForTimeout(100);
    }
    throw new Error(`waited for ${what}: ${JSON.stringify(last).slice(0, 200)}`);
  };
  const badge = (who) => who.page.locator(".cf-live-badge").first();

  let editLink = "";
  let viewLink = "";
  let firstId = "";
  let secondId = "";

  /* ---------------- one person starts ---------------- */
  await step("a presentation with two boxes opens", async () => {
    await ann.page.goto(BASE + "/#/", { waitUntil: "load" });
    await ann.page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await ann.page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await ann.page.waitForURL(/#\/design\//, { timeout: 15000 });
    await ann.page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    const ids = await ann.page.evaluate(() => {
      const { actions } = window.__editor.getState();
      actions.selectAll();
      actions.deleteElements();
      const box = (x, color) => ({
        id: "x",
        type: "shape",
        shape: "rect",
        x,
        y: 300,
        width: 300,
        height: 150,
        rotation: 0,
        opacity: 1,
        fill: { type: "solid", color },
        stroke: null,
        radius: 0,
      });
      const made = actions.addElements([box(200, "#d9222a"), box(900, "#1f4fd8")], { center: false, select: false });
      actions.clearSelection();
      return made;
    });
    [firstId, secondId] = ids;
    return "two boxes";
  });

  await step("Share > Work together starts a live session and shows an edit link and a view link", async () => {
    await ann.page.getByRole("button", { name: "Share" }).click();
    const panel = ann.page.getByRole("dialog", { name: "Share design" });
    await panel.getByRole("heading", { name: "Work together" }).waitFor({ timeout: 5000 });
    await panel.getByRole("textbox", { name: "Server address" }).fill(server.address);
    await shot(ann, "before-start");
    await panel.getByRole("button", { name: "Start live session" }).click();
    await panel.getByRole("textbox", { name: "Edit link" }).waitFor({ timeout: 10000 });
    editLink = await panel.getByRole("textbox", { name: "Edit link" }).inputValue();
    viewLink = await panel.getByRole("textbox", { name: "View link" }).inputValue();
    if (!editLink.includes("#/join/") || !viewLink.includes("#/join/") || editLink === viewLink) throw new Error("the links: " + editLink + " | " + viewLink);
    await shot(ann, "links");
    await ann.page.keyboard.press("Escape");
    await badge(ann).waitFor({ timeout: 5000 });
    await ann.page.waitForFunction(() => document.querySelector(".cf-live-badge")?.textContent === "Live", null, { timeout: 15000 });
    const s = await look(ann);
    if (!s.live || s.link?.role !== "edit") throw new Error("not live: " + JSON.stringify(s));
    return "badge: " + (await badge(ann).textContent());
  });

  /* ---------------- a second person joins by the edit link ---------------- */
  await step("the edit link opens the same design for a second person, who is live", async () => {
    await bob.page.goto(editLink, { waitUntil: "load" });
    // the server is new in this person's browser: the link asks before it connects, names the server, and has connected to nothing yet
    await bob.page.getByRole("heading", { name: "Join this shared design?" }).waitFor({ timeout: 20000 });
    const asked = await bob.page.locator(".cf-editor-state").innerText();
    if (!asked.includes(new URL(server.address).host)) throw new Error("the question does not name the server: " + asked.replace(/\s+/g, " ").slice(0, 200));
    const early = bob.sockets.filter((s) => s.url.startsWith(server.address.replace(/^http/, "ws")));
    if (early.length) throw new Error("connected before the person said yes: " + early.length + " socket(s)");
    await bob.page.getByRole("button", { name: "Join", exact: true }).click();
    await bob.page.waitForURL(/#\/design\//, { timeout: 30000 });
    await bob.page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await bob.page.waitForFunction(() => document.querySelector(".cf-live-badge")?.textContent === "Live", null, { timeout: 20000 });
    const s = await until("the same two boxes", bob, (x) => x.els.length === 2);
    if (s.els[0].id !== firstId || s.els[1].id !== secondId) throw new Error("other elements: " + JSON.stringify(s.els));
    if (s.link?.role !== "edit") throw new Error("link " + JSON.stringify(s.link));
    await shot(bob, "joined");
    return "same ids, live";
  });

  /* ---------------- what one does, the other sees ---------------- */
  await step("a box dragged with the real pointer by one person moves for the other", async () => {
    const box = await ann.page.locator(".cf-pageframe").boundingBox();
    const zoom = await ann.page.evaluate(() => window.__editor.getState().zoom);
    const at = (x, y) => [box.x + x * zoom, box.y + y * zoom];
    const [fx, fy] = at(350, 375);
    const [tx, ty] = at(350, 175);
    await ann.page.mouse.move(fx, fy);
    await ann.page.mouse.down();
    await ann.page.mouse.move(fx, (fy + ty) / 2, { steps: 5 });
    await ann.page.mouse.move(tx, ty, { steps: 5 });
    await ann.page.mouse.up();
    const mine = await look(ann);
    if (!(mine.els[0].y < 250)) throw new Error(`the box did not move for the person who dragged it: y ${mine.els[0].y}`);
    // a drag is sent while it happens, so the other person also sees the places on the way: wait for the place it ended at
    await until("the box to be where it was dropped for the other person", bob, (x) => Math.abs(x.els[0].y - mine.els[0].y) <= 1);
    await shot(bob, "after-drag");
    return `y ${mine.els[0].y} for both`;
  });

  await step("each sees the other: a pointer with a name on the page, an outline around what is selected, and who is here in the top bar", async () => {
    const frame = await bob.page.locator(".cf-pageframe").boundingBox();
    const zoom = await bob.page.evaluate(() => window.__editor.getState().zoom);
    await bob.page.mouse.move(frame.x + 600 * zoom, frame.y + 500 * zoom);
    await bob.page.mouse.move(frame.x + 640 * zoom, frame.y + 540 * zoom, { steps: 4 });
    const pointer = ann.page.locator(".cf-presence__pointer").first();
    await pointer.waitFor({ timeout: 8000 });
    const name = await pointer.locator(".cf-presence__tag").textContent();
    if (!/^Guest \d+$/.test(name)) throw new Error("the name on the pointer: " + name);
    // where Ann sees Bob's pointer is where Bob's pointer is on the page, whatever the two windows show of it
    const where = await ann.page.waitForFunction(
      () => {
        const p = document.querySelector(".cf-presence__pointer");
        const f = document.querySelector(".cf-pageframe");
        if (!p || !f) return null;
        const z = window.__editor.getState().zoom;
        const [a, b] = [p.getBoundingClientRect(), f.getBoundingClientRect()];
        const at = { x: Math.round((a.left - b.left) / z), y: Math.round((a.top - b.top) / z) };
        return Math.abs(at.x - 640) <= 3 && Math.abs(at.y - 540) <= 3 ? at : null;
      },
      null,
      { timeout: 8000 },
    );
    await ann.page.getByRole("list", { name: "2 people here" }).waitFor({ timeout: 8000 });
    await bob.page.getByRole("list", { name: "2 people here" }).waitFor({ timeout: 8000 });
    await bob.page.evaluate((id) => window.__editor.getState().actions.select([id]), firstId);
    await ann.page.locator(".cf-presence__outline").first().waitFor({ timeout: 8000 });
    const layer = await ann.page.evaluate(() => {
      const el = document.querySelector(".cf-presence");
      return { events: getComputedStyle(el).pointerEvents, hidden: el.getAttribute("aria-hidden") };
    });
    if (layer.events !== "none" || layer.hidden !== "true") throw new Error("the layer of the others can be touched or is read out: " + JSON.stringify(layer));
    await shot(ann, "sees-bob");
    await bob.page.evaluate(() => window.__editor.getState().actions.clearSelection());
    await ann.page.locator(".cf-presence__outline").first().waitFor({ state: "detached", timeout: 8000 });
    return `Bob is "${name}" at ${JSON.stringify(await where.jsonValue())} for Ann`;
  });

  await step("a text box that one person is typing in stays closed for the other, who is told who has it, and opens once it is free", async () => {
    await ann.page.getByRole("tab", { name: "Text", exact: true }).click();
    await ann.page
      .getByRole("button", { name: /Add a heading/i })
      .first()
      .click();
    await ann.page.waitForFunction(() => !!window.__editor.getState().editingTextId, null, { timeout: 8000 });
    await ann.page.keyboard.type("Ann was here", { delay: 15 });
    const textId = await ann.page.evaluate(() => window.__editor.getState().editingTextId);
    const typing = bob.page.locator(".cf-presence__outline--typing");
    await typing.waitFor({ timeout: 8000 });
    const label = await typing.textContent();
    if (!/^Guest \d+ is typing…$/.test(label)) throw new Error("what Bob is shown on the box: " + label);
    const textOf = (who) =>
      who.page.evaluate((id) => {
        const s = window.__editor.getState();
        const el = s.design.pages.flatMap((p) => p.elements).find((e) => e.id === id);
        return el ? el.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n") : null;
      }, textId);
    await bob.page.waitForFunction(
      (id) => {
        const el = window.__editor
          .getState()
          .design.pages.flatMap((p) => p.elements)
          .find((e) => e.id === id);
        return !!el && JSON.stringify(el.paragraphs).includes("Ann was here");
      },
      textId,
      { timeout: 8000 },
    );
    // Bob double-clicks the text with the real pointer: it does not open, and he is told why
    const box = await typing.boundingBox();
    const [mx, my] = [box.x + box.width / 2, box.y + box.height / 2];
    await bob.page.mouse.dblclick(mx, my);
    await bob.page.locator(".cf-toast__message", { hasText: "is typing in this text" }).first().waitFor({ timeout: 5000 });
    if (await bob.page.evaluate(() => window.__editor.getState().editingTextId)) throw new Error("the box opened for Bob while Ann was typing in it");
    await shot(bob, "text-is-taken");
    // Ann types on, and nothing of hers is lost
    await ann.page.keyboard.type(" first", { delay: 15 });
    const typed = await textOf(ann);
    await ann.page.keyboard.press("Escape");
    await typing.waitFor({ state: "detached", timeout: 8000 });
    if ((await textOf(ann)) !== typed || !typed.includes("Ann was here first")) throw new Error("Ann's text: " + JSON.stringify(typed));
    // now it is free: the same double click opens it for Bob, and Ann sees that he has it
    await bob.page.mouse.dblclick(mx, my);
    await bob.page.waitForFunction((id) => window.__editor.getState().editingTextId === id, textId, { timeout: 5000 });
    await ann.page.locator(".cf-presence__outline--typing").waitFor({ timeout: 8000 });
    await bob.page.keyboard.press("Escape");
    await ann.page.locator(".cf-presence__outline--typing").waitFor({ state: "detached", timeout: 8000 });
    if ((await textOf(bob)) !== typed) throw new Error("the text changed by being opened: " + JSON.stringify(await textOf(bob)));
    // the page is left as the steps below expect it: two boxes
    await ann.page.evaluate((id) => {
      const { actions } = window.__editor.getState();
      actions.deleteElements([id]);
      actions.clearSelection();
    }, textId);
    await bob.page.evaluate(() => window.__editor.getState().actions.clearSelection());
    await until("the text to be gone for Bob", bob, (x) => x.els.length === 2);
    await until("the text to be gone for Ann", ann, (x) => x.els.length === 2);
    return `"${label}", refused with a message, "${typed}" kept, then opened for Bob`;
  });

  await step("changes made at the same moment to different things both survive, for both people", async () => {
    await Promise.all([
      ann.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { x: 120 }), secondId),
      bob.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { fill: { type: "solid", color: "#00aa00" } }), secondId),
    ]);
    const check = (x) => x.els[1].x === 120 && x.els[1].fill === "#00aa00";
    const a = await until("Ann to have both", ann, check);
    const b = await until("Bob to have both", bob, check);
    return `x ${a.els[1].x}, fill ${b.els[1].fill}`;
  });

  await step("the title changes for everybody", async () => {
    await bob.page.evaluate(() => window.__editor.getState().actions.setTitle("Together on a Monday"));
    await until("Ann to see the title", ann, (x) => x.title === "Together on a Monday");
    return "ok";
  });

  /* ---------------- a diagram, together ---------------- */
  await step("an arrow that one person attaches to two boxes follows when the other person moves one of them", async () => {
    // Ann clicks one box, Shift-clicks the other and chooses Connect, as in e2e/connect.cjs
    const s0 = await look(ann);
    const frame = await ann.page.locator(".cf-pageframe").boundingBox();
    const zoom = await ann.page.evaluate(() => window.__editor.getState().zoom);
    const centre = (e) => [frame.x + (e.x + 150) * zoom, frame.y + (e.y + 75) * zoom];
    const [fx, fy] = centre(s0.els[0]);
    const [sx, sy] = centre(s0.els[1]);
    await ann.page.mouse.click(fx, fy);
    await ann.page.keyboard.down("Shift");
    await ann.page.mouse.click(sx, sy);
    await ann.page.keyboard.up("Shift");
    await ann.page.getByRole("toolbar", { name: "Selected element common controls" }).getByRole("button", { name: "Connect", exact: true }).click();
    const line = (x) => x.els.find((e) => e.type === "line");
    const bobSees = await until("Bob to see the arrow", bob, (x) => !!line(x));
    if (!line(bobSees).start || !line(bobSees).end) throw new Error("the arrow is not attached for Bob: " + JSON.stringify(line(bobSees)));
    const before = line(await look(bob));
    // Bob moves the second box a long way down; the arrow follows for both people
    await bob.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { y: 520 }), secondId);
    const moved = (x) => !!line(x) && Math.abs(line(x).y - before.y) > 20;
    const a = await until("the arrow to follow for Ann", ann, moved);
    const b = await until("the arrow to follow for Bob", bob, moved);
    if (Math.abs(line(a).y - line(b).y) > 1 || Math.abs(line(a).x - line(b).x) > 1) throw new Error("the arrow is not the same: " + JSON.stringify([line(a), line(b)]));
    await shot(ann, "diagram");
    return "attached, and it follows for both";
  });

  /* ---------------- undo is a person's own ---------------- */
  await step("undo takes back only the person's own change, and their own redo brings it back", async () => {
    await ann.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { y: 40 }), firstId); // mine
    await bob.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { y: 500 }), secondId); // theirs, afterwards
    await until("both to be in place", ann, (x) => x.els[0].y === 40 && x.els[1].y === 500);
    await ann.page.locator(".cf-workspace").focus();
    await ann.page.keyboard.press("Control+z");
    const a = await until("the undo", ann, (x) => x.els[0].y !== 40);
    if (a.els[1].y !== 500) throw new Error("the undo took Bob's change as well: " + JSON.stringify(a.els));
    const b = await until("Bob to see the undo", bob, (x) => x.els[0].y !== 40);
    if (b.els[1].y !== 500) throw new Error("Bob lost his own change: " + JSON.stringify(b.els));
    await ann.page.keyboard.press("Control+Shift+z");
    await until("the redo", bob, (x) => x.els[0].y === 40);
    return "Ann's step only";
  });

  /* ---------------- a third person only looks ---------------- */
  await step("the view link opens the design read-only, and shows what the others do", async () => {
    await cat.page.goto(viewLink, { waitUntil: "load" });
    if (!(await joinIfAsked(cat.page))) throw new Error("a third person, new to the server, was not asked before joining");
    await cat.page.waitForURL(/#\/design\//, { timeout: 30000 });
    await cat.page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await cat.page.waitForFunction(() => document.querySelector(".cf-live-badge")?.textContent === "Live, view only", null, { timeout: 20000 });
    const s = await until("the design", cat, (x) => x.els.length === 3 && x.title === "Together on a Monday");
    if (s.mode !== "view" || s.link?.role !== "view") throw new Error("mode " + s.mode + ", link " + JSON.stringify(s.link));
    await cat.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { x: 5 }), firstId);
    const after = await look(cat);
    if (after.els[0].x === 5) throw new Error("a viewer changed the design");
    await bob.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { x: 333 }), firstId);
    await until("the viewer to see Bob's change", cat, (x) => x.els[0].x === 333);
    await shot(cat, "viewer");
    return "read-only, and live";
  });

  /* ---------------- a reload ---------------- */
  await step("a person who reloads comes back to the live design, with what the others did meanwhile", async () => {
    await ann.page.waitForFunction(() => window.__editor.getState().saveState === "saved", null, { timeout: 15000 });
    await ann.page.reload({ waitUntil: "load" });
    await ann.page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await ann.page.waitForFunction(() => document.querySelector(".cf-live-badge")?.textContent === "Live", null, { timeout: 20000 });
    await bob.page.evaluate((id) => window.__editor.getState().actions.updateElements([id], { x: 444 }), firstId);
    const a = await until("Ann to see Bob's change after the reload", ann, (x) => x.els[0].x === 444);
    if (a.link?.role !== "edit") throw new Error("the link was lost: " + JSON.stringify(a.link));
    return "live again";
  });

  /* ---------------- the same link twice ---------------- */
  await step("opening the edit link again on the same device opens the same design", async () => {
    const before = await bob.page.evaluate(() => window.__editor.getState().design.id);
    await bob.page.goto(editLink, { waitUntil: "load" });
    // a design that was joined before is opened from the library: nothing is asked
    if (await joinIfAsked(bob.page, 3000)) throw new Error("asked again about a design that was joined before");
    await bob.page.waitForURL(/#\/design\//, { timeout: 30000 });
    await bob.page.waitForFunction((id) => window.__editor.getState().design?.id === id, before, { timeout: 20000 });
    return "same design";
  });

  /* ---------------- stopping ---------------- */
  await step("stopping to share sends the others away, and everybody keeps their own copy", async () => {
    await ann.page.getByRole("button", { name: "Share" }).click();
    const panel = ann.page.getByRole("dialog", { name: "Share design" });
    await panel.getByRole("button", { name: "Stop sharing" }).click();
    await panel.getByRole("group", { name: "Stop sharing" }).getByRole("button", { name: "Stop sharing" }).click();
    await ann.page.waitForFunction(() => !window.__editor.getState().design.live, null, { timeout: 10000 });
    await bob.page.waitForFunction(() => document.querySelector(".cf-live-badge")?.textContent === "Not allowed in", null, { timeout: 15000 });
    const a = await look(ann);
    const b = await look(bob);
    if (a.els.length !== 3 || b.els.length !== 3) throw new Error("a copy was lost: " + JSON.stringify([a.els.length, b.els.length]));
    await shot(bob, "sent-away");
    return "Ann: own again, Bob: sent away, both keep their 2 boxes and the arrow";
  });

  /* ---------------- the keys ---------------- */
  await step("the keys are in the first message of every connection and in no address", async () => {
    const keyOf = (link) => JSON.parse(Buffer.from(link.split("#/join/")[1], "base64url").toString("utf8")).k;
    const keys = [keyOf(editLink), keyOf(viewLink)];
    // the sockets to the live server; the dev server's own hot-reload socket is none of them
    const live = server.address.replace(/^http/, "ws");
    const all = [ann, bob, cat].flatMap((who) => who.sockets.filter((s) => s.url.startsWith(live)).map((s) => ({ who: who.name, ...s })));
    if (all.length < 5) throw new Error("only " + all.length + " connections were seen");
    for (const s of all) {
      if (!s.url.includes("room=")) throw new Error(`${s.who}: no room in ${s.url}`);
      if (keys.some((k) => s.url.includes(k)) || /[?&]key=/.test(s.url)) throw new Error(`${s.who}: a key is in the address ${s.url}`);
      let first = null;
      try {
        first = JSON.parse(s.first);
      } catch {
        /* not JSON */
      }
      if (!first || first.t !== "join" || !keys.includes(first.key)) throw new Error(`${s.who}: the first message is not a join with a key: ${String(s.first).slice(0, 80)}`);
    }
    return `${all.length} connections, each with its key in the first message`;
  });

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 4).join(" | "));
    return "clean";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  await browser.close();
  server.stop();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
