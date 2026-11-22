/*
 * Review and approval of a team's design (docs/REVIEW.md) in real browsers against the real server with accounts on, built and
 * started here as accounts.cjs does. The owner of a team and a commenter sign in in browsers of their own (the accounts, the team,
 * the invite and the design are made through the server's API, which accounts.cjs drives through the screens). The commenter
 * opens the design read-only, presses "Review live with your team" (the room is made for them: nobody else is in it), and the top
 * bar says "Live, commenting"; the owner joins and asks for a review from the Comments panel; the commenter sees it, places a pin
 * with "Add a comment" and approves; the owner sees the approval about the design as it is now, with Delete but no Edit on the
 * commenter's comment; the commenter's attempt to move a shape changes nothing anywhere; the owner edits, and the approval is about
 * an earlier version on both screens; and when everybody leaves, the room writes the comment and the approval back to the space
 * (a minute after the last person left: the server's `idleCloseMs`).
 *
 * The editor is whatever BASE serves; it has to expose the store (the dev server does).
 */
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("review");
const ROOT = path.resolve(__dirname, "..");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "craftly-review-"));
const results = [];
const logs = [];
let shotN = 0;

/** starts the server with accounts on, on a port of its own */
async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, "dist-server", "live.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DATA_DIR: DATA, ALLOW_ORIGIN: "*", ACCOUNTS: "1", SIGNUP: "open" },
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
    stop: () =>
      new Promise((resolve) => {
        child.removeAllListeners("exit");
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
}

async function api(address, method, url, token, body) {
  const res = await fetch(address + url, {
    method,
    headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

const secret = () => crypto.randomBytes(12).toString("base64url");

(async () => {
  const built = spawnSync("npm", ["run", "server:build"], { cwd: ROOT, shell: true, encoding: "utf8" });
  if (built.status !== 0) throw new Error("the server did not build: " + (built.stderr || built.stdout).slice(0, 400));
  const server = await startServer();
  const SERVER = server.address;
  const browser = await launch();

  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && !/WebSocket|ERR_CONNECTION|Failed to load resource|Failed to fetch/.test(m.text())) logs.push(`${name} console.error: ` + m.text().slice(0, 240));
    });
    page.on("pageerror", (e) => logs.push(`${name} PAGEERROR ` + e.message.slice(0, 240)));
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
  const owner = await open("owner");
  const cora = await open("cora");

  const shot = (who, name) => who.page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + who.name + "-" + name + ".png" }).catch(() => undefined);
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      for (const who of [owner, cora]) await shot(who, "FAIL-" + name.replace(/\W+/g, "_").slice(0, 30));
    }
  };
  const until = async (what, check, ms = 20000) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      last = await check().catch((e) => e.message);
      if (last === true) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(what + " (last: " + JSON.stringify(last).slice(0, 200) + ")");
  };
  const editorState = (who, fn) => who.page.evaluate(fn);

  const people = {
    owner: { email: `owen-${crypto.randomBytes(4).toString("hex")}@example.org`, password: secret(), name: "Owen" },
    cora: { email: `cora-${crypto.randomBytes(4).toString("hex")}@example.org`, password: secret(), name: "Cora" },
  };
  let ownerToken = null;
  let teamId = null;
  const designId = "d_review_" + crypto.randomBytes(4).toString("hex");

  await step("a team with an owner, a commenter and a design, made through the server", async () => {
    const made = await api(SERVER, "POST", "/api/auth/signup", null, people.owner);
    ownerToken = made.body.token;
    teamId = (await api(SERVER, "POST", "/api/teams", ownerToken, { name: "Studio" })).body.team.id;
    const invite = await api(SERVER, "POST", `/api/teams/${teamId}/invites`, ownerToken, { role: "commenter", uses: 1, hours: 1 });
    if (invite.status !== 201) throw new Error("the invite for a commenter: " + invite.status);
    const joined = await api(SERVER, "POST", "/api/auth/signup", null, { ...people.cora, code: invite.body.code });
    if (joined.status !== 201) throw new Error("the commenter's sign-up: " + joined.status);
    const page = { id: "p1", background: { type: "solid", color: "#ffffff" }, elements: [] };
    const box = {
      id: "box",
      type: "shape",
      shape: "rect",
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      rotation: 0,
      opacity: 1,
      fill: { type: "solid", color: "#0f766e" },
      stroke: null,
      radius: 0,
    };
    page.elements.push(box);
    const design = {
      id: designId,
      title: "Launch poster",
      typeId: "custom",
      width: 800,
      height: 600,
      unit: "px",
      pages: [page],
      createdAt: 1,
      updatedAt: 1,
      folderId: null,
      starred: false,
      trashedAt: null,
      version: 1,
    };
    const put = await api(SERVER, "PUT", `/api/spaces/${teamId}/designs/${designId}`, ownerToken, { baseRev: null, design });
    if (put.status !== 201) throw new Error("the design: " + put.status + " " + JSON.stringify(put.body).slice(0, 120));
    const team = await api(SERVER, "GET", `/api/teams/${teamId}`, ownerToken);
    return team.body.members.map((m) => `${m.name} (${m.role})`).join(", ");
  });

  const signIn = async (who, person) => {
    await who.page.goto(BASE + "/#/signin", { waitUntil: "load" });
    await who.page.getByRole("heading", { name: "Sign in", level: 1 }).waitFor({ timeout: 30000 });
    await who.page.getByLabel("Account server").fill(SERVER);
    await who.page.getByLabel("Email").fill(person.email);
    await who.page.getByLabel("Password", { exact: true }).fill(person.password);
    await who.page.getByRole("button", { name: "Sign in" }).click();
    await who.page
      .getByRole("button", { name: /^Sync: / })
      .first()
      .waitFor({ state: "attached", timeout: 20000 });
    if ((await who.page.getByLabel("Space").inputValue()) !== teamId) await who.page.getByLabel("Space").selectOption(teamId);
    await who.page.getByText("Launch poster").first().waitFor({ timeout: 30000 });
  };

  const openDesign = async (who) => {
    await who.page.goto(BASE + "/#/design/" + encodeURIComponent(designId), { waitUntil: "load" });
    await who.page.locator(".cf-workspace").waitFor({ timeout: 30000 });
  };
  const goLive = async (who, button) => {
    await who.page.getByRole("button", { name: "Share" }).click();
    const panel = who.page.getByRole("dialog", { name: "Share design" });
    await panel.getByRole("heading", { name: "Your team" }).waitFor({ timeout: 10000 });
    await panel.getByRole("button", { name: button }).click();
    await until(who.name + " is live", () => editorState(who, () => window.__editor.getState().live === true));
    await who.page.keyboard.press("Escape");
  };
  const commentsPanel = async (who) => {
    const panel = who.page.locator(".cf-comments-panel");
    if (!(await panel.count())) await who.page.locator("[data-cf-comments-button]").first().click();
    await panel.waitFor({ timeout: 10000 });
    return panel;
  };
  const reviewText = async (who) => (await (await commentsPanel(who)).locator(".cf-review").innerText()).replace(/\s+/g, " ").trim();

  await step("both sign in and find the team's design", async () => {
    await signIn(owner, people.owner);
    await signIn(cora, people.cora);
    return "listed for both";
  });

  await step("the commenter opens it read-only, and reviews it live with nobody else in the room", async () => {
    await openDesign(cora);
    await until("the design opens read-only for a commenter", () => editorState(cora, () => window.__editor.getState().mode === "view"));
    await goLive(cora, "Review live with your team");
    await cora.page.locator(".cf-live-badge").getByText("Live, commenting").waitFor({ timeout: 15000 });
    const first = cora.sockets.map((s) => s.first).find((f) => f && f.includes('"session"'));
    const join = JSON.parse(first);
    if (join.key !== undefined || !join.features.includes("review")) throw new Error("the join is " + first.slice(0, 120));
    await shot(cora, "commenting");
    return "joined with the session, features " + join.features.join(" and ");
  });

  await step("the owner joins and asks for a review from the Comments panel", async () => {
    await openDesign(owner);
    await goLive(owner, "Edit live with your team");
    const panel = await commentsPanel(owner);
    await panel.getByRole("button", { name: "Request review" }).click();
    await until("the owner's panel says a review was asked for", async () => /^Review Owen asked for a review on /.test(await reviewText(owner)));
    await until("the commenter sees it", async () => /Owen asked for a review/.test(await reviewText(cora)));
    return await reviewText(cora);
  });

  await step("the commenter places a pin with Add a comment, and approves", async () => {
    const panel = await commentsPanel(cora);
    await panel.getByRole("button", { name: "Add a comment" }).click();
    const frame = cora.page.locator(".cf-pageframe").first();
    const at = await frame.boundingBox();
    await cora.page.mouse.click(at.x + at.width * 0.7, at.y + at.height * 0.7);
    const box = cora.page.getByRole("textbox", { name: "Comment" });
    await box.waitFor({ timeout: 10000 });
    await box.fill("The headline could be larger");
    await box.press("Enter");
    await panel.getByText("The headline could be larger").waitFor({ timeout: 10000 });
    await panel.getByRole("button", { name: "Approve" }).click();
    await until("the owner sees the approval of this version", async () => /Approved by Cora on .*This is about the design as it is now\./.test(await reviewText(owner)));
    await shot(owner, "approved");
    return await reviewText(owner);
  });

  await step("the owner may delete the commenter's comment but not edit it", async () => {
    const panel = await commentsPanel(owner);
    const thread = panel.getByRole("article").filter({ hasText: "The headline could be larger" });
    await thread.waitFor({ timeout: 10000 });
    if (await thread.getByRole("button", { name: "Edit comment" }).count()) throw new Error("the owner is offered Edit on Cora's comment");
    if (!(await thread.getByRole("button", { name: "Delete comment" }).count())) throw new Error("the owner is not offered Delete");
    return "Delete only";
  });

  await step("a commenter's move of a shape changes nothing, anywhere", async () => {
    const before = await editorState(owner, () => window.__editor.getState().design.pages[0].elements[0].x);
    await editorState(cora, () => {
      const { actions } = window.__editor.getState();
      window.__editor.setState({ selection: ["box"] });
      actions.nudge(40, 0);
    });
    await new Promise((r) => setTimeout(r, 500));
    const there = await editorState(cora, () => window.__editor.getState().design.pages[0].elements[0].x);
    const owners = await editorState(owner, () => window.__editor.getState().design.pages[0].elements[0].x);
    if (there !== before || owners !== before) throw new Error(`the shape moved: ${before} → ${there} / ${owners}`);
    return "the shape stays at x " + before;
  });

  await step("an edit by the owner leaves the approval about an earlier version, on both screens", async () => {
    await editorState(owner, () => {
      const { actions } = window.__editor.getState();
      window.__editor.setState({ selection: ["box"] });
      actions.nudge(25, 0);
    });
    const stale = /Approved by Cora on .*This is about an earlier version: the design has been edited since\./;
    await until("the owner's panel says it is about an earlier version", async () => stale.test(await reviewText(owner)));
    await until("the commenter's panel says so too", async () => stale.test(await reviewText(cora)));
    await shot(cora, "stale");
    return "out of date for both";
  });

  await step("when everybody leaves, the room writes the comment and the approval back to the space", async () => {
    for (const who of [owner, cora]) await who.page.goto(BASE + "/#/", { waitUntil: "load" });
    let back = null;
    await until(
      "the space has the room's design",
      async () => {
        back = (await api(SERVER, "GET", `/api/spaces/${teamId}/designs/${designId}`, ownerToken)).body;
        return back.rev >= 2 && !!back.design.review;
      },
      90000,
    );
    const c = back.design.comments.find((x) => x.text === "The headline could be larger");
    if (!c || c.author.name !== "Cora" || !c.author.id) throw new Error("the comment came back as " + JSON.stringify(c).slice(0, 160));
    if (back.design.review.state !== "approved" || back.design.review.by.name !== "Cora") throw new Error("the review came back as " + JSON.stringify(back.design.review));
    return `revision ${back.rev}: a comment by Cora and an approval by ${back.design.review.by.name}`;
  });

  await step("no errors reached the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 4).join(" | "));
    return "clean";
  });

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
  await server.stop();
  fs.rmSync(DATA, { recursive: true, force: true });
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
