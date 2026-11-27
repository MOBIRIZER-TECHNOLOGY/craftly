/*
 * The sounds of a design, as a person uses them in Chrome on the dev server: two tones written here as WAV files (440 Hz and
 * 880 Hz, 2 s each) are uploaded and put on the timeline, one moved after the other, and then heard where they should be: in the
 * timeline's Play, in Present, and in an MP4 download, read back from its file by the pitch of its sound. Each step is read back
 * from the design, the page or the file:
 *
 *   upload     two sound files in Uploads: a card each, with its length
 *   add        a card's click puts the sound on the timeline, chosen, and opens the timeline
 *   rows       two sounds at once take two rows; one moved after the other (the arrow keys) shares the first row
 *   controls   volume, over and over, and Delete with Undo
 *   play       the timeline's Play plays the first sound at the playhead's moment and not yet the second
 *   present    Present plays it from the first page's start, and leaving stops it
 *   download   the MP4 holds 440 Hz at 0.5 s, 880 Hz at 3 s and silence at the end
 *   reload     the sounds are still there
 *
 * The sound players are the <audio> elements the page makes, written down as they are made.
 */
const fs = require("node:fs");
const path = require("node:path");
const { launch, outDir, lacksMedia, BASE } = require("./lib.cjs");

const OUT = outDir("audio");
const results = [];
const logs = [];
let shotN = 0;

/** A WAV file of a sine tone: mono, 16-bit, 22,050 samples a second. */
function tone(file, hz, seconds) {
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
  fs.writeFileSync(file, buf);
  return file;
}

(async () => {
  const low = tone(path.join(OUT, "Tone 440.wav"), 440, 2);
  const high = tone(path.join(OUT, "Tone 880.wav"), 880, 2);
  const browser = await launch();
  const lacking = await lacksMedia(browser);
  if (lacking) {
    console.log(`SKIP audio.cjs  (${lacking}; Safari has them)`);
    await browser.close();
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  const shot = (name) => page.screenshot({ path: OUT + String(++shotN).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      results.push("PASS " + name + (r ? "  " + r : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30)).catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const audio = () => page.evaluate(() => window.__editor.getState().design.audio ?? []);
  /** Every <audio> the page has made that has a sound in it: paused, where, how loud (the app's sound players: src/render/soundTracks.ts). */
  const players = () =>
    page.evaluate(() =>
      (window.__audios ?? []).filter((a) => a.src).map((a) => ({ paused: a.paused, at: Math.round(a.currentTime * 10) / 10, volume: Math.round(a.volume * 100) / 100 })),
    );
  const playing = async () => (await players()).filter((p) => !p.paused);
  const bar = (name) => page.locator(".cf-tl__sound", { hasText: name });

  await step("setup: a new presentation, the Uploads tab", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.getByRole("tab", { name: "Uploads", exact: true }).click();
    const length = await page.evaluate(() => window.__editor.getState().design.pages[0].duration ?? 5);
    return `a page of ${length} s`;
  });

  await step("upload: two sound files, a card each with its length", async () => {
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles([low, high]);
    for (const name of ["Tone 440", "Tone 880"]) {
      const card = page.getByRole("button", { name: `Add ${name} to the timeline` });
      await card.waitFor({ timeout: 15000 });
      await card.getByText("0:02").waitFor({ timeout: 10000 });
    }
    await shot("uploads");
    return "Tone 440 0:02, Tone 880 0:02";
  });

  await step("add: a click puts a sound on the timeline, chosen, and opens the timeline", async () => {
    await page.getByRole("button", { name: "Add Tone 440 to the timeline" }).click();
    await bar("Tone 440").waitFor({ timeout: 10000 });
    await page.getByRole("group", { name: "Sound: Tone 440" }).waitFor({ timeout: 5000 });
    const [t] = await audio();
    if (t.startAt !== 0 || Math.abs(t.duration - 2) > 0.05 || t.trimEnd !== t.duration || t.src.indexOf("asset:") !== 0) throw new Error(JSON.stringify(t));
    return `${t.name}: ${t.duration.toFixed(2)} s from 0 s`;
  });

  await step("rows: two sounds at once take two rows; one moved after the other shares the first", async () => {
    await page.getByRole("button", { name: "Add Tone 880 to the timeline" }).click();
    await bar("Tone 880").waitFor({ timeout: 10000 });
    const tops = async () => [await bar("Tone 440").evaluate((e) => e.style.top), await bar("Tone 880").evaluate((e) => e.style.top)];
    const before = await tops();
    if (before[0] === before[1]) throw new Error("both on one row while they play at once: " + before);
    const body = page.getByRole("slider", { name: "When the sound Tone 880 starts" });
    await body.focus();
    for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowRight");
    const t = (await audio())[1];
    if (Math.abs(t.startAt - 2.5) > 0.001) throw new Error("starts at " + t.startAt);
    const after = await tops();
    if (after[0] !== after[1]) throw new Error("not on one row once one follows the other: " + after);
    await shot("rows");
    return `rows ${before.join(" / ")}, then ${after.join(" / ")}; Tone 880 from ${t.startAt} s`;
  });

  await step("controls: volume, over and over, and Delete with Undo", async () => {
    const group = page.getByRole("group", { name: "Sound: Tone 880" });
    await group.getByRole("button", { name: "Volume and fades" }).click();
    const volume = page.getByRole("dialog", { name: "Volume and fades" }).getByRole("spinbutton", { name: "Volume (%) value" });
    await volume.fill("50");
    await volume.press("Enter");
    await page.keyboard.press("Escape");
    await group.getByRole("button", { name: "Over and over" }).click();
    let t = (await audio())[1];
    if (t.volume !== 0.5 || t.loop !== true) throw new Error(JSON.stringify(t));
    await group.getByRole("button", { name: "Over and over" }).click();
    await page.getByRole("slider", { name: "When the sound Tone 880 starts" }).focus();
    await page.keyboard.press("Delete");
    if ((await audio()).length !== 1) throw new Error("not removed");
    await page.keyboard.press("Control+z");
    t = (await audio())[1];
    if (!t || t.loop || t.volume !== 0.5) throw new Error("undo gave back " + JSON.stringify(t));
    return "50 %, over and over on and off, removed and given back";
  });

  await step("play: the timeline's Play plays the first sound at the playhead's moment, the second not yet", async () => {
    await page.getByRole("button", { name: "Play from the playhead" }).click();
    await wait(900);
    const now = await playing();
    await page.getByRole("button", { name: "Pause" }).click();
    // one sound playing (the second starts at 2.5 s), at about 0.9 s into it
    if (now.length !== 1 || !(now[0].at > 0.4 && now[0].at < 1.4)) throw new Error(JSON.stringify(now));
    const after = await playing();
    if (after.length) throw new Error("still playing after Pause: " + JSON.stringify(after));
    return `one sound at ${now[0].at} s; Pause stops it`;
  });

  await step("present: the show plays the first sound from the first page's start, and leaving stops it", async () => {
    await page.getByRole("button", { name: "Present", exact: true }).click();
    await page.locator(".cf-present").waitFor({ timeout: 10000 });
    await wait(800);
    const now = await playing();
    if (now.length !== 1 || !(now[0].at > 0.3 && now[0].at < 1.5)) throw new Error(JSON.stringify(now));
    await page.keyboard.press("Escape");
    await page.locator(".cf-present").waitFor({ state: "detached", timeout: 5000 });
    const after = await playing();
    if (after.length) throw new Error("still playing after the show: " + JSON.stringify(after));
    return `one sound at ${now[0].at} s in the show; stopped on leaving`;
  });

  await step("download: the MP4 holds 440 Hz at 0.5 s, 880 Hz at 3 s and silence at the end", async () => {
    const dl = page.locator(".cf-dl");
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await dl.waitFor({ timeout: 5000 });
    await wait(300);
    await page.getByLabel("File type").click();
    await page
      .getByRole("option", { name: /^Video/ })
      .first()
      .click();
    await wait(300);
    const [file] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), dl.getByRole("button", { name: "Download", exact: true }).click()]);
    const buf = fs.readFileSync(await file.path());
    await page.keyboard.press("Escape");
    const name = file.suggestedFilename();
    if (!name.endsWith(".mp4") || buf.subarray(4, 8).toString("latin1") !== "ftyp") throw new Error("not an MP4: " + name);
    const heard = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const sound = await new AudioContext().decodeAudioData(bytes.buffer.slice(0));
      const pcm = sound.getChannelData(0);
      const around = (t) => [Math.floor((t - 0.1) * sound.sampleRate), Math.floor((t + 0.1) * sound.sampleRate)];
      // the pitch around `t`, from how often the sound crosses zero, and how loud it is there
      const pitch = (t) => {
        const [from, to] = around(t);
        let crossings = 0;
        for (let i = from + 1; i < to; i++) if (pcm[i - 1] < 0 !== pcm[i] < 0) crossings++;
        return Math.round(crossings / 2 / 0.2);
      };
      const loud = (t) => {
        const [from, to] = around(t);
        let sum = 0;
        for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
        return Math.round(Math.sqrt(sum / (to - from)) * 1000) / 1000;
      };
      return { seconds: Math.round(sound.duration * 10) / 10, pitches: [pitch(0.5), pitch(3)], loud: [loud(0.5), loud(3), loud(sound.duration - 0.3)] };
    }, buf.toString("base64"));
    const near = (hz, want) => Math.abs(hz - want) < want * 0.03;
    if (!near(heard.pitches[0], 440) || !near(heard.pitches[1], 880)) throw new Error("pitches " + heard.pitches.join(" Hz, ") + " Hz");
    // the second at half its volume: about half as loud; nothing at the end
    if (!(heard.loud[1] < heard.loud[0] * 0.7 && heard.loud[1] > heard.loud[0] * 0.3)) throw new Error("loudness " + heard.loud.join(", "));
    if (!(heard.loud[2] < 0.005)) throw new Error("not silent at the end: " + heard.loud[2]);
    return `${name}, ${heard.seconds} s: ${heard.pitches.join(" Hz then ")} Hz, loudness ${heard.loud.join(", ")}`;
  });

  await step("reload: the sounds are still there, on the timeline", async () => {
    await wait(1500); // the autosave
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    const tracks = await audio();
    if (tracks.length !== 2 || tracks[1].startAt !== 2.5 || tracks[1].volume !== 0.5) throw new Error(JSON.stringify(tracks));
    if (!(await page.locator(".cf-tl").count())) await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await bar("Tone 880").waitFor({ timeout: 10000 });
    await shot("reloaded");
    return tracks.map((t) => `${t.name} from ${t.startAt} s`).join(", ");
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
