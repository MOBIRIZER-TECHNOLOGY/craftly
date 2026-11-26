/*
 * The video element, as a person uses it in Chrome, each step read back from the design or from the pixels:
 *
 *   a clip           a real WebM recorded in the page: red with a 440 Hz tone for its first 1.2 seconds, blue with 880 Hz after
 *                    (2.4 s, the length unknown to the file, as a browser's own recordings are)
 *   upload           Uploads takes it: a card with a <video> and its length, a click puts a video element on the page
 *   at rest          the page shows its first frame (red); trimming the start past 1.2 s makes it blue
 *   toolbar          Speed, Sound and Trim change the element
 *   playing          Play on the toolbar plays it on the page (red, then blue); Present plays it (both colours seen)
 *   download         a video download of the page (an MP4 made frame by frame in Chrome) holds the clip playing, with its sound:
 *                    red and 440 Hz near its start, blue and 880 Hz later
 *   reload           the clip is still there after a reload, its first frame drawn again
 */
const fs = require("fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("video");
const results = [];
const logs = [];
let shotN = 0;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
  const clip = () => design(`(s) => s.design.pages[0].elements.find((e) => e.type === "video") ?? null`);
  const toolbar = page.locator(".cf-tb").first();

  /** "red", "blue" or something else, for a few pixels at the middle of a box on the screen. */
  const colourAt = async (box) => {
    const png = await page.screenshot({ clip: { x: box.x - 6, y: box.y - 6, width: 12, height: 12 } });
    return page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let r = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        b += d[i + 2];
      }
      const n = d.length / 4;
      r /= n;
      b /= n;
      return r > 150 && r - b > 60 ? "red" : b > 150 && b - r > 60 ? "blue" : `other(${Math.round(r)},${Math.round(b)})`;
    }, Array.from(png));
  };
  /** The middle of the selected element on the screen. */
  const middleOfSelection = async () => {
    const r = await page.locator(".cf-sel").first().boundingBox();
    if (!r) throw new Error("nothing is selected");
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.7 };
  };
  /** Colours seen at `box` over `ms`, every 100 ms. */
  const coloursOver = async (box, ms) => {
    const seen = new Set();
    for (let t = 0; t < ms; t += 120) {
      seen.add(await colourAt(box));
      await wait(100);
    }
    return [...seen];
  };

  await step("setup: a new presentation", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.waitForURL(/#\/design\//, { timeout: 15000 });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    // the template's own elements are taken off, so the clip is all there is
    await page.evaluate(() => {
      const a = window.__editor.getState().actions;
      a.selectAll();
      a.deleteElements();
    });
    return "open";
  });

  let clipBytes = null;
  await step("a clip: a WebM recorded in the page, red with a low tone and then blue with a high one", async () => {
    const b64 = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const g = c.getContext("2d");
      g.fillStyle = "#e11d48";
      g.fillRect(0, 0, 320, 180);
      // the sound: a sine at 440 Hz under the red part and 880 Hz under the blue one
      const audio = new AudioContext();
      await audio.resume();
      const osc = audio.createOscillator();
      osc.frequency.value = 440;
      const gain = audio.createGain();
      gain.gain.value = 0.5;
      const out = audio.createMediaStreamDestination();
      osc.connect(gain).connect(out);
      osc.start();
      const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...out.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const start = performance.now();
      rec.start(100);
      await new Promise((done) => {
        const tick = () => {
          const t = (performance.now() - start) / 1000;
          g.fillStyle = t < 1.2 ? "#e11d48" : "#2563eb";
          g.fillRect(0, 0, 320, 180);
          osc.frequency.value = t < 1.2 ? 440 : 880;
          if (t < 2.4) requestAnimationFrame(tick);
          else done();
        };
        tick();
      });
      await new Promise((r) => {
        rec.onstop = r;
        rec.stop();
      });
      osc.stop();
      await audio.close();
      const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    });
    clipBytes = Buffer.from(b64, "base64");
    if (clipBytes.length < 1000) throw new Error("only " + clipBytes.length + " bytes");
    return clipBytes.length + " bytes";
  });

  await step("Uploads takes the clip: a card with the video and its length", async () => {
    await page.getByRole("tab", { name: "Uploads", exact: true }).click();
    await page.locator(".cf-sidepanel input[type=file]").first().setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clipBytes });
    const card = page.locator(".cf-uploads__card", { has: page.locator("video") }).first();
    await card.waitFor({ timeout: 15000 });
    const badge = card.locator(".cf-uploads__badge");
    await page.waitForFunction(() => /^\d+:\d\d$/.test(document.querySelector(".cf-uploads__badge")?.textContent ?? ""), null, { timeout: 10000 });
    const text = await badge.innerText();
    return "card " + text;
  });

  await step("a click on the card puts a video element on the page, as long as the clip", async () => {
    await page.getByRole("button", { name: "Add clip to the page" }).first().click();
    await page.waitForFunction(() => window.__editor.getState().design.pages[0].elements.some((e) => e.type === "video"), null, { timeout: 15000 });
    const el = await clip();
    if (!el.src.startsWith("asset:")) throw new Error("src " + el.src);
    if (el.naturalWidth !== 320 || el.naturalHeight !== 180) throw new Error(`size ${el.naturalWidth} x ${el.naturalHeight}`);
    if (!(el.duration > 2 && el.duration < 3)) throw new Error("length " + el.duration);
    if (el.trimStart !== 0 || el.trimEnd !== el.duration || el.speed !== 1) throw new Error(JSON.stringify({ s: el.trimStart, e: el.trimEnd, v: el.speed }));
    const selected = await design(`(s) => s.selection`);
    if (selected[0] !== el.id) throw new Error("the clip is not selected");
    return `${el.width} x ${el.height}, ${el.duration.toFixed(2)} s`;
  });

  await step("at rest the page shows the clip's first frame", async () => {
    await page.waitForFunction(() => document.querySelector(".cf-sel"), null, { timeout: 5000 });
    let colour = "";
    for (let i = 0; i < 30 && colour !== "red"; i++) {
      colour = await colourAt(await middleOfSelection());
      if (colour !== "red") await wait(200);
    }
    await shot("first-frame");
    if (colour !== "red") throw new Error("the middle of the clip is " + colour);
    return colour;
  });

  await step("Filters: Mono turns the red clip grey on the page, and None takes the colour back", async () => {
    await toolbar.getByRole("button", { name: "Filters", exact: true }).click();
    const presets = page.getByRole("group", { name: "Filter presets" });
    await presets.getByRole("button", { name: "Mono", exact: true }).click();
    const el = await clip();
    if (el.filter?.preset !== "mono") throw new Error("filter " + JSON.stringify(el.filter));
    let colour = "";
    for (let i = 0; i < 30 && !colour.startsWith("other"); i++) {
      colour = await colourAt(await middleOfSelection());
      if (!colour.startsWith("other")) await wait(200);
    }
    await shot("mono");
    if (!colour.startsWith("other")) throw new Error("with Mono the clip is " + colour);
    await presets.getByRole("button", { name: "None", exact: true }).click();
    let back = "";
    for (let i = 0; i < 30 && back !== "red"; i++) {
      back = await colourAt(await middleOfSelection());
      if (back !== "red") await wait(200);
    }
    if (back !== "red") throw new Error("without a filter the clip is " + back);
    await toolbar.getByRole("button", { name: "Filters", exact: true }).click();
    return `${colour}, then ${back}`;
  });

  await step("Crop: the clip's first frame shows in the crop, a 1:1 frame makes the clip square, and undo takes it back", async () => {
    const before = await clip();
    await toolbar.getByRole("button", { name: "Crop", exact: true }).click();
    await page.waitForFunction(() => /^data:image\//.test(document.querySelector(".cf-crop__live")?.getAttribute("src") ?? ""), null, { timeout: 10000 });
    await page.getByRole("button", { name: "Shape of the crop" }).first().click();
    await page.getByRole("menuitemcheckbox", { name: "1:1", exact: true }).click();
    const square = await clip();
    if (Math.abs(square.width - square.height) > 0.5) throw new Error(`frame ${square.width} x ${square.height}`);
    await shot("crop-square");
    await page.getByRole("button", { name: "Done", exact: true }).first().click();
    await page.waitForFunction(() => !document.querySelector("[data-cf-crop]"), null, { timeout: 5000 });
    await page.keyboard.press("Control+z");
    const undone = await clip();
    if (Math.abs(undone.width - before.width) > 0.5) throw new Error("undo left " + undone.width);
    return `${Math.round(square.width)} x ${Math.round(square.height)}, then ${Math.round(undone.width)} x ${Math.round(undone.height)}`;
  });

  await step("the timeline's playhead parked at 1.8 s shows the clip at that moment: blue, not its red first frame", async () => {
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    const head = page.getByRole("slider", { name: "Playhead" });
    await head.waitFor({ timeout: 5000 });
    await head.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight");
    const at = await head.getAttribute("aria-valuenow");
    const el = await clip();
    const zoom = await design(`(s) => s.zoom`);
    const view = await page.evaluate(() => {
      const f = document.querySelector(".cf-pageframe").getBoundingClientRect();
      return { x: f.x, y: f.y };
    });
    const middle = { x: view.x + (el.x + el.width / 2) * zoom, y: view.y + (el.y + el.height * 0.7) * zoom };
    let colour = "";
    for (let i = 0; i < 30 && colour !== "blue"; i++) {
      colour = await colourAt(middle);
      if (colour !== "blue") await wait(200);
    }
    await shot("parked-playhead");
    if (colour !== "blue") throw new Error(`at ${at} s the clip is ${colour}`);
    // closing the timeline gives the page back for editing
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    return `${at} s: ${colour}`;
  });

  await step("the toolbar of a clip: Play, Trim, Speed, Sound and Frame shape", async () => {
    for (const name of ["Play", "Trim", "Speed", "Sound", "Frame shape"]) await toolbar.getByRole("button", { name, exact: true }).waitFor({ timeout: 5000 });
    return "five controls";
  });

  await step("Speed sets how fast it plays", async () => {
    await toolbar.getByRole("button", { name: "Speed", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "2×", exact: true }).click();
    const el = await clip();
    if (el.speed !== 2) throw new Error("speed " + el.speed);
    await toolbar.getByRole("button", { name: "Speed", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "1×", exact: true }).click();
    return "2×, then 1× again";
  });

  await step("Sound mutes the clip and turns its sound back on", async () => {
    const sound = toolbar.getByRole("button", { name: "Sound", exact: true });
    if ((await sound.getAttribute("aria-pressed")) !== "true") throw new Error("a new clip is not playing its sound");
    await sound.click();
    if ((await clip()).muted !== true) throw new Error("not muted");
    if ((await sound.getAttribute("aria-pressed")) !== "false") throw new Error("the button does not say it is off");
    await sound.click();
    if ((await clip()).muted) throw new Error("still muted");
    return "muted, then not";
  });

  await step("Trim: a start past 1.2 s makes the first frame blue, and Play the whole clip takes it back", async () => {
    await toolbar.getByRole("button", { name: "Trim", exact: true }).click();
    const start = page.getByRole("spinbutton", { name: "Start (seconds) value" });
    await start.fill("1.6");
    await start.press("Enter");
    await page
      .getByRole("status")
      .filter({ hasText: /^Plays / })
      .waitFor({ timeout: 5000 });
    const el = await clip();
    if (Math.abs(el.trimStart - 1.6) > 0.01) throw new Error("start " + el.trimStart);
    await page.keyboard.press("Escape");
    let colour = "";
    for (let i = 0; i < 30 && colour !== "blue"; i++) {
      colour = await colourAt(await middleOfSelection());
      if (colour !== "blue") await wait(200);
    }
    await shot("trimmed");
    if (colour !== "blue") throw new Error("after trimming the first frame is " + colour);
    await toolbar.getByRole("button", { name: "Trim", exact: true }).click();
    await page.getByRole("button", { name: "Play the whole clip" }).click();
    await page.keyboard.press("Escape");
    const back = await clip();
    if (back.trimStart !== 0 || back.trimEnd !== back.duration) throw new Error(JSON.stringify([back.trimStart, back.trimEnd]));
    return `start 1.6 s: ${colour}; whole again`;
  });

  await step("Play plays the clip on the page: red, then blue", async () => {
    const box = await middleOfSelection();
    await toolbar.getByRole("button", { name: "Play", exact: true }).click();
    const seen = await coloursOver(box, 2600);
    if (!seen.includes("red") || !seen.includes("blue")) throw new Error("seen " + seen.join(", "));
    return seen.join(" then ");
  });

  await step("Present plays it, over and over", async () => {
    await page
      .getByRole("button", { name: /^Present$/ })
      .first()
      .click();
    await page.locator(".cf-present").waitFor({ timeout: 8000 });
    await wait(500);
    const c = await page.locator("canvas.cf-present__page").boundingBox();
    const box = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
    const seen = await coloursOver(box, 4000);
    await shot("present");
    await page.keyboard.press("Escape");
    await page.locator(".cf-present").waitFor({ state: "detached", timeout: 5000 });
    if (!seen.includes("red") || !seen.includes("blue")) throw new Error("seen " + seen.join(", "));
    return seen.join(", ");
  });

  await step("a video download holds the clip playing with its sound: red and 440 Hz near its start, blue and 880 Hz later", async () => {
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
    // Chrome has WebCodecs: the video is made frame by frame, an MP4 with H.264 and AAC
    if (!name.endsWith(".mp4") || buf.subarray(4, 8).toString("latin1") !== "ftyp") throw new Error("not an MP4: " + name);
    const seen = await page.evaluate(
      async ([b64, type]) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.src = URL.createObjectURL(new Blob([bytes], { type }));
        await new Promise((ok, no) => {
          video.onloadeddata = ok;
          video.onerror = () => no(new Error("the download would not load"));
        });
        // the pitch of the sound around `t`, from how often it crosses zero
        const sound = await new AudioContext().decodeAudioData(bytes.buffer.slice(0));
        const pcm = sound.getChannelData(0);
        const pitch = (t) => {
          let crossings = 0;
          const from = Math.floor((t - 0.1) * sound.sampleRate);
          const to = Math.floor((t + 0.1) * sound.sampleRate);
          for (let i = from + 1; i < to; i++) if (pcm[i - 1] < 0 !== pcm[i] < 0) crossings++;
          return Math.round(crossings / 2 / 0.2);
        };
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const g = c.getContext("2d", { willReadFrequently: true });
        const at = async (t) => {
          video.currentTime = t;
          await new Promise((ok) => (video.onseeked = ok));
          await new Promise((ok) => setTimeout(ok, 150));
          g.drawImage(video, 0, 0);
          const [r, , b] = g.getImageData(c.width / 2, c.height / 2, 1, 1).data;
          return r > 150 && r - b > 60 ? "red" : b > 150 && b - r > 60 ? "blue" : `other(${r},${b})`;
        };
        return { colours: [await at(0.3), await at(1.9)], pitches: [pitch(0.3), pitch(1.9)] };
      },
      [buf.toString("base64"), "video/mp4"],
    );
    if (seen.colours[0] !== "red" || seen.colours[1] !== "blue") throw new Error("at 0.3 s and 1.9 s: " + seen.colours.join(", "));
    // a tone recorded through MediaRecorder wanders a little: within 5 %
    const near = (hz, want) => Math.abs(hz - want) < want * 0.05;
    if (!near(seen.pitches[0], 440) || !near(seen.pitches[1], 880)) throw new Error("the sound at 0.3 s and 1.9 s: " + seen.pitches.join(" Hz, ") + " Hz");
    return `${name}: ${seen.colours.join(" then ")}, ${seen.pitches.join(" Hz then ")} Hz`;
  });

  await step("after a reload the clip is still there, its first frame drawn", async () => {
    await wait(1500); // the autosave
    await page.reload({ waitUntil: "load" });
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    const el = await clip();
    if (!el) throw new Error("the clip is gone");
    await page.evaluate((id) => window.__editor.getState().actions.select([id]), el.id);
    await page.waitForFunction(() => document.querySelector(".cf-sel"), null, { timeout: 5000 });
    let colour = "";
    for (let i = 0; i < 30 && colour !== "red"; i++) {
      colour = await colourAt(await middleOfSelection());
      if (colour !== "red") await wait(200);
    }
    if (colour !== "red") throw new Error("after a reload the clip shows " + colour);
    return colour;
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
