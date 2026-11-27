/*
 * Clips and sounds in a shared design (docs/COLLABORATION.md, "Clips and sounds"), against the real server: one person puts a clip
 * (a red WebM recorded in the page) and a sound (a WAV tone) in a design and starts a live session; a second person opens the edit
 * link and gets both: the clip's own picture on the page where an empty box was, and the sound playing in the timeline's Play. The
 * server keeps them as files beside the room.
 *
 * The server is the real one (`npm run server:build`, then dist-server/live.mjs, started here with a folder of its own); the editor
 * is whatever BASE serves, which has to expose the store (the dev server does).
 */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { launch, outDir, lacksMedia, BASE } = require("./lib.cjs");

const OUT = outDir("liveclips");
const ROOT = path.resolve(__dirname, "..");
const results = [];
const logs = [];
let shotN = 0;

/** A WAV file of a sine tone: mono, 16-bit, 22,050 samples a second. */
function tone(hz, seconds) {
  const rate = 22050;
  const n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12000), 44 + i * 2);
  return buf;
}

/** starts the server for shared designs and gives its address and its folder, which is thrown away at the end */
async function startServer() {
  const built = spawnSync("npm", ["run", "server:build"], { cwd: ROOT, shell: true, encoding: "utf8" });
  if (built.status !== 0) throw new Error("the server did not build: " + (built.stderr || built.stdout).slice(0, 400));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "craftly-liveclips-"));
  const child = spawn(process.execPath, [path.join(ROOT, "dist-server", "live.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DATA_DIR: data, ALLOW_ORIGIN: "*" },
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
    data,
    stop: () => {
      child.removeAllListeners("exit");
      child.kill();
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

(async () => {
  const browser = await launch();
  const lacking = await lacksMedia(browser);
  if (lacking) {
    console.log(`SKIP liveclips.cjs  (${lacking}; Safari has them)`);
    await browser.close();
    return;
  }
  // (started after the check: a server left running would keep this script from ending)
  const server = await startServer();
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    // the <audio> elements the app makes for the sounds are never put in the page: they are written down as they are made
    await page.addInitScript(() => {
      const make = Document.prototype.createElement;
      window.__audios = [];
      Document.prototype.createElement = function (tag, options) {
        const el = make.call(this, tag, options);
        if (String(tag).toLowerCase() === "audio") window.__audios.push(el);
        return el;
      };
    });
    page.on("console", (m) => {
      if (m.type() === "error" && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) logs.push(`${name} console.error: ` + m.text().slice(0, 240));
    });
    page.on("pageerror", (e) => logs.push(`${name} PAGEERROR ` + e.message.slice(0, 240)));
    if (process.env.DEBUG_MEDIA) page.on("response", (r) => r.url().includes("/media/") && console.log(name, r.request().method(), r.status(), r.url().slice(-40)));
    return { page, name };
  };
  const [ann, bob] = [await open("ann"), await open("bob")];
  const shot = (who, name) => who.page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + who.name + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      await shot(bob, "FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
    }
  };
  /** "red", "dark" (the empty box of a clip that is not here) or something else, at a point of a person's screen */
  const colourAt = async (who, box) => {
    const png = await who.page.screenshot({ clip: { x: box.x - 6, y: box.y - 6, width: 12, height: 12 } });
    return who.page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let r = 0;
        let gr = 0;
        let b = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i];
          gr += d[i + 1];
          b += d[i + 2];
        }
        const n = d.length / 4;
        [r, gr, b] = [r / n, gr / n, b / n];
        return r > 150 && r - b > 60 ? "red" : r < 70 && gr < 70 && b < 80 ? "dark" : `other(${Math.round(r)},${Math.round(gr)},${Math.round(b)})`;
      },
      [...png],
    );
  };
  /** the middle of the clip on a person's screen */
  const middleOfClip = (who) =>
    who.page.evaluate(() => {
      const s = window.__editor.getState();
      const el = s.design.pages[0].elements.find((e) => e.type === "video");
      const f = document.querySelector(".cf-pageframe").getBoundingClientRect();
      return { x: f.x + (el.x + el.width * 0.25) * s.zoom, y: f.y + (el.y + el.height * 0.75) * s.zoom };
    });
  let editLink = "";

  await step("Ann puts a clip and a sound in a new presentation", async () => {
    const page = ann.page;
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    // a red clip of a second and a half, recorded in the page
    const webm = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const start = performance.now();
      rec.start(100);
      await new Promise((done) => {
        const tick = () => {
          g.fillStyle = "#e11d48";
          g.fillRect(0, 0, 320, 180);
          if (performance.now() - start < 1500) requestAnimationFrame(tick);
          else done();
        };
        tick();
      });
      await new Promise((r) => {
        rec.onstop = r;
        rec.stop();
      });
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    });
    await page.getByRole("tab", { name: "Uploads", exact: true }).click();
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles([
      { name: "Red.webm", mimeType: "video/webm", buffer: Buffer.from(webm, "base64") },
      { name: "Tone.wav", mimeType: "audio/wav", buffer: tone(440, 3) },
    ]);
    await page.getByRole("button", { name: "Add Tone to the timeline" }).click();
    await page.getByRole("button", { name: "Add Red to the page" }).click();
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.some((e) => e.type === "video"), null, { timeout: 15000 });
    const d = await page.evaluate(() => {
      const s = window.__editor.getState();
      return { clips: s.design.pages[0].elements.filter((e) => e.type === "video").length, sounds: (s.design.audio ?? []).length };
    });
    if (d.clips !== 1 || d.sounds !== 1) throw new Error(JSON.stringify(d));
    return "one clip, one sound";
  });

  await step("Ann starts a live session; the server keeps the clip and the sound as files beside the room", async () => {
    const page = ann.page;
    await page.getByRole("button", { name: "Share" }).click();
    const panel = page.getByRole("dialog", { name: "Share design" });
    await panel.getByRole("heading", { name: "Work together" }).waitFor({ timeout: 5000 });
    await panel.getByRole("textbox", { name: "Server address" }).fill(server.address);
    await panel.getByRole("button", { name: "Start live session" }).click();
    await panel.getByRole("textbox", { name: "Edit link" }).waitFor({ timeout: 10000 });
    editLink = await panel.getByRole("textbox", { name: "Edit link" }).inputValue();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector(".cf-live-badge")?.textContent === "Live", null, { timeout: 15000 });
    // the files come in the background: the room's folder of clips gets one for each
    let files = [];
    for (let i = 0; i < 60 && files.length < 2; i++) {
      const folders = fs.readdirSync(server.data).filter((n) => n.endsWith(".media"));
      files = folders.length ? fs.readdirSync(path.join(server.data, folders[0])).filter((n) => n.endsWith(".bin")) : [];
      if (files.length < 2) await ann.page.waitForTimeout(250);
    }
    if (files.length !== 2) throw new Error(`${files.length} files in the room's folder of clips`);
    const sizes = files
      .map(
        (n) =>
          fs.statSync(
            path.join(
              server.data,
              fs.readdirSync(server.data).find((f) => f.endsWith(".media")),
              n,
            ),
          ).size,
      )
      .sort((a, b) => a - b);
    return `${sizes.map((s) => Math.round(s / 1024) + " KB").join(" and ")} on the server`;
  });

  await step("Bob joins by the edit link and sees the clip itself where an empty box would be", async () => {
    const page = bob.page;
    await page.goto(editLink, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Join this shared design?" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await page.waitForURL(/#\/design\//, { timeout: 30000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.some((e) => e.type === "video"), null, { timeout: 20000 });
    let colour = "";
    for (let i = 0; i < 60 && colour !== "red"; i++) {
      colour = await colourAt(bob, await middleOfClip(bob));
      if (colour !== "red") await page.waitForTimeout(250);
    }
    await shot(bob, "clip");
    if (colour !== "red") {
      const why = await page.evaluate(async () => {
        const s = window.__editor.getState();
        const el = s.design.pages[0].elements.find((e) => e.type === "video");
        const ids = await new Promise((ok) => {
          const req = indexedDB.open("craftly");
          req.onsuccess = () => {
            const all = req.result.transaction("assets").objectStore("assets").getAllKeys();
            all.onsuccess = () => ok(all.result);
          };
          req.onerror = () => ok("no db");
        });
        return { src: el.src, uploads: ids };
      });
      throw new Error("the clip is " + colour + " on Bob's page: " + JSON.stringify(why));
    }
    return "red, the clip's own frame";
  });

  await step("Bob hears the sound in the timeline's Play", async () => {
    const page = bob.page;
    const sounds = await page.evaluate(() => (window.__editor.getState().design.audio ?? []).map((t) => t.name));
    if (sounds.join() !== "Tone") throw new Error("Bob's design has the sounds " + JSON.stringify(sounds));
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await page.getByRole("button", { name: "Play from the playhead" }).click();
    let playing = [];
    for (let i = 0; i < 40 && !playing.length; i++) {
      await page.waitForTimeout(250);
      playing = await page.evaluate(() => (window.__audios ?? []).filter((a) => a.src && !a.paused).map((a) => Math.round(a.currentTime * 10) / 10));
      // a sound that came after Play was pressed is played from the next moment on
    }
    await page
      .getByRole("button", { name: "Pause" })
      .click()
      .catch(() => undefined);
    if (!playing.length) throw new Error("no sound plays on Bob's side");
    return `a sound playing at ${playing[0]} s`;
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
