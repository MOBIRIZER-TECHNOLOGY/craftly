/*
 * The real model. Downloads ISNet general-use (88.1 MB from huggingface.co) through the app's own consent dialog, runs
 * Remove background on a picture and checks the result. Not part of `npm run e2e`: it needs the network and a GPU.
 *
 *   BASE=http://127.0.0.1:5199 node e2e/ml-real.cjs        (dev server)
 *   BASE=http://127.0.0.1:4174 node e2e/ml-real.cjs        (production build made with VITE_EXPOSE_STORE=1)
 *
 * The browser keeps its profile in ML_PROFILE (default: craftly-ml-profile in the temp folder), so the model is
 * downloaded the first time only. Delete that folder to free the 88 MB, or set FRESH=1 to start from nothing.
 * When the job fails, the toasts, the [craftly] console lines and the GPU's limits are printed: that is the point.
 *
 * The picture is drawn here (a red mug with a handle and a shadow on a grey wall), so the check is "the model finds the
 * mug and leaves the wall", not a measure of quality on real photographs.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { launchPersistent, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("ml-real");
const PROFILE = process.env.ML_PROFILE || path.join(os.tmpdir(), "craftly-ml-profile");
const ONLY = process.env.ONLY || "";
if (process.env.FRESH) fs.rmSync(PROFILE, { recursive: true, force: true });
const results = [];
let shots = 0;

(async () => {
  const context = await launchPersistent(PROFILE, { viewport: { width: 1440, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const logs = [];
  const craftlyLines = [];
  const workerLines = [];
  const hostRequests = [];
  page.on("console", (m) => {
    const text = m.text();
    if (text.startsWith("[craftly]")) craftlyLines.push(text.slice(0, 600));
    else if (m.type() === "error") logs.push("console.error: " + text.slice(0, 300));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 300)));
  page.on("worker", (worker) => {
    try {
      worker.on("console", (m) => workerLines.push(`[${m.type()}] ${m.text().slice(0, 400)}`));
    } catch {}
  });
  page.on("request", (r) => {
    if (/huggingface\.co|xethub\.hf\.co|cdn-lfs/.test(r.url())) hostRequests.push(r.url());
  });
  // every toast that ever showed, even though each one disappears after a few seconds
  await page.addInitScript(() => {
    window.__toasts = [];
    const read = () => {
      const region = document.querySelector('[aria-label="Notifications"]');
      const text = region ? region.innerText.trim() : "";
      if (text && !window.__toasts.includes(text)) window.__toasts.push(text);
    };
    new MutationObserver(read).observe(document, { childList: true, subtree: true, characterData: true });
  });

  const shot = (name) => page.screenshot({ path: OUT + String(++shots).padStart(2, "0") + "-" + name + ".png" });
  const wait = (ms) => page.waitForTimeout(ms);
  const step = async (name, fn) => {
    try {
      const note = await fn();
      results.push("PASS " + name + (note ? "  " + note : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 400));
      try {
        await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30));
      } catch {}
    }
  };
  const selected = () =>
    page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      const e = pg.elements.find((x) => x.id === s.selection[0]);
      return e ? JSON.parse(JSON.stringify(e)) : null;
    });
  const toasts = () => page.evaluate(() => window.__toasts.slice());
  const timings = {};
  // ONLY=upscale, ONLY=remove-background, ONLY=blur-background or ONLY=colour-pop runs one tool (the three background tools share one model)
  const RUN_REMOVER = !ONLY || ONLY === "remove-background";
  const RUN_BLUR = !ONLY || ONLY === "blur-background";
  const RUN_POP = !ONLY || ONLY === "colour-pop";
  const RUN_UPSCALER = !ONLY || ONLY === "upscale";

  // the picture the tools are tried on: a red mug with a handle and a shadow on a grey wall, drawn at any size
  await page.addInitScript(() => {
    // options.dots: a wall covered in small dark dots, which a blur has something to smooth
    // options.colour: a wall of strong colour (teal to green), which a colour pop has something to take out
    window.__drawMug = (c, options = {}) => {
      const k = c.width / 960;
      const g = c.getContext("2d");
      g.scale(k, k);
      const wall = g.createLinearGradient(0, 0, 0, 720);
      wall.addColorStop(0, options.colour ? "#2aa7a1" : "#c9ccd1");
      wall.addColorStop(1, options.colour ? "#8fcf4f" : "#aab0b8");
      g.fillStyle = wall;
      g.fillRect(0, 0, 960, 720);
      if (options.dots) {
        g.fillStyle = "rgba(40,45,60,0.55)";
        for (let y = 12; y < 720; y += 24) {
          for (let x = 12; x < 960; x += 24) {
            g.beginPath();
            g.arc(x, y, 4, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      g.fillStyle = "rgba(0,0,0,0.28)"; // the shadow under the mug
      g.beginPath();
      g.ellipse(480, 585, 230, 38, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#b52a2a"; // the handle
      g.lineWidth = 34;
      g.beginPath();
      g.arc(700, 360, 82, -Math.PI / 2.2, Math.PI / 2.2);
      g.stroke();
      const body = g.createLinearGradient(260, 0, 700, 0);
      body.addColorStop(0, "#e04141");
      body.addColorStop(0.5, "#f26a5f");
      body.addColorStop(1, "#b52a2a");
      g.fillStyle = body;
      g.beginPath();
      g.roundRect(260, 200, 440, 380, 36);
      g.fill();
      g.fillStyle = "#3b2a22"; // the coffee
      g.beginPath();
      g.ellipse(480, 205, 220, 30, 0, 0, Math.PI * 2);
      g.fill();
    };
  });

  /** A new presentation with this picture uploaded and selected on its page. */
  const placePhoto = async (file) => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: /^Presentation/ })
      .first()
      .click();
    await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
    await wait(900);
    await page.getByRole("tab", { name: "Uploads", exact: true }).click();
    await wait(400);
    await page.locator("input[type=file]").first().setInputFiles(file);
    await wait(1800);
    // the upload may already have put the picture on the page; click the thumbnail only when it has not
    const onPage = () =>
      page.evaluate(() => {
        const s = window.__editor.getState();
        return s.design.pages.find((p) => p.id === s.activePageId).elements.filter((e) => e.type === "image").length;
      });
    if ((await onPage()) === 0) {
      await page.locator(".cf-sidepanel .cf-ditem").first().click();
      await wait(700);
    }
    if ((await onPage()) !== 1) throw new Error("expected exactly one photo on the page, found " + (await onPage()));
    const el = await selected();
    if (!el || el.type !== "image") throw new Error("no photo selected");
  };

  await step("setup: a drawn photo of a mug, uploaded and placed on a new presentation", async () => {
    await page.goto(BASE + "/#/", { waitUntil: "load" });
    await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 960;
      c.height = 720;
      window.__drawMug(c);
      return c.toDataURL("image/png").split(",")[1];
    });
    const file = OUT + "mug.png";
    fs.writeFileSync(file, Buffer.from(png, "base64"));
    await placePhoto(file);
  });

  await step("the graphics card: what the browser reports", async () => {
    const gpu = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const info = adapter.info || {};
      const limits = adapter.limits;
      return {
        adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(" / "),
        shaderF16: adapter.features.has("shader-f16"),
        maxBufferSizeMB: Math.round(limits.maxBufferSize / 1048576),
        maxStorageBufferBindingMB: Math.round(limits.maxStorageBufferBindingSize / 1048576),
      };
    });
    if (!gpu) throw new Error("no adapter");
    return JSON.stringify(gpu);
  });

  /** The picture an element shows, read straight from IndexedDB so this works on the dev server and on a production build. */
  const readAsset = (src) =>
    page.evaluate(async (src) => {
      const asset = await new Promise((resolve, reject) => {
        const open = indexedDB.open("craftly");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("assets").objectStore("assets").get(src.slice(6));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        };
      });
      const bitmap = await createImageBitmap(asset.blob);
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const g = c.getContext("2d");
      g.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, mime: asset.mime, name: asset.name, data: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
    }, src);

  let originalSrc = "";
  if (RUN_REMOVER) {
    await step("Remove background: agree to the download if it is needed, and get a cut-out", async () => {
      originalSrc = (await selected()).src;
      await page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name: "Edit image" }).click();
      await wait(600);
      await page.getByRole("tablist", { name: "Photo editing sections" }).getByRole("tab", { name: "Tools" }).click();
      await wait(500);
      const started = Date.now();
      await page.getByRole("button", { name: "Remove background" }).click();
      const dialog = page.getByRole("dialog");
      if (
        await dialog
          .waitFor({ timeout: 4000 })
          .then(() => true)
          .catch(() => false)
      ) {
        await dialog.getByRole("button", { name: "Download 88.1 MB" }).click();
        await page.getByRole("progressbar", { name: "Downloading the model" }).waitFor({ timeout: 30000 });
        await shot("downloading");
      }
      // wait for the cut-out, or for the job to fail (a toast with the reason), whichever comes first
      const deadline = Date.now() + 600000;
      for (;;) {
        const now = await selected();
        if (now && now.src !== originalSrc) break;
        const shown = await toasts();
        const failure = shown.find((t) => /could not|ran out|isn't|interrupted|didn't|not used|no subject|changed while|cancelled|can't/i.test(t));
        if (failure) throw new Error("the job failed: " + failure.replace(/\s+/g, " "));
        if (Date.now() > deadline) throw new Error("no cut-out and no message after 10 minutes");
        await wait(400);
      }
      timings.firstJobMs = Date.now() - started;
      await wait(800);
      await shot("cut-out-applied");
      const el = await selected();
      if (el.originalSrc !== originalSrc) throw new Error("the original was not remembered");
      return `${(timings.firstJobMs / 1000).toFixed(1)} s from the click (download included when one was needed); ${hostRequests.length} request(s) to the model host`;
    });

    await step("the cut-out keeps the mug and drops the wall, with soft edges", async () => {
      const el = await selected();
      if (el.src === originalSrc) throw new Error("the photo was not cut out");
      const read = await page.evaluate(async (src) => {
        // the upload straight from IndexedDB, so this works on the dev server and on a production build
        const asset = await new Promise((resolve, reject) => {
          const open = indexedDB.open("craftly");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const request = open.result.transaction("assets").objectStore("assets").get(src.slice(6));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          };
        });
        const bitmap = await createImageBitmap(asset.blob);
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const g = c.getContext("2d");
        g.drawImage(bitmap, 0, 0);
        const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
        let solid = 0;
        let clear = 0;
        let soft = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 250) solid++;
          else if (data[i] < 5) clear++;
          else soft++;
        }
        const at = (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
        return { width, height, mime: asset.mime, total: width * height, solid, clear, soft, mugCentre: at(480, 400), wallCorner: at(20, 20), wallRight: at(920, 360) };
      }, el.src);
      const share = read.solid / read.total;
      if (read.mime !== "image/png") throw new Error("not a PNG: " + read.mime);
      if (read.mugCentre[3] < 250) throw new Error("the middle of the mug is not solid: " + read.mugCentre);
      if (read.wallCorner[3] > 5 || read.wallRight[3] > 5) throw new Error("the wall is not transparent: " + read.wallCorner + " / " + read.wallRight);
      if (share < 0.12 || share > 0.55) throw new Error("the subject covers " + (share * 100).toFixed(1) + " % of the picture");
      return `${read.width}x${read.height}, subject ${(share * 100).toFixed(1)} %, soft edge pixels ${read.soft}`;
    });

    await step("Restore original, then a second run is instant (the model's answer for this photo is kept)", async () => {
      await page.getByRole("button", { name: "Restore original" }).click();
      await wait(500);
      if ((await selected()).src !== originalSrc) throw new Error("restore did not bring the original back");
      const started = Date.now();
      await page.getByRole("button", { name: "Remove background" }).click();
      const deadline = Date.now() + 120000;
      for (;;) {
        const now = await selected();
        if (now && now.src !== originalSrc) break;
        if (Date.now() > deadline) throw new Error("the second run did not finish in 2 minutes");
        await wait(100);
      }
      timings.secondJobMs = Date.now() - started;
      return `second run ${(timings.secondJobMs / 1000).toFixed(2)} s`;
    });
  }

  if (RUN_BLUR) {
    let blurOriginal = "";
    let mediumSrc = "";

    /** Clicks Blur background with a strength (agreeing to the download when asked) and waits until the photo shows another picture, or a message says why not. */
    const blurAndWait = async (before, strength, { expectDialog = true } = {}) => {
      const button = page.getByRole("button", { name: "Blur background" });
      if (!(await button.isVisible().catch(() => false))) {
        await page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name: "Edit image" }).click();
        await wait(600);
        await page.getByRole("tablist", { name: "Photo editing sections" }).getByRole("tab", { name: "Tools" }).click();
        await wait(500);
      }
      await page.getByRole("radio", { name: strength }).click();
      const alreadyShown = (await toasts()).length; // messages of earlier steps do not count
      const started = Date.now();
      await button.click();
      const dialog = page.getByRole("dialog");
      // the question comes at once when the model is missing; once it is installed there is none, so do not wait for it
      if (
        await dialog
          .waitFor({ timeout: expectDialog ? 4000 : 250 })
          .then(() => true)
          .catch(() => false)
      ) {
        await dialog.getByRole("button", { name: "Download 88.1 MB" }).click();
        await page
          .getByRole("progressbar", { name: "Downloading the model" })
          .waitFor({ timeout: 30000 })
          .catch(() => undefined);
      }
      const deadline = Date.now() + 600000;
      for (;;) {
        const now = await selected();
        if (now && now.src !== before) break;
        const shown = (await toasts()).slice(alreadyShown);
        const failure = shown.find((t) =>
          /could not|ran out|isn't|interrupted|didn't|not used|no subject|changed while|cancelled|can't|nothing to blur|no background to blur/i.test(t),
        );
        if (failure) throw new Error("the job failed: " + failure.replace(/\s+/g, " "));
        if (Date.now() > deadline) throw new Error("no new picture and no message after 10 minutes");
        await wait(150);
      }
      await wait(500);
      return Date.now() - started;
    };

    /** What a blur did to the wall and to the mug, measured on the pixels of the original and of the result. */
    const measureBlur = (original, result) =>
      page.evaluate(
        ({ original, result }) => {
          const W = original.width;
          const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          /** how far the pixels of a patch are from the average of their four neighbours: the amount of fine detail in it */
          const detail = (d, x0, y0, x1, y1) => {
            let sum = 0;
            let n = 0;
            for (let y = y0 + 1; y < y1 - 1; y++) {
              for (let x = x0 + 1; x < x1 - 1; x++) {
                const i = (y * W + x) * 4;
                sum += Math.abs(lum(d, i) - (lum(d, i - 4) + lum(d, i + 4) + lum(d, i - W * 4) + lum(d, i + W * 4)) / 4);
                n++;
              }
            }
            return sum / n;
          };
          const mean = (d, x0, y0, x1, y1) => {
            const m = [0, 0, 0];
            let n = 0;
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                for (let k = 0; k < 3; k++) m[k] += d[(y * W + x) * 4 + k];
                n++;
              }
            }
            return m.map((v) => v / n);
          };
          // inside the mug's body: how many of the numbers changed, and the largest change
          let changed = 0;
          let total = 0;
          let worst = 0;
          for (let y = 260; y < 520; y++) {
            for (let x = 320; x < 640; x++) {
              for (let k = 0; k < 3; k++) {
                const d = Math.abs(result.data[(y * W + x) * 4 + k] - original.data[(y * W + x) * 4 + k]);
                total++;
                if (d) changed++;
                if (d > worst) worst = d;
              }
            }
          }
          let opaque = true;
          for (let i = 3; i < result.data.length; i += 4) if (result.data[i] !== 255) opaque = false;
          return {
            size: [result.width, result.height],
            mime: result.mime,
            opaque,
            detail: { before: detail(original.data, 0, 0, 240, 150), after: detail(result.data, 0, 0, 240, 150) },
            wall: { before: mean(original.data, 0, 0, 240, 150), after: mean(result.data, 0, 0, 240, 150) },
            // the wall next to the mug against the wall far from it, at the same height: a halo of the mug's red would show here
            near: mean(result.data, 200, 300, 252, 500),
            far: mean(result.data, 20, 300, 120, 500),
            nearBefore: mean(original.data, 200, 300, 252, 500),
            farBefore: mean(original.data, 20, 300, 120, 500),
            mug: { changedShare: changed / total, worst },
          };
        },
        { original, result },
      );

    await step("setup (blur): a mug in front of a wall covered in small dots, uploaded and placed on a new presentation", async () => {
      await page.goto(BASE + "/#/", { waitUntil: "load" });
      await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 960;
        c.height = 720;
        window.__drawMug(c, { dots: true });
        return c.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "mug-dots.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      blurOriginal = (await selected()).src;
    });

    await step("Blur background (medium): agree to the download if it is needed, and get a picture as large as the photo", async () => {
      timings.blurFirstMs = await blurAndWait(blurOriginal, "Medium");
      await shot("blurred-medium");
      const el = await selected();
      mediumSrc = el.src;
      if (el.originalSrc !== blurOriginal) throw new Error("the original was not remembered");
      if (el.naturalWidth !== 960 || el.naturalHeight !== 720) throw new Error("the picture is " + el.naturalWidth + " x " + el.naturalHeight + ", expected 960 x 720");
      return `${(timings.blurFirstMs / 1000).toFixed(1)} s from the click (download included when one was needed); ${hostRequests.length} request(s) to the model host`;
    });

    await step("the mug is as it was, the dots on the wall are blurred away, the wall keeps its colour, and the mug leaves no halo on it", async () => {
      const [result, original] = await Promise.all([readAsset(mediumSrc), readAsset(blurOriginal)]);
      const m = await measureBlur(original, result);
      timings.blurMug = m.mug;
      if (m.mime !== "image/png" || m.size.join("x") !== "960x720") throw new Error("the picture is " + m.mime + " " + m.size.join("x"));
      if (!m.opaque) throw new Error("the picture has transparent pixels");
      if (!(m.detail.after < m.detail.before * 0.35)) throw new Error("the dots are still there: detail " + m.detail.before.toFixed(2) + " became " + m.detail.after.toFixed(2));
      for (let k = 0; k < 3; k++)
        if (Math.abs(m.wall.after[k] - m.wall.before[k]) > 6)
          throw new Error("the wall changed colour: " + m.wall.before.map(Math.round) + " became " + m.wall.after.map(Math.round));
      // the wall next to the mug is as it is far from it, to within what the dots and the blur make of the difference
      for (let k = 0; k < 3; k++)
        if (Math.abs(m.near[k] - m.far[k]) > Math.abs(m.nearBefore[k] - m.farBefore[k]) + 6)
          throw new Error(
            "a halo next to the mug: near " +
              m.near.map(Math.round) +
              ", far " +
              m.far.map(Math.round) +
              " (before: " +
              m.nearBefore.map(Math.round) +
              ", " +
              m.farBefore.map(Math.round) +
              ")",
          );
      if (m.mug.worst > 12) throw new Error("the mug changed by up to " + m.mug.worst + " of 255");
      return `wall detail ${m.detail.before.toFixed(2)} -> ${m.detail.after.toFixed(2)}, wall colour kept, no halo (near ${m.near.map(Math.round)} / far ${m.far.map(Math.round)}); mug: ${(m.mug.changedShare * 100).toFixed(1)} % of its numbers changed, by at most ${m.mug.worst}`;
    });

    await step("Undo, then a strong blur of the same photo: no second wait for the model, and a stronger blur", async () => {
      await page.evaluate(() => window.__editor.getState().actions.undo());
      await wait(500);
      if ((await selected()).src !== blurOriginal) throw new Error("undo did not bring the original back");
      timings.blurRetryMs = await blurAndWait(blurOriginal, "Strong", { expectDialog: false });
      await shot("blurred-strong");
      const strongSrc = (await selected()).src;
      const [strong, medium, original] = await Promise.all([readAsset(strongSrc), readAsset(mediumSrc), readAsset(blurOriginal)]);
      const [ms, mm] = await Promise.all([measureBlur(original, strong), measureBlur(original, medium)]);
      if (!(ms.detail.after < mm.detail.after))
        throw new Error("the strong blur is not smoother than the medium one: " + ms.detail.after.toFixed(2) + " against " + mm.detail.after.toFixed(2));
      if (timings.blurRetryMs > 3500) throw new Error("the second try took " + timings.blurRetryMs + " ms: the model was probably asked again");
      // the three pictures side by side, and the same place on each, enlarged: the rim of the mug, where the mask's soft edge is
      const side = await page.evaluate(
        ({ pictures }) => {
          const w = 480;
          const h = 360;
          const whole = document.createElement("canvas");
          whole.width = w * 3 + 16;
          whole.height = h;
          const g = whole.getContext("2d");
          g.imageSmoothingQuality = "high";
          const rim = document.createElement("canvas");
          const crop = { x: 330, y: 150, w: 120, h: 90, k: 5 };
          rim.width = (crop.w * crop.k + 8) * 3 - 8;
          rim.height = crop.h * crop.k;
          const r = rim.getContext("2d");
          r.imageSmoothingEnabled = false;
          pictures.forEach((p, i) => {
            const c = document.createElement("canvas");
            c.width = p.width;
            c.height = p.height;
            c.getContext("2d").putImageData(new ImageData(Uint8ClampedArray.from(p.data), p.width, p.height), 0, 0);
            g.drawImage(c, i * (w + 8), 0, w, h);
            r.drawImage(c, crop.x, crop.y, crop.w, crop.h, i * (crop.w * crop.k + 8), 0, crop.w * crop.k, crop.h * crop.k);
          });
          return { whole: whole.toDataURL("image/png").split(",")[1], rim: rim.toDataURL("image/png").split(",")[1] };
        },
        { pictures: [original, medium, strong] },
      );
      fs.writeFileSync(OUT + "blur-original-medium-strong.png", Buffer.from(side.whole, "base64"));
      fs.writeFileSync(OUT + "blur-rim-original-medium-strong.png", Buffer.from(side.rim, "base64"));
      return `detail on the wall ${mm.detail.after.toFixed(2)} (medium) -> ${ms.detail.after.toFixed(2)} (strong); the second try took ${(timings.blurRetryMs / 1000).toFixed(1)} s`;
    });

    await step("a cut-out with nothing behind it is left alone, and the message says why", async () => {
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 200;
        c.height = 200;
        const g = c.getContext("2d");
        g.fillStyle = "#ff8c00"; // an orange disc on nothing at all
        g.beginPath();
        g.arc(100, 100, 70, 0, Math.PI * 2);
        g.fill();
        return c.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "sticker-blur.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      const before = (await selected()).src;
      await page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name: "Edit image" }).click();
      await wait(600);
      await page.getByRole("tablist", { name: "Photo editing sections" }).getByRole("tab", { name: "Tools" }).click();
      await wait(500);
      await page.getByRole("button", { name: "Blur background" }).click();
      const deadline = Date.now() + 60000;
      let message = "";
      while (!message) {
        message = (await toasts()).find((t) => /nothing to blur|no background to blur|no subject/i.test(t)) || "";
        if (Date.now() > deadline) throw new Error("no message after a minute");
        await wait(200);
      }
      await wait(500);
      if ((await selected()).src !== before) throw new Error("the picture was changed");
      if (!/already transparent/.test(message)) throw new Error("the message does not say why: " + message.replace(/\s+/g, " "));
      return message.replace(/\s+/g, " ");
    });

    await step("a large photo (12 megapixels): the result is as large as the photo, and the page stays alive while it is blurred", async () => {
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 4000;
        c.height = 3000;
        window.__drawMug(c, { dots: true });
        return c.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "mug-dots-large.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      const before = (await selected()).src;
      await page.evaluate(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
        }).observe({ entryTypes: ["longtask"] });
      });
      timings.blurLargeMs = await blurAndWait(before, "Medium", { expectDialog: false });
      const tasks = await page.evaluate(() => window.__longTasks);
      timings.blurLargeLongestTaskMs = Math.max(0, ...tasks);
      await shot("blurred-large");
      const el = await selected();
      if (el.originalSrc !== before) throw new Error("the original was not remembered");
      if (el.naturalWidth !== 4000 || el.naturalHeight !== 3000) throw new Error("the picture is " + el.naturalWidth + " x " + el.naturalHeight + ", expected 4000 x 3000");
      if (timings.blurLargeLongestTaskMs > 1000) throw new Error("the page was blocked for " + timings.blurLargeLongestTaskMs + " ms at a time: " + tasks.join(", "));
      return `${(timings.blurLargeMs / 1000).toFixed(1)} s in all; the page was never blocked for more than ${timings.blurLargeLongestTaskMs} ms (${tasks.length} long tasks)`;
    });
  }

  if (RUN_POP) {
    let popOriginal = "";
    let blackAndWhiteSrc = "";

    /** Clicks Colour pop with a style (agreeing to the download when asked) and waits until the photo shows another picture, or a message says why not. */
    const popAndWait = async (before, style, { expectDialog = true } = {}) => {
      const button = page.getByRole("button", { name: "Colour pop" });
      if (!(await button.isVisible().catch(() => false))) {
        await page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name: "Edit image" }).click();
        await wait(600);
        await page.getByRole("tablist", { name: "Photo editing sections" }).getByRole("tab", { name: "Tools" }).click();
        await wait(500);
      }
      await page.getByRole("radio", { name: style }).click();
      const alreadyShown = (await toasts()).length; // messages of earlier steps do not count
      const started = Date.now();
      await button.click();
      const dialog = page.getByRole("dialog");
      if (
        await dialog
          .waitFor({ timeout: expectDialog ? 4000 : 250 })
          .then(() => true)
          .catch(() => false)
      ) {
        await dialog.getByRole("button", { name: "Download 88.1 MB" }).click();
        await page
          .getByRole("progressbar", { name: "Downloading the model" })
          .waitFor({ timeout: 30000 })
          .catch(() => undefined);
      }
      const deadline = Date.now() + 600000;
      for (;;) {
        const now = await selected();
        if (now && now.src !== before) break;
        const shown = (await toasts()).slice(alreadyShown);
        const failure = shown.find((t) =>
          /could not|ran out|isn't|interrupted|didn't|not used|no subject|changed while|cancelled|can't|no colour to take out|no background to change/i.test(t),
        );
        if (failure) throw new Error("the job failed: " + failure.replace(/\s+/g, " "));
        if (Date.now() > deadline) throw new Error("no new picture and no message after 10 minutes");
        await wait(150);
      }
      await wait(500);
      return Date.now() - started;
    };

    /** What a colour pop did: the mug (how many numbers changed), how grey the wall is, and how much colour is left on the wall right next to the mug. */
    const measurePop = (original, result) =>
      page.evaluate(
        ({ original, result }) => {
          const W = original.width;
          const spreadOf = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
          /** the mean and the largest spread (largest minus smallest of red, green and blue) of a patch */
          const spread = (d, x0, y0, x1, y1) => {
            let sum = 0;
            let n = 0;
            let max = 0;
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const s = spreadOf(d, (y * W + x) * 4);
                sum += s;
                n++;
                if (s > max) max = s;
              }
            }
            return { mean: sum / n, max };
          };
          let changed = 0;
          let total = 0;
          let worst = 0;
          for (let y = 260; y < 520; y++) {
            for (let x = 320; x < 640; x++) {
              for (let k = 0; k < 3; k++) {
                const d = Math.abs(result.data[(y * W + x) * 4 + k] - original.data[(y * W + x) * 4 + k]);
                total++;
                if (d) changed++;
                if (d > worst) worst = d;
              }
            }
          }
          let opaque = true;
          for (let i = 3; i < result.data.length; i += 4) if (result.data[i] !== 255) opaque = false;
          return {
            size: [result.width, result.height],
            mime: result.mime,
            opaque,
            mug: { changedShare: changed / total, worst },
            mugSpread: { before: spread(original.data, 320, 260, 640, 520).mean, after: spread(result.data, 320, 260, 640, 520).mean },
            wall: { before: spread(original.data, 0, 0, 240, 150), after: spread(result.data, 0, 0, 240, 150) },
            rim: { before: spread(original.data, 254, 300, 260, 500), after: spread(result.data, 254, 300, 260, 500) }, // within six pixels of the mug
            near: { before: spread(original.data, 236, 300, 250, 500), after: spread(result.data, 236, 300, 250, 500) }, // ten to twenty-four pixels away
          };
        },
        { original, result },
      );

    await step("setup (colour pop): a mug in front of a wall of strong colour, uploaded and placed on a new presentation", async () => {
      await page.goto(BASE + "/#/", { waitUntil: "load" });
      await page.getByText("What will you design today?").waitFor({ timeout: 20000 });
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 960;
        c.height = 720;
        window.__drawMug(c, { colour: true });
        return c.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "mug-colour.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      popOriginal = (await selected()).src;
    });

    await step("Colour pop (black and white): agree to the download if it is needed, and get a picture as large as the photo", async () => {
      timings.popFirstMs = await popAndWait(popOriginal, "Black & white");
      await shot("colour-pop");
      const el = await selected();
      blackAndWhiteSrc = el.src;
      if (el.originalSrc !== popOriginal) throw new Error("the original was not remembered");
      if (el.naturalWidth !== 960 || el.naturalHeight !== 720) throw new Error("the picture is " + el.naturalWidth + " x " + el.naturalHeight + ", expected 960 x 720");
      return `${(timings.popFirstMs / 1000).toFixed(1)} s from the click (download included when one was needed); ${hostRequests.length} request(s) to the model host`;
    });

    await step("the mug keeps every colour, the wall turns grey, and what is left of the wall's colour next to the mug is faint", async () => {
      const [result, original] = await Promise.all([readAsset(blackAndWhiteSrc), readAsset(popOriginal)]);
      const m = await measurePop(original, result);
      timings.popMug = m.mug;
      timings.popRim = { before: Math.round(m.rim.before.mean), after: Math.round(m.rim.after.mean), worst: m.rim.after.max };
      if (m.mime !== "image/png" || m.size.join("x") !== "960x720") throw new Error("the picture is " + m.mime + " " + m.size.join("x"));
      if (!m.opaque) throw new Error("the picture has transparent pixels");
      if (m.mugSpread.before < 40) throw new Error("the mug of the test picture has no colour: " + m.mugSpread.before.toFixed(0));
      if (m.mug.worst > 12) throw new Error("the mug changed by up to " + m.mug.worst + " of 255");
      if (m.wall.before.mean < 60) throw new Error("the wall of the test picture has no colour: " + m.wall.before.mean.toFixed(0));
      if (m.wall.after.max > 6)
        throw new Error("the wall is not grey: its colours still differ by up to " + m.wall.after.max + " (they differed by " + m.wall.before.mean.toFixed(0) + " on average)");
      if (m.near.after.max > 12) throw new Error("the wall ten to twenty-four pixels from the mug still has colour: up to " + m.near.after.max);
      if (m.rim.after.mean > m.rim.before.mean * 0.4)
        throw new Error("the wall within six pixels of the mug keeps too much colour: " + m.rim.after.mean.toFixed(0) + " of " + m.rim.before.mean.toFixed(0));
      return `wall colour ${m.wall.before.mean.toFixed(0)} -> ${m.wall.after.max} at most; mug: ${(m.mug.changedShare * 100).toFixed(1)} % of its numbers changed, by at most ${m.mug.worst}; the rim of the wall next to the mug keeps ${m.rim.after.mean.toFixed(0)} of ${m.rim.before.mean.toFixed(0)} (largest ${m.rim.after.max}), ten to twenty-four pixels away ${m.near.after.max} at most`;
    });

    await step("Undo, then the faded style on the same photo: no second wait for the model, and some colour stays on the wall", async () => {
      await page.evaluate(() => window.__editor.getState().actions.undo());
      await wait(500);
      if ((await selected()).src !== popOriginal) throw new Error("undo did not bring the original back");
      timings.popRetryMs = await popAndWait(popOriginal, "Faded", { expectDialog: false });
      await shot("colour-pop-faded");
      const fadedSrc = (await selected()).src;
      const [faded, bw, original] = await Promise.all([readAsset(fadedSrc), readAsset(blackAndWhiteSrc), readAsset(popOriginal)]);
      const [mf, mb] = await Promise.all([measurePop(original, faded), measurePop(original, bw)]);
      if (!(mf.wall.after.mean > mb.wall.after.mean + 20 && mf.wall.after.mean < mf.wall.before.mean - 20))
        throw new Error(
          "the faded wall is not between grey and colour: " + mb.wall.after.mean.toFixed(0) + ", " + mf.wall.after.mean.toFixed(0) + ", " + mf.wall.before.mean.toFixed(0),
        );
      if (mf.mug.worst > 12) throw new Error("the mug changed by up to " + mf.mug.worst + " with the faded style");
      if (timings.popRetryMs > 3500) throw new Error("the second try took " + timings.popRetryMs + " ms: the model was probably asked again");
      // the three pictures side by side, and the same place on each, enlarged: the left edge of the mug, where the mask's soft edge is
      const side = await page.evaluate(
        ({ pictures }) => {
          const w = 480;
          const h = 360;
          const whole = document.createElement("canvas");
          whole.width = w * 3 + 16;
          whole.height = h;
          const g = whole.getContext("2d");
          g.imageSmoothingQuality = "high";
          const rim = document.createElement("canvas");
          const crop = { x: 235, y: 380, w: 60, h: 45, k: 10 };
          rim.width = (crop.w * crop.k + 8) * 3 - 8;
          rim.height = crop.h * crop.k;
          const r = rim.getContext("2d");
          r.imageSmoothingEnabled = false;
          pictures.forEach((p, i) => {
            const c = document.createElement("canvas");
            c.width = p.width;
            c.height = p.height;
            c.getContext("2d").putImageData(new ImageData(Uint8ClampedArray.from(p.data), p.width, p.height), 0, 0);
            g.drawImage(c, i * (w + 8), 0, w, h);
            r.drawImage(c, crop.x, crop.y, crop.w, crop.h, i * (crop.w * crop.k + 8), 0, crop.w * crop.k, crop.h * crop.k);
          });
          return { whole: whole.toDataURL("image/png").split(",")[1], rim: rim.toDataURL("image/png").split(",")[1] };
        },
        { pictures: [original, bw, faded] },
      );
      fs.writeFileSync(OUT + "colour-pop-original-bw-faded.png", Buffer.from(side.whole, "base64"));
      fs.writeFileSync(OUT + "colour-pop-rim-original-bw-faded.png", Buffer.from(side.rim, "base64"));
      return `colour left on the wall: ${mb.wall.after.mean.toFixed(0)} (black and white), ${mf.wall.after.mean.toFixed(0)} (faded), ${mf.wall.before.mean.toFixed(0)} (before); the second try took ${(timings.popRetryMs / 1000).toFixed(1)} s`;
    });

    await step("a cut-out with nothing behind it is left alone, and the message says why", async () => {
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 200;
        c.height = 200;
        const g = c.getContext("2d");
        g.fillStyle = "#ff8c00"; // an orange disc on nothing at all
        g.beginPath();
        g.arc(100, 100, 70, 0, Math.PI * 2);
        g.fill();
        return c.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "sticker-pop.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      const before = (await selected()).src;
      await page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name: "Edit image" }).click();
      await wait(600);
      await page.getByRole("tablist", { name: "Photo editing sections" }).getByRole("tab", { name: "Tools" }).click();
      await wait(500);
      const alreadyShown = (await toasts()).length;
      await page.getByRole("button", { name: "Colour pop" }).click();
      const deadline = Date.now() + 60000;
      let message = "";
      while (!message) {
        message = (await toasts()).slice(alreadyShown).find((t) => /no colour to take out|no background to change|no subject/i.test(t)) || "";
        if (Date.now() > deadline) throw new Error("no message after a minute");
        await wait(200);
      }
      await wait(500);
      if ((await selected()).src !== before) throw new Error("the picture was changed");
      if (!/already black and white, or transparent/.test(message)) throw new Error("the message does not say why: " + message.replace(/\s+/g, " "));
      return message.replace(/\s+/g, " ");
    });

    await step("a large photo (12 megapixels): the result is as large as the photo, and the page stays alive while the colour goes", async () => {
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 4000;
        c.height = 3000;
        window.__drawMug(c, { colour: true });
        return c.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "mug-colour-large.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      const before = (await selected()).src;
      await page.evaluate(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
        }).observe({ entryTypes: ["longtask"] });
      });
      timings.popLargeMs = await popAndWait(before, "Black & white", { expectDialog: false });
      const tasks = await page.evaluate(() => window.__longTasks);
      timings.popLargeLongestTaskMs = Math.max(0, ...tasks);
      await shot("colour-pop-large");
      const el = await selected();
      if (el.originalSrc !== before) throw new Error("the original was not remembered");
      if (el.naturalWidth !== 4000 || el.naturalHeight !== 3000) throw new Error("the picture is " + el.naturalWidth + " x " + el.naturalHeight + ", expected 4000 x 3000");
      if (timings.popLargeLongestTaskMs > 1000) throw new Error("the page was blocked for " + timings.popLargeLongestTaskMs + " ms at a time: " + tasks.join(", "));
      return `${(timings.popLargeMs / 1000).toFixed(1)} s in all; the page was never blocked for more than ${timings.popLargeLongestTaskMs} ms (${tasks.length} long tasks)`;
    });
  }

  if (RUN_UPSCALER) {
    /** Clicks Upscale (agreeing to the download when asked) and waits until the photo shows another picture, or a message says why not. */
    const upscaleAndWait = async (before, { expectDialog = true } = {}) => {
      await page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name: "Edit image" }).click();
      await wait(600);
      await page.getByRole("tablist", { name: "Photo editing sections" }).getByRole("tab", { name: "Tools" }).click();
      await wait(500);
      const started = Date.now();
      await page.getByRole("button", { name: "Upscale", exact: true }).click();
      const dialog = page.getByRole("dialog");
      // the question comes at once when the model is missing; once it is installed there is none, so do not wait for it
      if (
        await dialog
          .waitFor({ timeout: expectDialog ? 4000 : 250 })
          .then(() => true)
          .catch(() => false)
      ) {
        await dialog.getByRole("button", { name: "Download 4.9 MB" }).click();
        await page
          .getByRole("progressbar", { name: "Downloading the model" })
          .waitFor({ timeout: 30000 })
          .catch(() => undefined);
      }
      const deadline = Date.now() + 600000;
      let shownProgress = false;
      for (;;) {
        const now = await selected();
        if (now && now.src !== before) break;
        if (!shownProgress && (await page.getByRole("progressbar", { name: "Making the photo larger" }).count())) {
          shownProgress = true;
          await shot("upscaling");
        }
        const shown = await toasts();
        const failure = shown.find((t) => /could not|ran out|isn't|interrupted|didn't|not used|too large|changed while|cancelled|can't/i.test(t));
        if (failure) throw new Error("the job failed: " + failure.replace(/\s+/g, " "));
        if (Date.now() > deadline) throw new Error("no new picture and no message after 10 minutes");
        await wait(300);
      }
      await wait(600);
      return Date.now() - started;
    };

    let softSrc = "";
    let softBox = [0, 0];
    await step("setup (upscaler): a small, soft picture of the mug, uploaded and placed on a new presentation", async () => {
      const png = await page.evaluate(() => {
        // a small photograph is soft: draw the scene big and shrink it with a little blur
        const big = document.createElement("canvas");
        big.width = 960;
        big.height = 720;
        window.__drawMug(big);
        const small = document.createElement("canvas");
        small.width = 240;
        small.height = 180;
        const g = small.getContext("2d");
        g.filter = "blur(0.9px)";
        g.imageSmoothingQuality = "high";
        g.drawImage(big, 0, 0, 240, 180);
        return small.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "mug-small.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      const first = await selected();
      softSrc = first.src;
      softBox = [first.width, first.height];
    });

    await step("Upscale 2x: agree to the download if it is needed, and get a picture twice as large", async () => {
      timings.upscaleMs = await upscaleAndWait(softSrc);
      await shot("upscaled");
      const el = await selected();
      if (el.originalSrc !== softSrc) throw new Error("the original was not remembered");
      if (el.naturalWidth !== 480 || el.naturalHeight !== 360) throw new Error("the picture is " + el.naturalWidth + " x " + el.naturalHeight + ", expected 480 x 360");
      if (el.width !== softBox[0] || el.height !== softBox[1]) throw new Error("the photo changed its size on the page: " + el.width + " x " + el.height);
      return `${(timings.upscaleMs / 1000).toFixed(1)} s from the click (download included when one was needed); ${hostRequests.length} request(s) to the model host`;
    });

    await step("the result is sharper than a plain stretch of the original, and has the same colours", async () => {
      const el = await selected();
      const [result, original] = await Promise.all([readAsset(el.src), readAsset(softSrc)]);
      const analysis = await page.evaluate(
        async ({ result, original }) => {
          const toCanvas = (img) => {
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            c.getContext("2d").putImageData(new ImageData(Uint8ClampedArray.from(img.data), img.width, img.height), 0, 0);
            return c;
          };
          const src = toCanvas(original);
          const stretched = document.createElement("canvas");
          stretched.width = result.width;
          stretched.height = result.height;
          const sg = stretched.getContext("2d");
          sg.imageSmoothingQuality = "high";
          sg.drawImage(src, 0, 0, result.width, result.height);
          const plain = sg.getImageData(0, 0, result.width, result.height).data;
          // the energy of the differences between neighbouring pixels: a sharp edge has it all in one step, a soft edge spreads it thin
          const energy = (data, w, h) => {
            let sum = 0;
            for (let y = 0; y < h - 1; y++) {
              for (let x = 0; x < w - 1; x++) {
                const i = (y * w + x) * 4;
                const l = (j) => 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
                const dx = l(i + 4) - l(i);
                const dy = l(i + w * 4) - l(i);
                sum += dx * dx + dy * dy;
              }
            }
            return sum;
          };
          let diff = 0;
          for (let i = 0; i < plain.length; i += 4)
            diff += Math.abs(result.data[i] - plain[i]) + Math.abs(result.data[i + 1] - plain[i + 1]) + Math.abs(result.data[i + 2] - plain[i + 2]);
          const sharp = energy(result.data, result.width, result.height);
          const soft = energy(plain, result.width, result.height);
          // the handle's edge: a stretch (left) next to the model's picture (right), enlarged to look at
          const x0 = 340;
          const y0 = 140;
          const w = 90;
          const h = 70;
          const k = 4;
          const side = document.createElement("canvas");
          side.width = w * k * 2 + 8;
          side.height = h * k;
          const g = side.getContext("2d");
          g.imageSmoothingEnabled = false;
          const a = document.createElement("canvas");
          a.width = result.width;
          a.height = result.height;
          a.getContext("2d").putImageData(new ImageData(Uint8ClampedArray.from(result.data), result.width, result.height), 0, 0);
          g.drawImage(stretched, x0, y0, w, h, 0, 0, w * k, h * k);
          g.drawImage(a, x0, y0, w, h, w * k + 8, 0, w * k, h * k);
          return { sharpRatio: sharp / soft, meanDiff: diff / (result.width * result.height * 3), side: side.toDataURL("image/png").split(",")[1] };
        },
        { result, original, outDir: OUT },
      );
      fs.writeFileSync(OUT + "stretch-vs-model.png", Buffer.from(analysis.side, "base64"));
      if (result.width !== 480 || result.height !== 360) throw new Error("the picture is " + result.width + " x " + result.height);
      if (result.mime !== "image/png") throw new Error("not a PNG: " + result.mime);
      if (!(analysis.sharpRatio > 1.15)) throw new Error("the picture is not sharper than a stretch: edge energy ratio " + analysis.sharpRatio.toFixed(2));
      if (!(analysis.meanDiff < 25)) throw new Error("the colours moved away from the original: mean difference " + analysis.meanDiff.toFixed(1));
      return `480x360 PNG; edges ${analysis.sharpRatio.toFixed(2)} times as sharp as a stretch; mean colour difference ${analysis.meanDiff.toFixed(1)} of 255`;
    });

    await step("Restore original brings the small picture back", async () => {
      await page.getByRole("button", { name: "Restore original" }).click();
      await wait(500);
      const el = await selected();
      if (el.src !== softSrc) throw new Error("restore did not bring the original back");
      if (el.naturalWidth !== 240 || el.naturalHeight !== 180) throw new Error("the size is " + el.naturalWidth + " x " + el.naturalHeight);
    });

    await step("a picture with transparency keeps it, and its edge has no dark fringe", async () => {
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 160;
        c.height = 160;
        const g = c.getContext("2d");
        g.fillStyle = "#ff8c00"; // an orange disc on nothing at all
        g.beginPath();
        g.arc(80, 80, 55, 0, Math.PI * 2);
        g.fill();
        return c.toDataURL("image/png").split(",")[1];
      });
      const file = OUT + "sticker.png";
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      await placePhoto(file);
      const before = (await selected()).src;
      timings.stickerMs = await upscaleAndWait(before, { expectDialog: false }); // the model is installed by now: no question
      const el = await selected();
      const result = await readAsset(el.src);
      const at = (x, y) => result.data.slice((y * result.width + x) * 4, (y * result.width + x) * 4 + 4);
      let soft = 0;
      let off = 0;
      for (let i = 0; i < result.data.length; i += 4) {
        const a = result.data[i + 3];
        if (a > 20 && a < 235) {
          soft++;
          const r = result.data[i];
          const g = result.data[i + 1];
          const b = result.data[i + 2];
          if (r < 220 || Math.abs(g - 140) > 50 || b > 80) off++;
        }
      }
      if (result.width !== 320 || result.height !== 320) throw new Error("the picture is " + result.width + " x " + result.height);
      if (at(160, 160)[3] !== 255) throw new Error("the middle is not solid: " + at(160, 160));
      if (at(2, 2)[3] !== 0) throw new Error("the corner is not transparent: " + at(2, 2));
      if (soft < 100) throw new Error("only " + soft + " soft edge pixels: the transparency was not kept");
      if (off / soft > 0.05) throw new Error(off + " of " + soft + " edge pixels are not orange: a fringe");
      await shot("sticker-upscaled");
      return `320x320, ${soft} soft edge pixels, ${off} off-colour; ${(timings.stickerMs / 1000).toFixed(1)} s`;
    });
  }

  await step("File > On-device models shows the model as installed", async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /On-device models/ }).click();
    const dialog = page.getByRole("dialog", { name: "On-device models" });
    await dialog.waitFor({ timeout: 8000 });
    await wait(500);
    const text = await dialog.innerText();
    if (!text.includes("Installed")) throw new Error("not shown as installed");
    await shot("models-installed");
    return /kept until you remove/.test(text) ? "installed and protected from clean-up" : "installed (the browser has not promised to keep it)";
  });

  const shown = await toasts();
  console.log(results.join("\n"));
  console.log("timings:", JSON.stringify(timings));
  console.log("requests to the model host this run:", hostRequests.length);
  console.log("toasts:", JSON.stringify(shown));
  console.log("[craftly] console lines:", JSON.stringify(craftlyLines));
  console.log("worker console:", JSON.stringify(workerLines.slice(0, 12)));
  console.log(
    "page errors:",
    JSON.stringify(logs.filter((l) => !/onnxruntime/.test(l)).slice(0, 5)),
    "(ONNX Runtime warnings left out:",
    logs.filter((l) => /onnxruntime/.test(l)).length,
    ")",
  );
  console.log("shots in", OUT, "| browser profile (holds the model):", PROFILE);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await context.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
