/*
 * A link can lead to any server, so what a server says is not believed. Here the "server" is a few lines of `ws` that say exactly what
 * they are told to, and the editor is whatever BASE serves (it has to expose the store, as the dev server does):
 *   - a link to a server that sends a design with code in it (markup that an old pattern let through: an event handler after a slash)
 *     is refused in words on the page of the link, and nothing of the design is kept;
 *   - a link to an honest server opens the design as always, live;
 *   - the same server, turning hostile once the design is open (operations that carry code), is left at once: the Live mark says
 *     so, the Share panel says why, the design is as it was, and nothing ran.
 * LIVE_PORT is the port of the "server" when the page is served under a Content-Security-Policy that names its origin.
 */
const { WebSocketServer } = require("ws");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("hostile");
const results = [];
const logs = [];
let shotN = 0;

const ROOMS = { code: "CODE0000CODE0000CODE00", honest: "HONEST00HONEST00HONEST", turns: "TURNS000TURNS000TURNS0" };
const TURNS_AFTER_MS = 6000;
const token = (link) => Buffer.from(JSON.stringify(link)).toString("base64url");

/** A server that is told what to say: `config.honest()` is the design it serves, `config.hostile()` the one with code in it. */
function startServer(config) {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: Number(process.env.LIVE_PORT || 0) });
  wss.on("connection", (ws, req) => {
    const room = new URL(req.url, "http://server.test").searchParams.get("room");
    const say = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === "ping") return say({ t: "pong" });
      if (msg.t !== "join") return;
      say({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: room === ROOMS.code ? config.hostile() : config.honest() });
      if (room === ROOMS.turns) setTimeout(() => say({ t: "ops", rev: 1, ops: config.hostileOps() }), TURNS_AFTER_MS);
    });
  });
  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => resolve({ port: wss.address().port, stop: () => wss.close() }));
  });
}

(async () => {
  const config = { honest: () => null, hostile: () => null, hostileOps: () => [] };
  const server = await startServer(config);
  const browser = await launch();
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) logs.push("console.error: " + m.text().slice(0, 240));
    });
    page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
    return page;
  };
  const shot = (page, name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn, page) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      if (page) await shot(page, "FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  const link = (room) => `${BASE}/#/join/${token({ s: `http://127.0.0.1:${server.port}`, r: room, k: "k".repeat(12), v: "e" })}`;
  const elements = (page) =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId) || s.design.pages[0];
      return pg.elements.map((e) => ({ id: e.id, x: Math.round(e.x) }));
    });
  const badgeIs = (page, text, ms) => page.waitForFunction((t) => document.querySelector(".cf-live-badge")?.textContent === t, text, { timeout: ms, polling: 50 });

  /* ---------------- a design for the server to serve ---------------- */
  let honest = null;
  await step("an honest design to serve: a presentation with two boxes", async () => {
    const maker = await open();
    await maker.goto(BASE + "/#/", { waitUntil: "load" });
    await maker.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await maker
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await maker.waitForURL(/#\/design\//, { timeout: 15000 });
    await maker.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await maker.waitForTimeout(900);
    honest = await maker.evaluate(() => {
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
      actions.addElements([box(200, "#d9222a"), box(900, "#1f4fd8")], { center: false, select: false });
      const { live: _live, ...design } = window.__editor.getState().design;
      return JSON.parse(JSON.stringify(design));
    });
    const first = honest.pages[0];
    if (first.elements.length !== 2) throw new Error("elements: " + first.elements.length);
    config.honest = () => honest;
    config.hostile = () => {
      const design = JSON.parse(JSON.stringify(honest));
      const evil = { id: "evil", type: "graphic", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, viewW: 10, viewH: 10, colors: {} };
      evil.svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/onload="window.__pwned=1"></svg>';
      design.pages[0].elements.unshift(evil);
      return design;
    };
    config.hostileOps = () => [{ k: "el.set", page: first.id, id: first.elements[0].id, set: { x: 999, src: "javascript:window.__pwned=1" } }];
    await maker.context().close();
    return "2 boxes, server on port " + server.port;
  });

  /* ---------------- a design with code in it is refused ---------------- */
  const other = await open();
  await step(
    "a link to a server that sends a design with code in it is refused in words, and nothing of the design is kept",
    async () => {
      await other.goto(link(ROOMS.code), { waitUntil: "load" });
      await other.getByText("This shared design could not be opened").waitFor({ timeout: 20000 });
      const text = await other.locator(".cf-editor-state").innerText();
      if (!/does not accept/i.test(text)) throw new Error("the words: " + text.replace(/\s+/g, " ").slice(0, 200));
      if (!other.url().includes("#/join/")) throw new Error("left the page of the link: " + other.url());
      const pwned = await other.evaluate(() => window.__pwned);
      if (pwned) throw new Error("code ran");
      const kept = await other.evaluate(() => localStorage.getItem("craftly.live.joined"));
      if (kept) throw new Error("a copy was kept: " + kept);
      await shot(other, "refused");
      return text.replace(/\s+/g, " ").slice(0, 140);
    },
    other,
  );

  /* ---------------- an honest server is joined as always, and left when it turns ---------------- */
  const joined = await open();
  await step(
    "a link to a server that is honest opens the design, live",
    async () => {
      await joined.goto(link(ROOMS.turns), { waitUntil: "load" });
      await joined.waitForURL(/#\/design\//, { timeout: 30000 });
      await joined.locator(".cf-workspace").waitFor({ timeout: 20000 });
      await badgeIs(joined, "Live", TURNS_AFTER_MS - 500);
      const els = await elements(joined);
      const want = honest.pages[0].elements.map((e) => e.id);
      if (JSON.stringify(els.map((e) => e.id)) !== JSON.stringify(want)) throw new Error("other elements: " + JSON.stringify(els));
      await shot(joined, "honest");
      return "same two boxes, Live";
    },
    joined,
  );

  await step(
    "the same server turning hostile is left at once: the mark and the Share panel say so, the design is as it was, nothing ran",
    async () => {
      const before = await elements(joined);
      await badgeIs(joined, "Not allowed in", TURNS_AFTER_MS + 15000);
      const after = await elements(joined);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("the design changed: " + JSON.stringify([before, after]));
      const pwned = await joined.evaluate(() => window.__pwned);
      if (pwned) throw new Error("code ran");
      await joined.getByRole("button", { name: "Share" }).click();
      const panel = joined.getByRole("dialog", { name: "Share design" });
      await panel.getByText(/does not accept/i).waitFor({ timeout: 5000 });
      await shot(joined, "left");
      return "Not allowed in; " + (await panel.getByText(/does not accept/i).innerText()).slice(0, 90);
    },
    joined,
  );

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
