/*
 * Accounts, sync and teams (docs/ACCOUNTS.md) in real browsers against the real server with accounts on (`ACCOUNTS=1 SIGNUP=open`,
 * built and started here as live.cjs does, with a folder of its own, on a port that stays the same when it is stopped and started
 * again). Without an account nothing changes and nothing is asked of the server. Then one person signs up on a laptop with the
 * server typed in and moves the laptop's design in, signs in on a phone (a second browser context) and finds it there, a clip and a
 * sound of a design of the laptop reach the phone with it (docs/ACCOUNTS.md, "Clips and sounds"), edits the same
 * design on both while the laptop is offline (a conflict: the server's design stays under its id, the laptop's edit becomes a copy
 * "(edited on …)"), makes a team and invites a second person by link (which names the account server after the #), who makes an
 * account from the invite without typing a server; a team design reaches the second person, who edits it while the owner has it
 * live (sync says the change waits for the live editing; Edit live keeps it as a copy "(edited on …)" that reaches the owner, and
 * joins with the team's version), both edit it live from Share without any link (the socket shows the session in its first message,
 * never a key, and nothing secret is in its address; each sees the other under their account's name), the owner lowers the second person to viewer (who is sent out and comes back read-only)
 * and then removes them (their copy stays theirs); the phone signs out (the account's designs leave it); the server stops (the
 * laptop says offline with what waits) and comes back (it is sent); and the sign-in and the account menu work in Hindi, with the
 * words read from the app's own catalogs.
 *
 * The editor is whatever BASE serves; it has to expose the store and the source modules (the dev server does).
 */
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("accounts");
const ROOT = path.resolve(__dirname, "..");
const results = [];
const logs = [];
let shotN = 0;

/** A port that is free now, kept for the server so that it can be stopped and started again at the same address. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "craftly-accounts-"));

/** starts the server with accounts on; the data folder stays between starts and is removed at the end */
async function startServer(port) {
  const child = spawn(process.execPath, [path.join(ROOT, "dist-server", "live.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: DATA, ALLOW_ORIGIN: "*", ACCOUNTS: "1", SIGNUP: "open" },
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
  const server = {
    address,
    running: true,
    stop: () =>
      new Promise((resolve) => {
        server.running = false;
        child.removeAllListeners("exit");
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
  return server;
}

/** A request to the server as a person (from this script, as a third device would). */
async function api(address, method, url, token, body) {
  const res = await fetch(address + url, {
    method,
    headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: res.status, body: parsed };
}

const secretPassword = () => crypto.randomBytes(12).toString("base64url");

(async () => {
  const built = spawnSync("npm", ["run", "server:build"], { cwd: ROOT, shell: true, encoding: "utf8" });
  if (built.status !== 0) throw new Error("the server did not build: " + (built.stderr || built.stdout).slice(0, 400));
  const port = await freePort();
  let server = await startServer(port);
  const SERVER = server.address;
  const browser = await launch();

  const open = async (name, options = {}) => {
    const ctx = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 } });
    // every module the dev server sends is a resource: keep them all in the list the journey reads
    await ctx.addInitScript(() => performance.setResourceTimingBufferSize(20000));
    if (options.language) await ctx.addInitScript((code) => localStorage.setItem("craftly.language", code), options.language);
    const page = await ctx.newPage();
    // WebKit says a server that is not there, while the journey has it stopped, as "Could not connect to server", and, when no
    // permission of an earlier preflight is kept, as a page error "… due to access control checks"; only then are they expected
    const serverAway = (text) =>
      !server.running && (/^Could not connect to server/.test(text) || (text.includes(new URL(SERVER).host) && /due to access control checks/.test(text)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/WebSocket|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(m.text()) && !serverAway(m.text()))
        logs.push(`${name} console.error: ` + m.text().slice(0, 240));
    });
    page.on("pageerror", (e) => {
      if (!serverAway(e.message)) logs.push(`${name} PAGEERROR ` + e.message.slice(0, 240));
    });
    // every request to the account server, and every socket with what it says first
    const requests = [];
    // (and the address of every request of the page, to any host: what a secret after the # must never be in)
    const everyUrl = [];
    page.on("request", (r) => {
      everyUrl.push(r.url());
      if (r.url().startsWith(SERVER)) requests.push(r.method() + " " + r.url().slice(SERVER.length));
    });
    const sockets = [];
    page.on("websocket", (ws) => {
      const entry = { url: ws.url(), first: null };
      sockets.push(entry);
      ws.on("framesent", (frame) => {
        if (entry.first === null) entry.first = String(frame.payload);
      });
    });
    return { ctx, page, name, requests, everyUrl, sockets };
  };
  const laptop = await open("laptop");
  const phone = await open("phone", { viewport: { width: 390, height: 844 } });
  const bob = await open("bob");

  const shot = (who, name) => who.page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + who.name + "-" + name + ".png" }).catch(() => undefined);
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      for (const who of [laptop, phone, bob]) await shot(who, "FAIL-" + name.replace(/\W+/g, "_").slice(0, 30));
    }
  };
  const until = async (what, check, ms = 20000) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      last = await check().catch((e) => e.message);
      if (last === true) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(what + " (last: " + JSON.stringify(last).slice(0, 200) + ")");
  };

  /**
   * The app's own modules, kept on the page while it can still fetch them: a module that a browser fails to fetch (offline, the
   * server stopped) is remembered as failed for the life of the page.
   */
  const prepare = (who, account = true) => {
    who.account = account;
    return who.page.evaluate(async (withAccount) => {
      // The very instance the app runs: the dev server adds ?t=<time> to the address of a module that changed since it started,
      // and an import of the plain address would make a second instance with none of the app's state.
      const loaded = (path) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((name) => new URL(name).pathname === path)
          .pop() ?? path;
      window.__journey = {
        lib: await import(loaded("/src/core/library.ts")),
        factory: await import(loaded("/src/core/factory.ts")),
        assets: await import(loaded("/src/core/assets.ts")),
        // (the account code only once the journey is past the step that checks it is not loaded, and the app has loaded it)
        sync: withAccount ? await import(loaded("/src/cloud/sync.ts")) : null,
      };
    }, account);
  };
  /**
   * The modules again when the page was loaded anew since `prepare`: WebKit loads the page again for `goto` to the address it is
   * at already (hash and all), where Chrome only moves to the hash, so a step may find the page without them.
   */
  const ready = async (who) => {
    const kept = await who.page.evaluate((withAccount) => !!window.__journey && (!withAccount || !!window.__journey.sync), who.account !== false);
    if (!kept) await prepare(who, who.account !== false);
  };
  /** the library of a browser, through the app's own modules */
  const designs = async (who) => {
    await ready(who);
    return who.page.evaluate(async () => {
      const lib = window.__journey.lib;
      return (await lib.listDesigns()).map((d) => ({ id: d.id, title: d.title, space: d.space ?? null, trashed: !!d.trashedAt }));
    });
  };
  const makeDesign = async (who, title) => {
    await ready(who);
    return who.page.evaluate(async (t) => {
      const lib = window.__journey.lib;
      return (await lib.createBlankDesign({ typeId: "custom", width: 800, height: 600, title: t })).id;
    }, title);
  };
  /** an edit of the content, as the editor saves one: `pages` pages more */
  const addPages = async (who, id, pages) => {
    await ready(who);
    return who.page.evaluate(
      async ([designId, n]) => {
        const { lib, factory } = window.__journey;
        const open = await lib.getDesignForEditing(designId);
        for (let i = 0; i < n; i++) open.design.pages.push(factory.createPage());
        await lib.saveDesign(open.design, undefined, open.revision);
        return open.design.pages.length;
      },
      [id, pages],
    );
  };
  const syncNow = async (who) => {
    await ready(who);
    return who.page.evaluate(async () => {
      const sync = window.__journey.sync;
      const report = await sync.syncNow().catch((e) => ({ error: String(e && e.message) }));
      return report;
    });
  };
  const syncStatus = (who) =>
    who.page
      .getByRole("button", { name: /^Sync: / })
      .first()
      .getAttribute("aria-label");
  const accountMenu = async (who, label = "Account") => {
    // the rail's account button on a wide screen, the one in the top bar on a phone
    // (waited for: a page that was just loaded may not show the shell yet, as after a `goto` that WebKit loads anew)
    const buttons = who.page.getByRole("button", { name: label, exact: true });
    const wide = who.page.locator(".cf-dnav__account-wide");
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        if (await buttons.nth(i).isVisible()) {
          await buttons.nth(i).click();
          return who.page.getByRole("menu").first();
        }
      }
      // the expanded rail names the person
      if (await wide.isVisible()) {
        await wide.click();
        return who.page.getByRole("menu").first();
      }
      await who.page.waitForTimeout(100);
    }
    throw new Error("no account button shows");
  };

  const ann = { email: `ann-${crypto.randomBytes(4).toString("hex")}@example.org`, password: secretPassword() };
  const bobAccount = { email: `bob-${crypto.randomBytes(4).toString("hex")}@example.org`, password: secretPassword() };
  let annToken = null;
  let posterId = null;
  let teamId = null;
  let flyerId = null;
  let inviteLink = null;

  /* ---------------- without an account ---------------- */
  await step("without an account nothing new shows and nothing is asked of the server", async () => {
    await laptop.page.goto(BASE + "/#/", { waitUntil: "load" });
    await laptop.page.getByText("What will you design today?").waitFor({ timeout: 30000 });
    if (await laptop.page.getByRole("button", { name: /^Sync: / }).count()) throw new Error("a sync status shows without an account");
    if (await laptop.page.locator(".cf-spacebar").count()) throw new Error("a space switcher shows without an account");
    await prepare(laptop, false);
    posterId = await makeDesign(laptop, "Laptop poster");
    const menu = await accountMenu(laptop);
    // (WebKit's innerText ends each item with a line break, as in print.cjs)
    const items = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
    if (items[0] !== "Sign in" || items[1] !== "Create account") throw new Error("the menu starts " + JSON.stringify(items.slice(0, 3)));
    await laptop.page.keyboard.press("Escape");
    if (laptop.requests.length) throw new Error("asked the server: " + laptop.requests.join(", "));
    const loaded = await laptop.page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => /\/src\/cloud\/(sync|api|account)\.ts/.test(n)),
    );
    if (loaded.length) throw new Error("account code was loaded: " + loaded.join(", "));
    return "menu offers Sign in and Create account; no request, no account code loaded";
  });

  /* ---------------- one person, two devices ---------------- */
  await step("sign up on the laptop with the server typed in, keep the recovery code, move the laptop's design in", async () => {
    const menu = await accountMenu(laptop);
    await menu.getByRole("menuitem", { name: "Create account" }).click();
    await laptop.page.getByRole("heading", { name: "Create account" }).waitFor({ timeout: 15000 });
    const serverField = laptop.page.getByLabel("Account server");
    await serverField.fill(SERVER);
    await laptop.page.getByLabel("Your name").fill("Ann");
    await laptop.page.getByLabel("Email").fill(ann.email);
    const password = laptop.page.getByLabel("Password", { exact: true });
    if ((await password.getAttribute("autocomplete")) !== "new-password") throw new Error("the password field is not new-password");
    await password.fill(ann.password);
    await shot(laptop, "sign-up");
    await laptop.page.getByRole("button", { name: "Create account" }).click();
    await laptop.page.getByRole("heading", { name: "Keep your recovery code" }).waitFor({ timeout: 20000 });
    const code = (await laptop.page.getByTestId("recovery-code").textContent()).trim();
    if (!/^[A-Za-z0-9_-]{22}$/.test(code)) throw new Error("no recovery code: " + code);
    await laptop.page.getByRole("button", { name: "I have kept it" }).click();
    await laptop.page
      .getByRole("button", { name: /^Sync: / })
      .first()
      .waitFor({ state: "attached", timeout: 20000 });
    await prepare(laptop);
    const dialog = laptop.page.getByRole("dialog", { name: "Move 1 design into your account?" });
    await dialog.waitFor({ timeout: 15000 });
    await shot(laptop, "move-designs");
    await dialog.getByRole("button", { name: "Move all" }).click();
    const signed = await api(SERVER, "POST", "/api/auth/signin", null, { email: ann.email, password: ann.password, device: "script" });
    annToken = signed.body.token;
    const me = signed.body.user.id;
    let there = null;
    await until("the server has the moved design", async () => {
      const changes = await api(SERVER, "GET", `/api/spaces/${me}/changes?since=0`, annToken);
      there = changes.body.designs.find((d) => d.id === posterId);
      return !!there;
    });
    await until("the laptop says synced", async () => (await syncStatus(laptop)) === "Sync: Synced");
    return `the server has "${there.title}" at revision ${there.rev}; host shown plainly, autocomplete set`;
  });

  await step("sign in on the phone with the same account: the design is there, and nothing is asked to be moved", async () => {
    await phone.page.goto(BASE + "/#/signin", { waitUntil: "load" });
    await phone.page.getByRole("heading", { name: "Sign in", level: 1 }).waitFor({ timeout: 20000 });
    await prepare(phone, false);
    await phone.page.getByLabel("Account server").fill(SERVER);
    await phone.page.getByLabel("Email").fill(ann.email);
    const password = phone.page.getByLabel("Password", { exact: true });
    if ((await password.getAttribute("autocomplete")) !== "current-password") throw new Error("the password field is not current-password");
    await password.fill(ann.password);
    await phone.page.getByRole("button", { name: "Sign in" }).click();
    await phone.page
      .getByRole("button", { name: /^Sync: / })
      .first()
      .waitFor({ state: "attached", timeout: 20000 });
    await prepare(phone);
    await until("the phone has the laptop's design", async () => (await designs(phone)).some((d) => d.id === posterId));
    await phone.page.getByText("Laptop poster").first().waitFor({ timeout: 15000 });
    if (await phone.page.getByRole("dialog", { name: /into your account/ }).count()) throw new Error("the phone asked to move designs it does not have");
    await shot(phone, "signed-in");
    return "listed on the phone";
  });

  await step("a clip and a sound in a design of the laptop reach the phone with it, as themselves", async () => {
    await ready(laptop);
    const made = await laptop.page.evaluate(async () => {
      const { lib, factory, assets } = window.__journey;
      // a red clip of a second, recorded in the page, and a tone of a second as a WAV file
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 90;
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const start = performance.now();
      rec.start(100);
      await new Promise((done) => {
        const tick = () => {
          g.fillStyle = "#e11d48";
          g.fillRect(0, 0, 160, 90);
          if (performance.now() - start < 1000) requestAnimationFrame(tick);
          else done();
        };
        tick();
      });
      await new Promise((r) => {
        rec.onstop = r;
        rec.stop();
      });
      const clip = await assets.addAssetFromFile(new File(chunks, "Red.webm", { type: "video/webm" }));
      const rate = 8000;
      const wav = new DataView(new ArrayBuffer(44 + rate * 2));
      const text = (o, t) => [...t].forEach((ch, i) => wav.setUint8(o + i, ch.charCodeAt(0)));
      text(0, "RIFF");
      wav.setUint32(4, 36 + rate * 2, true);
      text(8, "WAVEfmt ");
      wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true);
      wav.setUint16(22, 1, true);
      wav.setUint32(24, rate, true);
      wav.setUint32(28, rate * 2, true);
      wav.setUint16(32, 2, true);
      wav.setUint16(34, 16, true);
      text(36, "data");
      wav.setUint32(40, rate * 2, true);
      for (let i = 0; i < rate; i++) wav.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 9000, true);
      const sound = await assets.addAssetFromFile(new File([wav.buffer], "Tone.wav", { type: "audio/wav" }));
      const design = await lib.createBlankDesign({ typeId: "custom", width: 800, height: 600, title: "Clip and sound" });
      const open = await lib.getDesignForEditing(design.id);
      open.design.pages[0].elements.push(factory.createVideo({ src: `asset:${clip.id}`, naturalWidth: 160, naturalHeight: 90, duration: 1 }));
      open.design.audio = [{ id: "au_tone", src: `asset:${sound.id}`, name: "Tone", duration: 1, trimStart: 0, trimEnd: 1, startAt: 0 }];
      await lib.saveDesign(open.design, undefined, open.revision);
      return { id: design.id, clip: clip.id, clipSize: clip.size, sound: sound.id, soundSize: sound.size };
    });
    const sent = await syncNow(laptop);
    if (sent.error || sent.problems?.length) throw new Error("the laptop's sync: " + JSON.stringify(sent));
    await syncNow(phone);
    await until("the phone has the design", async () => (await designs(phone)).some((d) => d.id === made.id));
    const got = await phone.page.evaluate(
      async ([clipId, soundId]) => {
        const { assets } = window.__journey;
        const [clip, sound] = [await assets.getAsset(clipId), await assets.getAsset(soundId)];
        return { clip: clip && { kind: clip.kind, mime: clip.mime, size: clip.size }, sound: sound && { kind: sound.kind, mime: sound.mime, size: sound.size } };
      },
      [made.clip, made.sound],
    );
    if (got.clip?.kind !== "video" || got.clip.size !== made.clipSize) throw new Error("the phone's clip: " + JSON.stringify(got.clip));
    if (got.sound?.kind !== "audio" || got.sound.size !== made.soundSize) throw new Error("the phone's sound: " + JSON.stringify(got.sound));
    return `a ${Math.round(made.clipSize / 1024)} KB clip and a ${Math.round(made.soundSize / 1024)} KB sound on the phone`;
  });

  await step("a conflict: the same design edited on the phone and on the laptop while it is offline", async () => {
    await laptop.ctx.setOffline(true);
    await addPages(phone, posterId, 1);
    await until("the server has the phone's edit", async () => {
      await syncNow(phone);
      return (await api(SERVER, "GET", `/api/spaces/${(await api(SERVER, "GET", "/api/me", annToken)).body.user.id}/designs/${posterId}`, annToken)).body.rev === 2;
    });
    await addPages(laptop, posterId, 2);
    await syncNow(laptop);
    await until("the laptop says offline with a change waiting", async () => /^Sync: Offline, 1 change waiting$/.test(await syncStatus(laptop)));
    await shot(laptop, "offline-waiting");
    await laptop.ctx.setOffline(false);
    // (coming online starts a run by itself; Sync now waits for its own)
    let copy = null;
    await until("the laptop makes a copy of its edit", async () => {
      await syncNow(laptop);
      copy = (await designs(laptop)).map((d) => d.title).find((t) => /^Laptop poster \(edited on .+\)$/.test(t)) ?? null;
      return copy !== null;
    });
    await ready(laptop);
    const pages = await laptop.page.evaluate(async (id) => (await window.__journey.lib.getDesign(id)).pages.length, posterId);
    if (pages !== 2) throw new Error("the design under its id has " + pages + " pages, not the phone's 2");
    await syncNow(phone);
    await until("the phone has the copy", async () => (await designs(phone)).some((d) => d.title === copy));
    return `"${copy}" on both devices; the phone's edit kept under the id`;
  });

  /* ---------------- a team ---------------- */
  await step("make a team and an invite link, shown once", async () => {
    await laptop.page.goto(BASE + "/#/", { waitUntil: "load" });
    await laptop.page.getByRole("button", { name: "Create a team" }).click();
    const dialog = laptop.page.getByRole("dialog", { name: "Create a team" });
    await dialog.getByLabel("Team name").fill("Studio");
    await dialog.getByRole("button", { name: "Create team" }).click();
    await laptop.page.getByRole("heading", { name: "Studio", level: 1 }).waitFor({ timeout: 15000 });
    teamId = decodeURIComponent(laptop.page.url().split("#/team/")[1]);
    await laptop.page.getByRole("button", { name: "Make invite" }).click();
    const link = laptop.page.getByLabel("Invite link");
    await link.waitFor({ timeout: 10000 });
    inviteLink = await link.inputValue();
    // the link names the account server, as a live link does, and all of it is after the # (sent to no server)
    const match = /^([^#]*)#\/invite\/([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]+)$/.exec(inviteLink);
    if (!match) throw new Error("the invite link is " + inviteLink);
    if (Buffer.from(match[3], "base64url").toString("utf8") !== SERVER) throw new Error("the invite link names " + Buffer.from(match[3], "base64url").toString("utf8"));
    if (match[1].includes(match[2])) throw new Error("the invite code is before the #");
    await shot(laptop, "team-page");
    return "invite for an editor, naming " + new URL(SERVER).host;
  });

  await step("a second person makes an account from the invite, on the server the link names, and is in the team", async () => {
    // (bob's browser has never been told of a server: only the link names it)
    await bob.page.goto(inviteLink, { waitUntil: "load" });
    await bob.page.getByRole("heading", { name: "Join a team" }).waitFor({ timeout: 20000 });
    const host = new URL(SERVER).host;
    await bob.page.getByText(`The team is on ${host}.`).waitFor({ timeout: 10000 });
    if (await bob.page.getByText(/No account server is set up/).count()) throw new Error("bob is asked to type a server");
    if (await bob.page.getByLabel("Account server").count()) throw new Error("bob is shown a field for the server");
    await bob.page.getByLabel("Your name").fill("Bob");
    await bob.page.getByLabel("Email").fill(bobAccount.email);
    await bob.page.getByLabel("Password", { exact: true }).fill(bobAccount.password);
    await bob.page.getByRole("button", { name: "Create account" }).click();
    await bob.page.getByRole("heading", { name: "Keep your recovery code" }).waitFor({ timeout: 20000 });
    await bob.page.getByRole("button", { name: "I have kept it" }).click();
    await bob.page
      .getByRole("button", { name: /^Sync: / })
      .first()
      .waitFor({ state: "attached", timeout: 20000 });
    await prepare(bob);
    await until("bob's space is the team", async () => (await bob.page.getByLabel("Space").inputValue()) === teamId);
    const team = await api(SERVER, "GET", `/api/teams/${teamId}`, annToken);
    const member = team.body.members.find((m) => m.name === "Bob");
    if (!member || member.role !== "editor") throw new Error("bob is " + JSON.stringify(member));
    // the invite's code went to the account server only, and the link's # to nobody
    const inviteCode = /#\/invite\/([A-Za-z0-9_-]{22})/.exec(inviteLink)[1];
    const leaked = bob.everyUrl.filter((u) => u.includes(inviteCode));
    if (leaked.length) throw new Error("the invite code is in a request's address: " + leaked[0]);
    return "Bob is an editor of Studio; the server was not typed";
  });

  await step("a design of the team reaches the other member", async () => {
    await laptop.page.goto(BASE + "/#/", { waitUntil: "load" });
    if ((await laptop.page.getByLabel("Space").inputValue()) !== teamId) await laptop.page.getByLabel("Space").selectOption(teamId);
    flyerId = await makeDesign(laptop, "Team flyer");
    await syncNow(laptop);
    await syncNow(bob);
    await until("bob has the team's design", async () => (await designs(bob)).some((d) => d.id === flyerId && d.space === teamId));
    await bob.page.getByText("Team flyer").first().waitFor({ timeout: 15000 });
    const listed = await laptop.page.locator("main").innerText();
    if (listed.includes("Laptop poster")) throw new Error("the team's space lists the person's own designs");
    return "listed by space";
  });

  /** opens a design in the editor and goes live with the team from Share */
  const goLive = async (who) => {
    await who.page.goto(BASE + "/#/design/" + encodeURIComponent(flyerId), { waitUntil: "load" });
    await who.page.locator(".cf-workspace").waitFor({ timeout: 30000 });
    await who.page.getByRole("button", { name: "Share" }).click();
    const panel = who.page.getByRole("dialog", { name: "Share design" });
    await panel.getByRole("heading", { name: "Your team" }).waitFor({ timeout: 10000 });
    await panel.getByRole("button", { name: "Edit live with your team" }).click();
    await until(who.name + " is live", async () => (await who.page.evaluate(() => window.__editor.getState().live)) !== null);
    await who.page.keyboard.press("Escape");
  };

  const isLive = (who) => who.page.evaluate(() => !!window.__editor && window.__editor.getState().live === true).catch(() => false);
  /** a box of this colour added in the editor, as a person adds one */
  const addBox = (who, id, color) =>
    who.page.evaluate(
      ([boxId, fill]) => {
        const { actions } = window.__editor.getState();
        const box = {
          id: boxId,
          type: "shape",
          shape: "rect",
          x: 100,
          y: 100,
          width: 200,
          height: 120,
          rotation: 0,
          opacity: 1,
          fill: { type: "solid", color: fill },
          stroke: null,
          radius: 0,
        };
        actions.addElements([box], { center: false, select: false });
      },
      [id, color],
    );
  const hasColor = (design, color) => design.pages.some((p) => p.elements.some((e) => e.fill && e.fill.color === color));

  await step("a member's edit made before joining the team's live room is kept as a copy, says so, and reaches the owner", async () => {
    // the owner edits live; the member opens the design and edits it before pressing Edit live (the server refuses writes meanwhile)
    await goLive(laptop);
    await bob.page.goto(BASE + "/#/design/" + encodeURIComponent(flyerId), { waitUntil: "load" });
    await bob.page.locator(".cf-workspace").waitFor({ timeout: 30000 });
    await addBox(bob, "b", "#1f6feb");
    await until("bob's edit is saved", async () => (await bob.page.evaluate(() => window.__editor.getState().saveState)) === "saved");
    // closed and synced, the edit waits for the room: the status says so, not "Synced"
    await bob.page.goto(BASE + "/#/", { waitUntil: "load" });
    await bob.page.getByText("Team flyer").first().waitFor({ timeout: 15000 });
    await syncNow(bob);
    await until("bob's status says the change waits for the live editing", async () => (await syncStatus(bob)) === "Sync: 1 change waiting: the design is being edited live");
    await shot(bob, "waiting-live");
    // opened again, Edit live keeps the edit as a copy and joins the room with the team's version
    await bob.page.goto(BASE + "/#/design/" + encodeURIComponent(flyerId), { waitUntil: "load" });
    await bob.page.locator(".cf-workspace").waitFor({ timeout: 30000 });
    await bob.page.getByRole("button", { name: "Share" }).click();
    const panel = bob.page.getByRole("dialog", { name: "Share design" });
    await panel.getByRole("button", { name: "Edit live with your team" }).click();
    const said = panel.getByText(/^Your changes made before joining are kept as “Team flyer \(edited on .+\)”\. You are now editing the team's version live\.$/);
    await said.waitFor({ timeout: 20000 });
    await until("bob is live", () => isLive(bob));
    // while live with the team the panel offers no link session, and the top bar shows Live
    if (await panel.getByRole("button", { name: "Start live session" }).count()) throw new Error("a link session is offered while live with the team");
    await shot(bob, "kept-copy");
    await bob.page.keyboard.press("Escape");
    await bob.page.locator(".cf-live-badge").first().waitFor({ timeout: 10000 });
    await until(
      "bob's editor has the room's version",
      async () => !(await bob.page.evaluate(() => window.__editor.getState().design.pages.some((p) => p.elements.some((e) => e.id === "b")))),
    );
    // the copy went to the team, with the edit, and the owner gets it
    let copy = null;
    await until("the team has bob's copy", async () => {
      const changes = await api(SERVER, "GET", `/api/spaces/${teamId}/changes?since=0`, annToken);
      copy = changes.body.designs.find((d) => /^Team flyer \(edited on .+\)$/.test(d.title)) ?? null;
      return copy !== null;
    });
    const there = await api(SERVER, "GET", `/api/spaces/${teamId}/designs/${copy.id}`, annToken);
    if (!hasColor(there.body.design, "#1f6feb")) throw new Error("the copy on the server does not have bob's edit");
    await until("the owner has bob's copy", async () => {
      await syncNow(laptop);
      return (await designs(laptop)).some((d) => d.id === copy.id);
    });
    return `"${copy.title}" on the server and on the owner's laptop; bob live with the team's version`;
  });

  await step("both edit the team's design live from Share, without any link, joined with their sessions", async () => {
    if (!(await isLive(laptop))) await goLive(laptop);
    if (!(await isLive(bob))) await goLive(bob);
    await laptop.page.evaluate(() => {
      const { actions } = window.__editor.getState();
      actions.addElements(
        [
          {
            id: "x",
            type: "shape",
            shape: "rect",
            x: 100,
            y: 100,
            width: 200,
            height: 120,
            rotation: 0,
            opacity: 1,
            fill: { type: "solid", color: "#d9222a" },
            stroke: null,
            radius: 0,
          },
        ],
        {
          center: false,
          select: false,
        },
      );
    });
    await until("bob sees the laptop's box", async () =>
      bob.page.evaluate(() => window.__editor.getState().design.pages[0].elements.some((e) => e.fill && e.fill.color === "#d9222a")),
    );
    // each sees the other under the name of their account (neither typed a name for live editing), not as "Guest 1"
    const peopleOf = (who) =>
      who.page.evaluate(async () => {
        const path = "/src/editor/live/presence.ts";
        const loaded = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((name) => new URL(name).pathname === path)
          .pop();
        const presence = await import(loaded ?? path);
        return presence.usePresence.getState().people.map((p) => p.name);
      });
    await until("the laptop sees Bob by name", async () => JSON.stringify(await peopleOf(laptop)) === JSON.stringify(["Bob"]));
    await until("bob sees Ann by name", async () => JSON.stringify(await peopleOf(bob)) === JSON.stringify(["Ann"]));
    // and each sees themselves in the top bar under the name of their account too, with its initials, not as "Guest 1 (you)" (B4)
    const selfOf = async (who) => {
      const me = who.page.getByRole("list", { name: "2 people here" }).getByRole("listitem").first();
      return { name: await me.getAttribute("title"), initials: (await me.locator(".cf-live-people__initials").textContent()).trim() };
    };
    await until("the laptop sees itself as Ann", async () => JSON.stringify(await selfOf(laptop).catch(() => null)) === JSON.stringify({ name: "Ann (you)", initials: "A" }));
    await until("bob sees himself as Bob", async () => JSON.stringify(await selfOf(bob).catch(() => null)) === JSON.stringify({ name: "Bob (you)", initials: "B" }));
    await shot(bob, "live-with-team");
    const ws = [...laptop.sockets, ...bob.sockets].filter((s) => s.url.startsWith(SERVER.replace(/^http/, "ws")));
    if (!ws.length) throw new Error("no socket to the server");
    for (const s of ws) {
      if (/session|token|key=/i.test(s.url)) throw new Error("a secret in a socket's address: " + s.url);
      const first = JSON.parse(s.first);
      if (first.t !== "join" || typeof first.session !== "string" || "key" in first) throw new Error("the join was " + s.first.slice(0, 120));
    }
    return `${ws.length} sockets, each joined with a session and no key`;
  });

  await step("a member lowered to viewer is sent out and comes back read-only", async () => {
    const team = await api(SERVER, "GET", `/api/teams/${teamId}`, annToken);
    const bobId = team.body.members.find((m) => m.name === "Bob").id;
    const changed = await api(SERVER, "PUT", `/api/teams/${teamId}/members/${bobId}`, annToken, { role: "viewer" });
    if (changed.status !== 200) throw new Error("the role was not changed: " + changed.status);
    await until("bob's editor is read-only", async () => (await bob.page.evaluate(() => window.__editor.getState().mode)) === "view", 30000);
    await shot(bob, "viewer");
    return "read-only";
  });

  await step("a removed member keeps their copy as their own, and the team is gone from their switcher", async () => {
    const team = await api(SERVER, "GET", `/api/teams/${teamId}`, annToken);
    const bobId = team.body.members.find((m) => m.name === "Bob").id;
    await laptop.page.goto(BASE + "/#/team/" + encodeURIComponent(teamId), { waitUntil: "load" });
    await laptop.page.getByRole("button", { name: "Remove Bob" }).click();
    await laptop.page.getByRole("dialog").getByRole("button", { name: "Remove Bob" }).click();
    await until("bob is no longer in the team", async () => !(await api(SERVER, "GET", `/api/teams/${teamId}`, annToken)).body.members.some((m) => m.id === bobId));
    await bob.page.goto(BASE + "/#/", { waitUntil: "load" });
    await syncNow(bob);
    await until("bob's copy is his own", async () => (await designs(bob)).some((d) => d.id === flyerId && d.space === null));
    const options = await bob.page.getByLabel("Space").locator("option").allInnerTexts();
    if (options.some((o) => o.includes("Studio"))) throw new Error("the switcher still lists the team");
    return "copy kept, team gone";
  });

  /* ---------------- signing out, the server away ---------------- */
  await step("signing out on the phone takes the account's designs off the phone", async () => {
    await phone.page.goto(BASE + "/#/", { waitUntil: "load" });
    const menu = await accountMenu(phone);
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    const dialog = phone.page.getByRole("dialog", { name: "Sign out" });
    await dialog.getByRole("button", { name: "Sign out" }).click();
    await until("the phone is signed out", async () => (await designs(phone)).length === 0);
    const menuAfter = await accountMenu(phone);
    await menuAfter.getByRole("menuitem", { name: "Sign in" }).waitFor({ timeout: 5000 });
    await phone.page.keyboard.press("Escape");
    return "no designs left on the phone";
  });

  await step("the server stops: the laptop says offline with what waits, and sends it when the server is back", async () => {
    await laptop.page.goto(BASE + "/#/", { waitUntil: "load" });
    await laptop.page.getByLabel("Space").selectOption({ label: "Your designs" });
    await server.stop();
    await addPages(laptop, posterId, 1);
    await syncNow(laptop);
    await until("offline with a change waiting", async () => /^Sync: Offline, 1 change waiting$/.test(await syncStatus(laptop)));
    await shot(laptop, "server-stopped");
    server = await startServer(port);
    await laptop.page
      .getByRole("button", { name: /^Sync: / })
      .first()
      .click();
    await laptop.page.getByRole("button", { name: "Sync now" }).click();
    await until("synced again", async () => (await syncStatus(laptop)) === "Sync: Synced");
    await laptop.page.keyboard.press("Escape");
    const there = await api(SERVER, "GET", `/api/spaces/${(await api(SERVER, "GET", "/api/me", annToken)).body.user.id}/designs/${posterId}`, annToken);
    if (there.body.design.pages.length !== 3) throw new Error("the server's design has " + there.body.design.pages.length + " pages");
    return "sent after the restart";
  });
  // a step that failed with the server stopped would fail every step after it too, for no fault of theirs
  if (!server.running) server = await startServer(port);

  /* ---------------- Hindi ---------------- */
  await step("signing in and the account menu in Hindi, with the words of the catalog", async () => {
    const hindi = await open("hindi", { language: "hi" });
    await hindi.page.goto(BASE + "/#/signin", { waitUntil: "load" });
    const words = await hindi.page.evaluate(async () => {
      const { cloud } = await import("/src/i18n/hi/cloud.ts");
      return {
        title: cloud.signIn.title,
        server: cloud.server.label,
        email: cloud.signIn.email,
        password: cloud.signIn.password,
        submit: cloud.signIn.submit,
        settings: cloud.menu.settings,
        signOut: cloud.menu.signOut,
        status: cloud.status.label + ": " + cloud.status.synced,
        menu: (await import("/src/i18n/hi/dashboard.ts")).dashboard.account.menuLabel,
      };
    });
    await hindi.page.getByRole("heading", { name: words.title, level: 1 }).waitFor({ timeout: 20000 });
    await hindi.page.getByLabel(words.server).fill(SERVER);
    await hindi.page.getByLabel(words.email).fill(ann.email);
    await hindi.page.getByLabel(words.password, { exact: true }).fill(ann.password);
    await hindi.page.getByRole("button", { name: words.submit }).click();
    await until("synced, said in Hindi", async () => (await hindi.page.getByRole("button", { name: words.status }).count()) > 0, 30000);
    const menu = await accountMenu(hindi, words.menu);
    await menu.getByRole("menuitem", { name: words.settings }).waitFor({ timeout: 5000 });
    await menu.getByRole("menuitem", { name: words.signOut }).waitFor({ timeout: 5000 });
    await shot(hindi, "hindi-menu");
    await hindi.page.keyboard.press("Escape");
    await hindi.ctx.close();
    return `"${words.title}", "${words.status}"`;
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
