/* Animated export: a GIF and a WebM made through the Download panel, read byte by byte and decoded by the browser itself. */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("animated-export");
const results = [];
let shotN = 0;

const RED = [225, 29, 72]; // page 1 background #e11d48
const BLUE = [37, 99, 235]; // page 2 background #2563eb
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Walks a GIF's blocks: size, number of frames, the sum of the frame delays and whether it loops for ever. */
function parseGif(buf) {
  const sig = buf.subarray(0, 6).toString("latin1");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const flags = buf[10];
  let pos = 13;
  if (flags & 0x80) pos += 3 * (1 << ((flags & 7) + 1));
  let frames = 0;
  let delayCs = 0;
  let loopsForever = false;
  let ended = false;
  const skipBlocks = () => {
    while (buf[pos] !== 0) pos += buf[pos] + 1;
    pos++;
  };
  while (pos < buf.length) {
    const b = buf[pos++];
    if (b === 0x3b) {
      ended = true;
      break;
    }
    if (b === 0x21) {
      const label = buf[pos++];
      if (label === 0xf9) delayCs += buf.readUInt16LE(pos + 2);
      if (label === 0xff && buf.subarray(pos + 1, pos + 12).toString("latin1") === "NETSCAPE2.0") loopsForever = buf.readUInt16LE(pos + 14) === 0;
      skipBlocks();
    } else if (b === 0x2c) {
      frames++;
      const f = buf[pos + 8];
      pos += 9;
      if (f & 0x80) pos += 3 * (1 << ((f & 7) + 1));
      pos++; // LZW minimum code size
      skipBlocks();
    } else throw new Error(`unexpected byte ${b} at ${pos - 1}`);
  }
  return { sig, width, height, frames, seconds: delayCs / 100, loopsForever, ended };
}

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
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      try {
        await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30));
      } catch {}
    }
  };
  const dl = page.locator(".cf-dl");

  const newPresentation = async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(800);
  };
  const openDownload = async (type) => {
    await page.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByRole("button", { name: "Download", exact: true }).first().click();
    await dl.waitFor({ timeout: 5000 });
    await wait(300);
    await page.getByLabel("File type").click();
    await page
      .getByRole("option", { name: new RegExp("^" + type) })
      .first()
      .click();
    await wait(300);
  };
  const closeDownload = async () => {
    await page.keyboard.press("Escape");
    await wait(300);
  };
  /** Clicks Download and returns the saved file. */
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), dl.getByRole("button", { name: "Download", exact: true }).click()]);
    return { name: file.suggestedFilename(), buf: fs.readFileSync(await file.path()) };
  };

  await step("setup: a three-second show (a fade-in shape, then a slide to a second page)", async () => {
    await newPresentation();
    await page.getByRole("button", { name: "Browse shapes" }).click();
    await wait(400);
    await page.locator(".cf-ditem").nth(2).click();
    await wait(300);
    const total = await page.evaluate(
      ({ red, blue }) => {
        const a = window.__editor.getState().actions;
        const first = window.__editor.getState().design.pages[0];
        const shape = first.elements[first.elements.length - 1];
        a.setPageBackground({ type: "solid", color: red }, first.id);
        // animations are set on the active page: before the second page is added (adding it makes it active)
        a.setAnimation([shape.id], "in", { kind: "fade", duration: 1, delay: 0 });
        const second = a.addPage({ blank: true });
        a.setPageBackground({ type: "solid", color: blue }, second);
        a.setPageDuration(1, "all");
        a.setPageTransition({ kind: "slide", duration: 1, direction: "left" }, "page", second);
        a.setActivePage(first.id);
        a.select([]);
        return window.__editor.getState().design.pages.length;
      },
      { red: "#e11d48", blue: "#2563eb" },
    );
    if (total !== 2) throw new Error("pages " + total);
    return "1 s + 1 s slide + 1 s = 3 s";
  });

  await step("the panel offers Animated GIF and Video, with resolution, frame rate and the length", async () => {
    await openDownload("Animated GIF");
    const text = await dl.innerText();
    await shot("panel-gif");
    for (const need of ["Resolution", "480p", "720p", "1080p", "Frame rate", "10 fps", "15 fps", "20 fps", "3 s"])
      if (!text.includes(need)) throw new Error(`"${need}" is missing from the panel`);
    if (/Nothing is animated/.test(text)) throw new Error("says nothing is animated on an animated design");
    return text.match(/Estimated size[^\n]*/)?.[0] ?? "";
  });

  await step("download an animated GIF (480p, 10 fps): right shape, right length, loops, Chrome decodes it", async () => {
    await dl.getByText("480p", { exact: true }).click();
    await dl.getByText("10 fps", { exact: true }).click();
    await wait(200);
    const { name, buf } = await download();
    if (!name.endsWith(".gif")) throw new Error("file name " + name);
    const g = parseGif(buf);
    if (g.sig !== "GIF89a") throw new Error("signature " + g.sig);
    if (!g.ended) throw new Error("no GIF trailer");
    if (g.height !== 480 || Math.abs(g.width / g.height - 16 / 9) > 0.01) throw new Error(`size ${g.width}x${g.height}`);
    if (g.frames < 5) throw new Error("only " + g.frames + " frames");
    if (Math.abs(g.seconds - 3) > 0.06) throw new Error("plays for " + g.seconds + " s, expected 3");
    if (!g.loopsForever) throw new Error("does not loop");
    const seen = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
      const img = new Image();
      img.src = url;
      await img.decode();
      const out = { w: img.naturalWidth, h: img.naturalHeight, frames: null, first: null, last: null };
      if ("ImageDecoder" in window) {
        const d = new ImageDecoder({ data: bytes, type: "image/gif" });
        await d.tracks.ready;
        out.frames = d.tracks.selectedTrack.frameCount;
        const corner = async (index) => {
          const { image } = await d.decode({ frameIndex: index });
          const c = document.createElement("canvas");
          c.width = image.displayWidth;
          c.height = image.displayHeight;
          const x = c.getContext("2d");
          x.drawImage(image, 0, 0);
          image.close();
          return Array.from(x.getImageData(Math.floor(c.width * 0.03), Math.floor(c.height * 0.5), 1, 1).data.slice(0, 3));
        };
        out.first = await corner(0);
        out.last = await corner(out.frames - 1);
      }
      URL.revokeObjectURL(url);
      return out;
    }, buf.toString("base64"));
    if (seen.w !== g.width || seen.h !== g.height) throw new Error(`Chrome sees ${seen.w}x${seen.h}`);
    if (seen.frames != null && seen.frames !== g.frames) throw new Error(`Chrome counts ${seen.frames} frames, the file has ${g.frames}`);
    if (seen.first && dist(seen.first, RED) > 40) throw new Error("first frame is not page 1: " + seen.first);
    if (seen.last && dist(seen.last, BLUE) > 40) throw new Error("last frame is not page 2: " + seen.last);
    await closeDownload();
    return `${name} ${(buf.length / 1024).toFixed(0)} KB, ${g.width}x${g.height}, ${g.frames} frames, ${g.seconds} s`;
  });

  await step("download a WebM video (480p): a real video of the same length, first frame page 1, last frame page 2", async () => {
    await openDownload("Video");
    await dl.getByText("480p", { exact: true }).click();
    await shot("panel-webm");
    const { name, buf } = await download();
    if (!name.endsWith(".webm")) throw new Error("file name " + name);
    if (!(buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3))
      throw new Error("no EBML header: " + [...buf.subarray(0, 4)].map((b) => b.toString(16)).join(" "));
    if (buf.length < 4000) throw new Error("only " + buf.length + " bytes");
    const seen = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      video.src = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
      await new Promise((ok, no) => {
        video.onloadedmetadata = ok;
        video.onerror = () => no(new Error("the video would not load"));
      });
      const out = { duration: video.duration, w: video.videoWidth, h: video.videoHeight, first: null, last: null };
      // "seeked" says that the position moved, not that the picture has been decoded and painted: on a busy machine a frame that is not
      // there yet reads as black. So wait for a painted frame and look again while the pixel is black; a video that really is black
      // still ends in black after the last attempt.
      const painted = () =>
        new Promise((ok) => {
          const timer = setTimeout(ok, 500);
          if (video.requestVideoFrameCallback)
            video.requestVideoFrameCallback(() => {
              clearTimeout(timer);
              ok();
            });
        });
      const pixelAt = () => {
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const x = c.getContext("2d");
        x.drawImage(video, 0, 0);
        return Array.from(x.getImageData(Math.floor(c.width * 0.03), Math.floor(c.height * 0.5), 1, 1).data.slice(0, 3));
      };
      const grab = async (t) => {
        video.currentTime = t;
        await new Promise((ok) => {
          video.onseeked = ok;
        });
        let pixel = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          await painted();
          pixel = pixelAt();
          if (pixel.some((v) => v !== 0)) break;
        }
        return pixel;
      };
      if (Number.isFinite(out.duration)) {
        out.first = await grab(0.05);
        out.last = await grab(Math.max(0, out.duration - 0.25));
      }
      URL.revokeObjectURL(video.src);
      return out;
    }, buf.toString("base64"));
    if (!Number.isFinite(seen.duration)) throw new Error("the video reports an endless duration (" + seen.duration + ")");
    if (Math.abs(seen.duration - 3) > 1) throw new Error("duration " + seen.duration);
    if (seen.h !== 480 || Math.abs(seen.w / seen.h - 16 / 9) > 0.01) throw new Error(`video size ${seen.w}x${seen.h}`);
    if (dist(seen.first, RED) > 60) throw new Error("first frame is not page 1: " + seen.first);
    if (dist(seen.last, BLUE) > 60) throw new Error("last frame is not page 2: " + seen.last);
    await closeDownload();
    return `${name} ${(buf.length / 1024).toFixed(0)} KB, ${seen.w}x${seen.h}, ${seen.duration.toFixed(2)} s`;
  });

  await step("Cancel stops a video while it records and nothing is downloaded", async () => {
    await openDownload("Video");
    let saved = false;
    page.once("download", () => {
      saved = true;
    });
    await dl.getByRole("button", { name: "Download", exact: true }).click();
    await dl.getByRole("progressbar").waitFor({ timeout: 5000 });
    await wait(600);
    await dl.getByRole("button", { name: "Cancel" }).click();
    await page.getByText("Download cancelled").waitFor({ timeout: 5000 });
    await wait(1500);
    if (saved) throw new Error("a file was saved after Cancel");
    const enabled = await dl.getByRole("button", { name: "Download", exact: true }).isEnabled();
    if (!enabled) throw new Error("the Download button stayed disabled");
    await closeDownload();
    return "cancelled";
  });

  await step("a design with no animation says so, and a GIF of it still downloads", async () => {
    await newPresentation();
    await openDownload("Animated GIF");
    const text = await dl.innerText();
    if (!/Nothing is animated/.test(text)) throw new Error("no hint on a still design");
    await dl.getByText("480p", { exact: true }).click();
    const { name, buf } = await download();
    const g = parseGif(buf);
    if (!name.endsWith(".gif") || g.sig !== "GIF89a" || !g.ended) throw new Error(`${name} ${g.sig}`);
    await closeDownload();
    return `${name} ${g.frames} frame(s), ${g.seconds} s`;
  });

  console.log(results.join("\n"));
  console.log("CONSOLE:", JSON.stringify(logs.slice(0, 8)));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.log("E2E CRASH", e);
  process.exit(1);
});
