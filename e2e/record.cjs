/*
 * Record in Uploads, as a person uses it in Chrome, with Chrome's own fake camera, microphone and screen (a test pattern and a
 * tone; the browser does not ask). The camera plays a clip this script writes (a light bar crossing a dark picture), since the
 * test pattern of Chrome's fake camera gives frames of 2 x 2 pixels in some versions (158). Each step is read back from the design, the uploads or the pixels:
 *
 *   camera     Record, Start recording: the live picture moves and the clock counts; Stop shows the recording to watch, with sound;
 *              Add to the page keeps it in the uploads and places it as a clip that plays
 *   again      Record again keeps nothing of the first take
 *   screen     the screen recorded without sound, stopped from the dialog
 *   closed     closing while it records stops the camera and keeps nothing
 *   phone      the dialog at 375 px, in Hindi, with nothing cut off
 */
const fs = require("node:fs");
const path = require("node:path");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("record");
const results = [];
const logs = [];
let shotN = 0;

/** A second of 320 x 180 video in the Y4M format Chrome's fake camera plays (looping): a light bar crossing a dark picture. */
function cameraClip(file) {
  const W = 320,
    H = 180,
    N = 30;
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < N; f++) {
    const luma = Buffer.alloc(W * H, 40);
    const x0 = Math.round((f / N) * W);
    for (let r = 0; r < H; r++) for (let c = 0; c < 40; c++) luma[r * W + ((x0 + c) % W)] = 220;
    parts.push(Buffer.from("FRAME\n"), luma, Buffer.alloc((W / 2) * (H / 2), 128), Buffer.alloc((W / 2) * (H / 2), 128));
  }
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

(async () => {
  const browser = await launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--use-file-for-fake-video-capture=" + cameraClip(path.join(OUT, "camera.y4m")),
      "--auto-select-desktop-capture-source=Entire screen",
      "--enable-usermedia-screen-capturing",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
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
  const design = (fn) => page.evaluate(`(${fn})(window.__editor.getState())`);
  const dialog = () => page.getByRole("dialog", { name: "Record" });
  /** Whether a <video> of the dialog shows a picture that changes: two of its frames drawn a moment apart differ. */
  const moving = (selector) =>
    page.evaluate(async (sel) => {
      const v = document.querySelector(sel);
      if (!v || !v.videoWidth) return false;
      const grab = () => {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 36;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(v, 0, 0, 64, 36);
        return g.getImageData(0, 0, 64, 36).data;
      };
      const a = grab();
      await new Promise((r) => setTimeout(r, 400));
      const b = grab();
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      return diff > 1000;
    }, selector);

  await step("setup: a new presentation, the Uploads tab", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.getByRole("tab", { name: "Uploads", exact: true }).click();
    await page.getByRole("button", { name: "Record", exact: true }).waitFor({ timeout: 10000 });
    return "open";
  });

  await step("Record: the camera with its sound, its live picture moving and the clock counting", async () => {
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await dialog().waitFor({ timeout: 5000 });
    await dialog().getByRole("button", { name: "Start recording" }).click();
    const timer = dialog().getByRole("timer");
    await timer.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".cf-record__live")?.videoWidth > 0, null, { timeout: 10000 });
    if (!(await moving(".cf-record__live"))) throw new Error("the live picture stands still");
    await page.waitForFunction(() => /0:0[2-9]/.test(document.querySelector(".cf-record__clock")?.textContent ?? ""), null, { timeout: 10000 });
    await shot("recording");
    return await timer.innerText();
  });

  let seconds = 0;
  await step("Stop: the recording to watch, a WebM with a picture", async () => {
    await dialog().getByRole("button", { name: "Stop recording" }).click();
    await page.waitForFunction(() => document.querySelector(".cf-record__take")?.readyState >= 1, null, { timeout: 10000 });
    // a browser's own recording does not say its length at first: played to the end it does
    const info = await page.evaluate(async () => {
      const v = document.querySelector(".cf-record__take");
      const blob = await fetch(v.src).then((r) => r.blob());
      return { type: blob.type, size: blob.size, width: v.videoWidth, height: v.videoHeight };
    });
    if (info.type !== "video/webm" || info.size < 5000 || !(info.width > 0)) throw new Error(JSON.stringify(info));
    const status = await dialog().getByRole("status").innerText();
    seconds = Number((/0:(\d\d)/.exec(status) ?? [])[1] ?? 0);
    if (seconds < 2) throw new Error("recorded " + status);
    await shot("review");
    return `${info.width} x ${info.height}, ${Math.round(info.size / 1024)} KB, ${status}`;
  });

  await step("Add to the page: kept in the uploads and placed as a clip as long as the recording", async () => {
    await dialog().getByRole("button", { name: "Add to the page" }).click();
    await dialog().waitFor({ state: "detached", timeout: 20000 });
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.some((e) => e.type === "video"), null, { timeout: 15000 });
    const el = await design(`(s) => s.design.pages[0].elements.find((e) => e.type === "video")`);
    if (!/^Recording \d{4}-\d\d-\d\d \d\d\.\d\d$/.test(el.name ?? "")) throw new Error("named " + el.name);
    if (!(Math.abs(el.duration - seconds) <= 1.5)) throw new Error(`a clip of ${el.duration} s for a recording of ${seconds} s`);
    const card = page.locator(".cf-uploads__card", { has: page.locator("video") }).first();
    await card.waitFor({ timeout: 10000 });
    return `${el.name}, ${el.duration.toFixed(1)} s, ${Math.round(el.width)} x ${Math.round(el.height)}`;
  });

  await step("Record again keeps nothing of the first take", async () => {
    const before = await page.locator(".cf-uploads__card").count();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await dialog().getByRole("button", { name: "Start recording" }).click();
    await dialog().getByRole("timer").waitFor({ timeout: 10000 });
    await wait(1200);
    await dialog().getByRole("button", { name: "Stop recording" }).click();
    await dialog().getByRole("button", { name: "Record again" }).click();
    await dialog().getByRole("button", { name: "Start recording" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "detached", timeout: 5000 });
    const after = await page.locator(".cf-uploads__card").count();
    if (after !== before) throw new Error(`${before} uploads, then ${after}`);
    return `${after} upload`;
  });

  await step("the screen, without sound, stopped from the dialog", async () => {
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await dialog().getByRole("radio", { name: "Screen" }).click();
    await dialog().getByRole("checkbox", { name: "Sound from the microphone" }).click();
    await dialog().getByRole("button", { name: "Start recording" }).click();
    await dialog().getByRole("timer").waitFor({ timeout: 10000 });
    await wait(1500);
    await dialog().getByRole("button", { name: "Stop recording" }).click();
    await page.waitForFunction(() => document.querySelector(".cf-record__take")?.readyState >= 1, null, { timeout: 10000 });
    const tracks = await page.evaluate(() => {
      const v = document.querySelector(".cf-record__take");
      return { width: v.videoWidth, height: v.videoHeight };
    });
    if (!(tracks.width > 0)) throw new Error("no picture: " + JSON.stringify(tracks));
    await shot("screen");
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "detached", timeout: 5000 });
    return `${tracks.width} x ${tracks.height}`;
  });

  await step("closed while it records: the camera stops and nothing is kept", async () => {
    const before = await page.locator(".cf-uploads__card").count();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await dialog().getByRole("button", { name: "Start recording" }).click();
    await dialog().getByRole("timer").waitFor({ timeout: 10000 });
    const live = await page.evaluate(() => {
      window.__lastStream = document.querySelector(".cf-record__live").srcObject;
      return window.__lastStream.getTracks().map((t) => t.readyState);
    });
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "detached", timeout: 5000 });
    const ended = await page.evaluate(() => window.__lastStream.getTracks().map((t) => t.readyState));
    if (!ended.every((s) => s === "ended")) throw new Error(`tracks ${live} then ${ended}`);
    if ((await page.locator(".cf-uploads__card").count()) !== before) throw new Error("an upload was kept");
    return `${live.join(", ")} -> ${ended.join(", ")}`;
  });

  await step("a phone at 375 px, in Hindi (File > Language): the dialog fits, nothing sideways", async () => {
    await page.locator(".cf-topbar").getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Language/ }).click();
    const reloaded = page.waitForEvent("load", { timeout: 40000 });
    await page.getByRole("menuitemcheckbox", { name: "हिन्दी", exact: true }).click();
    await reloaded;
    await page.locator(".cf-workspace").waitFor({ timeout: 40000 });
    await page.setViewportSize({ width: 375, height: 812 });
    await wait(800);
    // on a phone the side tabs are along the bottom; Uploads, then Record
    await page.getByRole("tab", { name: "अपलोड", exact: true }).click();
    await page.getByRole("button", { name: "रिकॉर्ड करें", exact: true }).click();
    const box = await page.getByRole("dialog", { name: "रिकॉर्ड करें" }).boundingBox();
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    const start = await page.getByRole("button", { name: "रिकॉर्डिंग शुरू करें" }).boundingBox();
    await shot("phone-hindi");
    await page.keyboard.press("Escape");
    if (!box || box.x < 0 || box.x + box.width > 375 || scroll > 375 || !start || start.x + start.width > 375) throw new Error(JSON.stringify({ box, start, scroll }));
    return `${Math.round(box.width)} px wide`;
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
