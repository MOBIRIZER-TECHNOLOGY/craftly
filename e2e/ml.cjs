/*
 * On-device photo tools, checked in a real browser WITHOUT downloading a model: a tiny hand-made model
 * (e2e/syntheticModel.cjs) goes through the real ONNX runtime, the real worker and this computer's GPU.
 *   1. the consent gate: the Tools tab never contacts the model host until the person agrees
 *   (steps 2 and 3, and the offline step, need a WebGPU adapter and are skipped where the browser has none, as on most CI machines)
 *   2. the worker on its own (dev server or production build): boots, loads the runtime and its WebAssembly file, runs
 *      on WebGPU, answers with an exact mask and keeps the model for the next picture
 *   3. (dev server only) the job layer with that model standing in for the real one: install into IndexedDB, cut a photo
 *      out into a new picture with real transparency, undo, and restore the original
 * The real model is checked by e2e/ml-real.cjs, which downloads it (about 115 MB) and is not part of `npm run e2e`.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");
const { syntheticModel, syntheticUpscaler } = require("./syntheticModel.cjs");

const OUT = outDir("ml");
const results = [];
let shots = 0;

/** A 64 x 48 PNG made on the fly, for the upload step. */
function makePng(w, h) {
  const zlib = require("node:zlib");
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round((x / w) * 255);
      raw[o + 1] = Math.round((y / h) * 255);
      raw[o + 2] = 160;
      raw[o + 3] = 255;
    }
  }
  const table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_PATH = OUT + "upload.png";
fs.writeFileSync(PNG_PATH, makePng(64, 48));

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // NO_GPU=1 takes WebGPU away from the page, to try on a machine with a graphics card what a CI machine without one sees
  if (process.env.NO_GPU) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
  const page = await ctx.newPage();
  const logs = [];
  const hostRequests = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console.error: " + m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message.slice(0, 240)));
  page.on("request", (r) => {
    if (/huggingface\.co/.test(r.url())) hostRequests.push(r.url());
  });

  const shot = (name) => page.screenshot({ path: OUT + String(++shots).padStart(2, "0") + "-" + name + ".png" });
  const step = async (name, fn) => {
    try {
      const note = await fn();
      results.push("PASS " + name + (note ? "  " + note : ""));
    } catch (e) {
      results.push("FAIL " + name + "  -> " + String(e.message).split("\n")[0].slice(0, 260));
      try {
        await shot("FAIL-" + name.replace(/\W+/g, "_").slice(0, 30));
      } catch {}
    }
  };
  const wait = (ms) => page.waitForTimeout(ms);
  /** the name of what has the keyboard focus right now */
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el ? (el.getAttribute("aria-label") || el.innerText || "").trim() : "";
    });

  /* ------------------------------------------------------------------ 1. the consent gate */
  await step("setup: new presentation with an uploaded photo, selected", async () => {
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
    await page.locator("input[type=file]").first().setInputFiles(PNG_PATH);
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
    const kind = await page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return pg.elements.find((e) => e.id === s.selection[0])?.type;
    });
    if (kind !== "image") throw new Error("no photo selected, got " + kind);
  });

  await step("Edit image > Tools tab shows Remove background, Blur background, Colour pop and Upscale, and what the first use of each costs", async () => {
    await page.locator("[role=toolbar]:not(.cf-rail)").getByRole("button", { name: "Edit image" }).click();
    await wait(600);
    await page.getByRole("tablist", { name: "Photo editing sections" }).getByRole("tab", { name: "Tools" }).click();
    await wait(600);
    await shot("tools-tab");
    const button = page.getByRole("button", { name: "Remove background" });
    if (!(await button.isVisible())) throw new Error("no Remove background button");
    if (!(await page.getByRole("button", { name: "Blur background" }).isVisible())) throw new Error("no Blur background button");
    if (!(await page.getByRole("button", { name: "Colour pop" }).isVisible())) throw new Error("no Colour pop button");
    if (!(await page.getByRole("button", { name: "Upscale", exact: true }).isVisible())) throw new Error("no Upscale button");
    for (const style of ["Black & white", "Faded"]) if (!(await page.getByRole("radio", { name: style }).isVisible())) throw new Error("no " + style + " choice");
    if ((await page.getByRole("radio", { name: "Black & white" }).getAttribute("aria-checked")) !== "true") throw new Error("Black & white is not the first choice");
    for (const strength of ["Light", "Medium", "Strong"]) if (!(await page.getByRole("radio", { name: strength }).isVisible())) throw new Error("no " + strength + " choice");
    if ((await page.getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")) !== "true") throw new Error("Medium is not the first choice");
    for (const factor of ["2×", "4×"]) if (!(await page.getByRole("radio", { name: factor }).isVisible())) throw new Error("no " + factor + " choice");
    if ((await page.getByRole("radio", { name: "2×" }).getAttribute("aria-checked")) !== "true") throw new Error("2× is not the first choice");
    const text = await page.locator(".cf-sidepanel").innerText();
    if ((text.match(/88\.1 MB/g) || []).length < 3) throw new Error("the download size of the remover's model is not shown for the three tools that use it");
    if (!/4\.9 MB/.test(text)) throw new Error("the download size of the upscaler is not shown");
    if (!/→/.test(text)) throw new Error("the size of the result is not shown");
    if ((text.match(/On-device/g) || []).length < 5) throw new Error("the On-device badges are not shown");
    return "all four tools, the strengths and styles, the factors, the sizes and the badges are there";
  });

  // Without a graphics card that WebGPU can use (most CI machines) the tools cannot start, so the page switches them off and says why:
  // the questions below need a tool that can be clicked, and are skipped there like the steps that run a model.
  const gpu = await page.evaluate(async () => {
    try {
      return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch {
      return false;
    }
  });
  /** A step that needs the real GPU: skipped, and said so, where the browser has no WebGPU adapter. */
  const gpuStep = (name, fn) => (gpu ? step(name, fn) : Promise.resolve(results.push("SKIP " + name + "  (this browser has no WebGPU adapter)")));
  if (!gpu) {
    await step("without WebGPU the four tools are switched off, the tab says why, and nothing is sent to the model host", async () => {
      for (const name of ["Remove background", "Blur background", "Colour pop", "Upscale"]) {
        if (!(await page.getByRole("button", { name }).isDisabled())) throw new Error(name + " can be clicked in a browser that cannot run it");
      }
      const text = await page.locator(".cf-sidepanel").innerText();
      if (!/WebGPU/.test(text)) throw new Error("the tab does not say that WebGPU is what is missing");
      if (hostRequests.length) throw new Error("contacted the model host: " + hostRequests[0]);
      return "all four off, and the reason is on the tab";
    });
  }

  await gpuStep("clicking Remove background asks first and sends nothing to the model host while the answer is no", async () => {
    await page.getByRole("button", { name: "Remove background" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 8000 });
    const text = await dialog.innerText();
    for (const part of ["Download the background remover?", "88.1 MB", "huggingface.co", "never uploaded", "Apache-2.0"]) {
      if (!text.includes(part)) throw new Error("the question does not say: " + part);
    }
    await shot("consent");
    // the safe answer has the keyboard, so that a held or doubled Enter cannot agree to a large download
    if ((await focused()) !== "Not now") throw new Error("the question did not start on Not now: " + (await focused()));
    await dialog.getByRole("button", { name: "Not now" }).click();
    await wait(900);
    // and when it is answered, the keyboard goes back to the tool that asked
    if (!(await focused()).startsWith("Remove background")) throw new Error("the keyboard did not go back to the tool: " + (await focused()));
    if (hostRequests.length) throw new Error("contacted the model host: " + hostRequests[0]);
    const src = await page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return pg.elements.find((e) => e.id === s.selection[0])?.src;
    });
    if (!/^asset:/.test(src)) throw new Error("the photo changed: " + src);
    return "0 requests to the host";
  });

  await gpuStep("clicking Blur background asks first too, about the same model, and sends nothing to the model host while the answer is no", async () => {
    await page.getByRole("button", { name: "Blur background" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 8000 });
    const text = await dialog.innerText();
    for (const part of ["Download the background remover?", "88.1 MB", "huggingface.co", "never uploaded", "Apache-2.0"]) {
      if (!text.includes(part)) throw new Error("the question does not say: " + part);
    }
    await shot("consent-blur");
    // the safe answer has the keyboard, so that a held or doubled Enter cannot agree to a large download
    if ((await focused()) !== "Not now") throw new Error("the question did not start on Not now: " + (await focused()));
    await dialog.getByRole("button", { name: "Not now" }).click();
    await wait(900);
    // and when it is answered, the keyboard goes back to the tool that asked
    if (!(await focused()).startsWith("Blur background")) throw new Error("the keyboard did not go back to the tool: " + (await focused()));
    if (hostRequests.length) throw new Error("contacted the model host: " + hostRequests[0]);
    const src = await page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return pg.elements.find((e) => e.id === s.selection[0])?.src;
    });
    if (!/^asset:/.test(src)) throw new Error("the photo changed: " + src);
    return "0 requests to the host";
  });

  await gpuStep("clicking Colour pop asks first too, about the same model, and sends nothing to the model host while the answer is no", async () => {
    await page.getByRole("button", { name: "Colour pop" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 8000 });
    const text = await dialog.innerText();
    for (const part of ["Download the background remover?", "88.1 MB", "huggingface.co", "never uploaded", "Apache-2.0"]) {
      if (!text.includes(part)) throw new Error("the question does not say: " + part);
    }
    await shot("consent-colour-pop");
    // the safe answer has the keyboard, so that a held or doubled Enter cannot agree to a large download
    if ((await focused()) !== "Not now") throw new Error("the question did not start on Not now: " + (await focused()));
    await dialog.getByRole("button", { name: "Not now" }).click();
    await wait(900);
    // and when it is answered, the keyboard goes back to the tool that asked
    if (!(await focused()).startsWith("Colour pop")) throw new Error("the keyboard did not go back to the tool: " + (await focused()));
    if (hostRequests.length) throw new Error("contacted the model host: " + hostRequests[0]);
    const src = await page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return pg.elements.find((e) => e.id === s.selection[0])?.src;
    });
    if (!/^asset:/.test(src)) throw new Error("the photo changed: " + src);
    return "0 requests to the host";
  });

  await gpuStep("clicking Upscale asks first too, and sends nothing to the model host while the answer is no", async () => {
    await page.getByRole("button", { name: "Upscale", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 8000 });
    const text = await dialog.innerText();
    for (const part of ["Download the upscaler?", "4.9 MB", "huggingface.co", "never uploaded", "BSD-3-Clause"]) {
      if (!text.includes(part)) throw new Error("the question does not say: " + part);
    }
    await shot("consent-upscaler");
    // the safe answer has the keyboard, so that a held or doubled Enter cannot agree to a large download
    if ((await focused()) !== "Not now") throw new Error("the question did not start on Not now: " + (await focused()));
    await dialog.getByRole("button", { name: "Not now" }).click();
    await wait(900);
    // and when it is answered, the keyboard goes back to the tool that asked
    if (!(await focused()).startsWith("Upscale")) throw new Error("the keyboard did not go back to the tool: " + (await focused()));
    if (hostRequests.length) throw new Error("contacted the model host: " + hostRequests[0]);
    const src = await page.evaluate(() => {
      const s = window.__editor.getState();
      const pg = s.design.pages.find((p) => p.id === s.activePageId);
      return pg.elements.find((e) => e.id === s.selection[0])?.src;
    });
    if (!/^asset:/.test(src)) throw new Error("the photo changed: " + src);
    return "0 requests to the host";
  });

  await step("Manage models opens the dialog with both models, their licences and the 'not downloaded' state", async () => {
    await page.getByRole("button", { name: "Manage models" }).click();
    const dialog = page.getByRole("dialog", { name: "On-device models" });
    await dialog.waitFor({ timeout: 8000 });
    await wait(500);
    const text = await dialog.innerText();
    for (const part of [
      "ISNet general-use",
      "Not downloaded",
      "88.1 MB",
      "Apache-2.0 licence",
      "Copyright the DIS authors",
      "Real-ESRGAN general x4 v3",
      "4.9 MB",
      "BSD-3-Clause licence",
      "Copyright (c) 2021, Xintao Wang",
      "never uploaded",
    ]) {
      if (!text.includes(part)) throw new Error("missing in the dialog: " + part);
    }
    const licences = dialog.getByRole("link", { name: "Licence" });
    if ((await licences.nth(0).getAttribute("href")) !== "https://github.com/xuebinqin/DIS/blob/main/LICENSE.md") throw new Error("wrong licence link for the remover");
    if (!(await licences.nth(1).getAttribute("href")).includes("xinntao/Real-ESRGAN")) throw new Error("wrong licence link for the upscaler");
    await shot("models-dialog");
    await dialog.getByRole("button", { name: "Done" }).click();
    await wait(500);
  });

  await step("File menu > On-device models opens the same dialog", async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /On-device models/ }).click();
    await page.getByRole("dialog", { name: "On-device models" }).waitFor({ timeout: 8000 });
    await page.keyboard.press("Escape");
    await wait(400);
  });

  /* ------------------------------------------------------------------ 2. the worker on its own */
  const model = syntheticModel(64);
  const upscaler = syntheticUpscaler(4);
  let workerUrl = "/src/ml/worker.ts";
  // a production build lists its files in precache.json; the dev server answers that path with the home page
  const precache = await page.evaluate(() =>
    fetch("precache.json")
      .then((r) => r.json())
      .catch(() => null),
  );
  const production = !!precache;

  /** Starts a fresh worker, runs the stand-in model twice and reports the masks and timings. */
  const runInWorker = () =>
    page.evaluate(
      async ({ workerUrl, base64, io }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const worker = new Worker(workerUrl, { type: "module" });
        const call = (message) =>
          new Promise((resolve, reject) => {
            const stages = [];
            const timer = setTimeout(() => reject(new Error("no answer from the worker in 120 s")), 120000);
            worker.onmessage = (e) => {
              const m = e.data;
              if (m.id !== message.id) return;
              if (m.type === "stage") stages.push(m.stage);
              else {
                clearTimeout(timer);
                resolve({ ...m, stages, mask: m.mask ? Array.from(m.mask) : undefined });
              }
            };
            worker.onerror = (e) => reject(new Error("worker error: " + (e.message || "unknown")));
            worker.postMessage(message, [message.rgba.buffer]);
          });
        const model = { id: "synthetic", sha256: "e2e", blob: new Blob([bytes]), io };
        const size = io.size;
        const rgba = new Uint8ClampedArray(size * size * 4);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const v = (x - 32) ** 2 + (y - 32) ** 2 <= 400 ? 255 : 0; // a white disc of radius 20 on black
            rgba.set([v, v, v, 255], (y * size + x) * 4);
          }
        }
        const t0 = performance.now();
        const first = await call({ id: 1, type: "run", model, rgba: rgba.slice() });
        const t1 = performance.now();
        const second = await call({ id: 2, type: "run", model, rgba: rgba.slice() });
        const t2 = performance.now();
        worker.terminate();
        return { first, second, firstMs: Math.round(t1 - t0), secondMs: Math.round(t2 - t1) };
      },
      { workerUrl, base64: model.base64, io: model.io },
    );
  await gpuStep("worker: boots, loads the ONNX runtime and its WebAssembly file, runs on WebGPU, answers with an exact mask", async () => {
    const pre = precache;
    if (pre) {
      workerUrl = BASE + "/" + pre.files.find((f) => /^assets\/worker-.*\.js$/.test(f));
      if (!pre.runtime || !pre.runtime.some((f) => f.endsWith(".wasm"))) throw new Error("the runtime file is not listed for the service worker");
      if (pre.files.some((f) => f.endsWith(".wasm"))) throw new Error("the runtime file is in the first-visit precache");
    }
    const out = await runInWorker();
    if (out.first.type !== "done") throw new Error(`first run failed: ${out.first.code} - ${out.first.message}`);
    if (out.second.type !== "done") throw new Error(`second run failed: ${out.second.code} - ${out.second.message}`);
    const mask = out.first.mask;
    if (mask.length !== 64 * 64) throw new Error("mask has " + mask.length + " pixels");
    const at = (x, y) => mask[y * 64 + x];
    if (at(32, 32) !== 255) throw new Error("the disc centre is " + at(32, 32) + ", not 255");
    if (at(2, 2) !== 0 || at(61, 61) !== 0) throw new Error("the corners are not 0");
    const covered = mask.filter((v) => v === 255).length;
    if (covered < 1230 || covered > 1290) throw new Error("the disc covers " + covered + " pixels, expected about 1257");
    if (out.first.stages.join(",") !== "runtime,model,inference") throw new Error("stages: " + out.first.stages.join(","));
    if (JSON.stringify(out.second.mask) !== JSON.stringify(mask)) throw new Error("the second run gave another mask");
    if (!(out.secondMs < out.firstMs)) throw new Error(`the model was not kept: ${out.firstMs} ms then ${out.secondMs} ms`);
    return `disc ${covered} px; first run ${out.firstMs} ms (runtime + GPU setup), second ${out.secondMs} ms; worker ${workerUrl}`;
  });

  await gpuStep("worker: makes a tile of a picture larger on WebGPU, every pixel where it belongs", async () => {
    const out = await page.evaluate(
      async ({ workerUrl, base64, io }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const worker = new Worker(workerUrl, { type: "module" });
        const width = 10;
        const height = 6;
        const pixels = new Float32Array(3 * width * height);
        for (let c = 0; c < 3; c++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[(c * height + y) * width + x] = ((c * 7 + y * 3 + x) % 17) / 16;
        const sent = pixels.slice();
        const answer = await new Promise((resolve, reject) => {
          const stages = [];
          const timer = setTimeout(() => reject(new Error("no answer from the worker in 120 s")), 120000);
          worker.onmessage = (e) => {
            const m = e.data;
            if (m.id !== 1) return;
            if (m.type === "stage") stages.push(m.stage);
            else {
              clearTimeout(timer);
              resolve({ ...m, stages });
            }
          };
          worker.onerror = (e) => reject(new Error("worker error: " + (e.message || "unknown")));
          worker.postMessage({ id: 1, type: "tile", model: { id: "synthetic-up", sha256: "e2e-up", blob: new Blob([bytes]), io }, pixels, width, height }, [pixels.buffer]);
        });
        worker.terminate();
        const scale = io.scale;
        let wrong = 0;
        if (answer.type === "tile-done") {
          for (let c = 0; c < 3; c++) {
            for (let Y = 0; Y < height * scale; Y++) {
              for (let X = 0; X < width * scale; X++) {
                if (answer.pixels[(c * height * scale + Y) * width * scale + X] !== sent[(c * height + Math.floor(Y / scale)) * width + Math.floor(X / scale)]) wrong++;
              }
            }
          }
        }
        return { type: answer.type, code: answer.code, message: answer.message, stages: answer.stages, length: answer.pixels ? answer.pixels.length : 0, wrong };
      },
      { workerUrl, base64: upscaler.base64, io: upscaler.io },
    );
    if (out.type !== "tile-done") throw new Error(`the tile failed: ${out.code} - ${out.message}`);
    if (out.length !== 3 * 40 * 24) throw new Error("the answer has " + out.length + " numbers, expected " + 3 * 40 * 24);
    if (out.wrong) throw new Error(out.wrong + " of " + out.length + " numbers are not where the original puts them");
    if (out.stages.join(",") !== "runtime,model,inference") throw new Error("stages: " + out.stages.join(","));
    return "10 x 6 became 40 x 24, all " + out.length + " numbers exact";
  });

  if (production) {
    await step("production: the service worker never copies a model file, and never stores a web page under a runtime file's name", async () => {
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload({ waitUntil: "load" }); // from now on the service worker controls the page
      await wait(1500);
      // the preview server answers any unknown path with the home page (200, text/html): the worst case for both rules
      const fetched = await page.evaluate(async () => {
        const model = await fetch("models/some-model.onnx");
        const runtime = await fetch("assets/fake-runtime.wasm");
        await new Promise((resolve) => setTimeout(resolve, 600)); // the worker stores copies after answering
        const names = await caches.keys();
        const urls = [];
        for (const name of names) for (const request of await (await caches.open(name)).keys()) urls.push(name + " " + new URL(request.url).pathname);
        return { modelStatus: model.status, runtimeStatus: runtime.status, urls };
      });
      if (fetched.modelStatus !== 200 || fetched.runtimeStatus !== 200) throw new Error("the test paths did not answer 200: " + JSON.stringify(fetched));
      if (fetched.urls.some((u) => u.endsWith("some-model.onnx"))) throw new Error("a model file was copied into a cache: " + fetched.urls.filter((u) => /onnx/.test(u)));
      if (fetched.urls.some((u) => u.endsWith("fake-runtime.wasm"))) throw new Error("a web page was stored under a runtime file's name");
      return "neither was stored";
    });

    await gpuStep("production: the service worker keeps the runtime file, and the worker still runs with the network off", async () => {
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload({ waitUntil: "load" }); // from now on the service worker controls the page
      await wait(2000);
      const online = await runInWorker(); // the runtime file is fetched through the service worker, which stores it
      if (online.first.type !== "done") throw new Error("online run failed: " + online.first.code + " " + online.first.message);
      const kept = await page.evaluate(async () => {
        const cache = await caches.open("craftly-runtime");
        return (await cache.keys()).map((r) => r.url);
      });
      if (!kept.some((u) => u.endsWith(".wasm"))) throw new Error("the runtime cache holds " + JSON.stringify(kept));
      await ctx.setOffline(true);
      try {
        const offline = await runInWorker();
        if (offline.first.type !== "done") throw new Error("offline run failed: " + offline.first.code + " " + offline.first.message);
        if (JSON.stringify(offline.first.mask) !== JSON.stringify(online.first.mask)) throw new Error("the offline mask differs");
      } finally {
        await ctx.setOffline(false);
      }
      return "stored " + kept.length + " file(s); the worker ran offline";
    });
  }

  /* ------------------------------------------------------------------ 3. the job layer (dev server only) */
  const hasModules = !production; // only the dev server serves the source modules
  if (!hasModules) {
    results.push("SKIP job layer with the stand-in model  (needs the dev server: it imports the source modules)");
  } else {
    await gpuStep("job layer: install into IndexedDB, cut the photo out with real transparency, undo, restore the original", async () => {
      const out = await page.evaluate(
        async ({ base64, sha256, io }) => {
          const [{ useEditor }, factory, assets, service, state, store] = await Promise.all([
            // the store the app runs on: an import of it can be a second copy on a dev server that has hot-reloaded a module it uses
            Promise.resolve({ useEditor: window.__editor }),
            import("/src/core/factory.ts"),
            import("/src/core/assets.ts"),
            import("/src/ml/service.ts"),
            import("/src/ml/state.ts"),
            import("/src/ml/modelStore.ts"),
          ]);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const spec = {
            id: "synthetic",
            task: "background-removal",
            tool: "Background remover",
            name: "Synthetic",
            summary: "test",
            repo: "none",
            revision: "0".repeat(40),
            file: "none",
            bytes: bytes.length,
            sha256,
            requires: "webgpu",
            io,
            licence: { name: "none", url: "https://example.test", notice: "none" },
            credit: { text: "none", url: "https://example.test" },
          };
          // everything real except which model it is and where its bytes come from
          const deps = {
            ...service.defaultDeps(),
            spec: (id) => (id === "synthetic" ? spec : undefined),
            defaultModel: () => "synthetic",
            download: async (_spec, options) => {
              options.onProgress?.(bytes.length, bytes.length);
              return new Blob([bytes]);
            },
          };

          // a photo: 320 x 240, a white disc (radius 70) on black, stored as an upload and placed on a page
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 240;
          const g = canvas.getContext("2d");
          g.fillStyle = "#000";
          g.fillRect(0, 0, 320, 240);
          g.fillStyle = "#fff";
          g.beginPath();
          g.arc(160, 120, 70, 0, Math.PI * 2);
          g.fill();
          const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          const asset = await assets.addAssetFromBlob(png, "Disc");
          const photo = factory.createImage({ src: assets.assetSrc(asset.id), x: 20, y: 20, width: 320, height: 240, naturalWidth: 320, naturalHeight: 240 });
          useEditor.getState().actions.openDesign(factory.createDesign({ width: 800, height: 600, pages: [factory.createPage({ elements: [photo] })] }));
          const find = () => useEditor.getState().design.pages[0].elements.find((e) => e.id === photo.id);

          let refusal = null;
          try {
            await service.removeBackground(photo.id, {}, deps);
          } catch (e) {
            refusal = e.code;
          }
          const installed = await service.installModel("synthetic", {}, deps);
          const kept = await store.getStoredModel("synthetic");
          const started = performance.now();
          const outcome = await service.removeBackground(photo.id, {}, deps);
          const jobMs = Math.round(performance.now() - started);

          const after = JSON.parse(JSON.stringify(find()));
          const cut = await assets.getAsset(after.src.slice(6));
          const bitmap = await createImageBitmap(cut.blob);
          const c2 = document.createElement("canvas");
          c2.width = bitmap.width;
          c2.height = bitmap.height;
          const g2 = c2.getContext("2d");
          g2.drawImage(bitmap, 0, 0);
          const px = (x, y) => Array.from(g2.getImageData(x, y, 1, 1).data);
          const pixels = { centre: px(160, 120), insideDisc: px(210, 120), outsideDisc: px(260, 120), corner: px(4, 4) };

          useEditor.getState().actions.undo();
          const undone = JSON.parse(JSON.stringify(find()));
          await service.removeBackground(photo.id, {}, deps);
          const second = JSON.parse(JSON.stringify(find()));
          await service.restoreOriginal(photo.id, deps);
          const restored = JSON.parse(JSON.stringify(find()));
          return {
            refusal,
            warmError: installed.warmError ? installed.warmError.code : null,
            kept: kept ? { sha: kept.sha256 === sha256, size: kept.blob.size === bytes.length } : null,
            outcome,
            jobMs,
            originalSrc: photo.src,
            after: { src: after.src, originalSrc: after.originalSrc, naturalWidth: after.naturalWidth, naturalHeight: after.naturalHeight },
            cutMime: cut.mime,
            cutSize: [cut.width, cut.height],
            pixels,
            undone: { src: undone.src, originalSrc: undone.originalSrc },
            secondCutAgain: second.originalSrc,
            restored: { src: restored.src, originalSrc: restored.originalSrc },
            jobAfter: state.useMlStore.getState().job,
          };
        },
        { base64: model.base64, sha256: model.sha256, io: model.io },
      );

      if (out.refusal !== "not-installed") throw new Error("the job did not refuse to run without the model: " + out.refusal);
      if (out.warmError) throw new Error("the warm-up failed: " + out.warmError);
      if (!out.kept || !out.kept.sha || !out.kept.size) throw new Error("the model was not kept in IndexedDB: " + JSON.stringify(out.kept));
      if (!out.outcome.applied || out.outcome.scaled) throw new Error("outcome " + JSON.stringify(out.outcome));
      if (out.after.src === out.originalSrc || !/^asset:/.test(out.after.src)) throw new Error("the photo still points at " + out.after.src);
      if (out.after.originalSrc !== out.originalSrc) throw new Error("the original was not remembered: " + out.after.originalSrc);
      if (out.after.naturalWidth !== 320 || out.after.naturalHeight !== 240) throw new Error("size changed: " + out.after.naturalWidth + "x" + out.after.naturalHeight);
      if (out.cutMime !== "image/png" || out.cutSize.join("x") !== "320x240") throw new Error("the cut-out is " + out.cutMime + " " + out.cutSize.join("x"));
      const { centre, insideDisc, outsideDisc, corner } = out.pixels;
      if (centre[3] !== 255 || centre[0] < 250) throw new Error("the disc centre should be solid white: " + centre);
      if (insideDisc[3] !== 255) throw new Error("a point inside the disc is not solid: " + insideDisc);
      if (outsideDisc[3] !== 0) throw new Error("a point outside the disc is not transparent: " + outsideDisc);
      if (corner[3] !== 0) throw new Error("the corner is not transparent: " + corner);
      if (out.undone.src !== out.originalSrc || out.undone.originalSrc !== undefined) throw new Error("undo did not bring the photo back: " + JSON.stringify(out.undone));
      if (out.secondCutAgain !== out.originalSrc) throw new Error("a second cut-out lost the original: " + out.secondCutAgain);
      if (out.restored.src !== out.originalSrc || out.restored.originalSrc !== undefined) throw new Error("restore did not work: " + JSON.stringify(out.restored));
      if (out.jobAfter !== null) throw new Error("a job is still marked as running");
      return `cut-out ${out.cutSize.join("x")} PNG, transparent outside the disc, solid inside; job ${out.jobMs} ms`;
    });

    await gpuStep("job layer (blur): the subject stays exactly as it was, the background is smoothed, the opacity is kept, a second try does not ask the model again", async () => {
      const out = await page.evaluate(
        async ({ base64, sha256, io }) => {
          const [{ useEditor }, factory, assets, service, state] = await Promise.all([
            // the store the app runs on: an import of it can be a second copy on a dev server that has hot-reloaded a module it uses
            Promise.resolve({ useEditor: window.__editor }),
            import("/src/core/factory.ts"),
            import("/src/core/assets.ts"),
            import("/src/ml/service.ts"),
            import("/src/ml/state.ts"),
          ]);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const spec = {
            id: "synthetic-blur",
            task: "background-removal",
            tool: "Background remover",
            name: "Synthetic",
            summary: "test",
            repo: "none",
            revision: "0".repeat(40),
            file: "none",
            bytes: bytes.length,
            sha256,
            requires: "webgpu",
            gpuFeatures: [],
            io,
            licence: { name: "none", url: "https://example.test", notice: "none" },
            credit: { text: "none", url: "https://example.test" },
          };
          // everything real except which model it is, where its bytes come from, and a count of how often the model is asked
          const base = service.defaultDeps();
          let modelRuns = 0;
          const deps = {
            ...base,
            client: { ...base.client, run: (...args) => (modelRuns++, base.client.run(...args)) },
            spec: (id) => (id === "synthetic-blur" ? spec : undefined),
            defaultModel: () => "synthetic-blur",
            download: async (_spec, options) => {
              options.onProgress?.(bytes.length, bytes.length);
              return new Blob([bytes]);
            },
          };
          await service.installModel("synthetic-blur", { warm: false }, deps);

          // a wall of wide red and blue stripes (the stand-in model reads brightness, which these share), a white disc in front.
          // The stand-in reads the wall as 8 % subject, so 8 % of its stripes stay: that is why the steps below are not 0.
          const W = 320;
          const H = 240;
          const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
          const g = canvas.getContext("2d");
          for (let x = 0; x < W; x += 20) {
            g.fillStyle = (x / 20) % 2 ? "rgb(0,0,60)" : "rgb(60,0,0)";
            g.fillRect(x, 0, 20, H);
          }
          g.fillStyle = "#fff";
          g.beginPath();
          g.arc(160, 120, 60, 0, Math.PI * 2);
          g.fill();
          const original = g.getImageData(0, 0, W, H);
          const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          const asset = await assets.addAssetFromBlob(png, "Wall");
          const photo = factory.createImage({ src: assets.assetSrc(asset.id), x: 20, y: 20, width: W, height: H, naturalWidth: W, naturalHeight: H });
          useEditor.getState().actions.openDesign(factory.createDesign({ width: 800, height: 600, pages: [factory.createPage({ elements: [photo] })] }));
          const find = () => JSON.parse(JSON.stringify(useEditor.getState().design.pages[0].elements.find((e) => e.id === photo.id)));
          const read = async (blob) => {
            const bitmap = await createImageBitmap(blob);
            const c = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
            const ctx = c.getContext("2d");
            ctx.drawImage(bitmap, 0, 0);
            return ctx.getImageData(0, 0, c.width, c.height);
          };
          /** how many numbers of the picture inside the disc differ from the original, and the largest step between neighbouring stripes in the patch of wall */
          const measure = (picture) => {
            let inside = 0;
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                if ((x - 160) ** 2 + (y - 120) ** 2 > 40 ** 2) continue;
                for (let k = 0; k < 4; k++) if (picture.data[(y * W + x) * 4 + k] !== original.data[(y * W + x) * 4 + k]) inside++;
              }
            }
            let step = 0;
            let sum = 0;
            let count = 0;
            let opaque = true;
            for (let y = 10; y < 70; y++) {
              for (let x = 10; x < 70; x++) {
                const r = picture.data[(y * W + x) * 4];
                if (x < 69) step = Math.max(step, Math.abs(r - picture.data[(y * W + x + 1) * 4]));
                sum += r;
                count++;
              }
            }
            for (let i = 3; i < picture.data.length; i += 4) if (picture.data[i] !== 255) opaque = false;
            return { inside, step, mean: sum / count, opaque };
          };

          const stages = [];
          const stop = state.useMlStore.subscribe((s) => {
            const stage = s.job?.stage;
            if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
          });
          const started = performance.now();
          const strong = await service.blurBackground(photo.id, { strength: "strong" }, deps);
          const strongMs = Math.round(performance.now() - started);
          stop();
          const afterStrong = find();
          const strongAsset = await assets.getAsset(afterStrong.src.slice(6));
          const strongMeasured = measure(await read(strongAsset.blob));

          // Undo, and another try with a lighter blur: the model is not asked again
          useEditor.getState().actions.undo();
          const undone = find();
          const lightStarted = performance.now();
          const light = await service.blurBackground(photo.id, { strength: "light" }, deps);
          const lightMs = Math.round(performance.now() - lightStarted);
          const lightAsset = await assets.getAsset(find().src.slice(6));
          const lightMeasured = measure(await read(lightAsset.blob));

          return {
            strong,
            strongMs,
            lightMs,
            light,
            stages,
            element: {
              src: afterStrong.src,
              originalSrc: afterStrong.originalSrc,
              naturalWidth: afterStrong.naturalWidth,
              naturalHeight: afterStrong.naturalHeight,
              width: afterStrong.width,
              height: afterStrong.height,
            },
            originalSrc: photo.src,
            mime: strongAsset.mime,
            undone: { src: undone.src, originalSrc: undone.originalSrc },
            original: measure(original),
            strongMeasured,
            lightMeasured,
            modelRuns,
            jobAfter: state.useMlStore.getState().job,
          };
        },
        { base64: model.base64, sha256: model.sha256, io: model.io },
      );

      if (JSON.stringify(out.strong) !== JSON.stringify({ applied: true, scaled: false, width: 320, height: 240 })) throw new Error("outcome " + JSON.stringify(out.strong));
      const el = out.element;
      if (!/^asset:/.test(el.src) || el.src === out.originalSrc || el.originalSrc !== out.originalSrc) throw new Error("the photo is " + JSON.stringify(el));
      if (el.naturalWidth !== 320 || el.naturalHeight !== 240 || el.width !== 320 || el.height !== 240) throw new Error("the size changed: " + JSON.stringify(el));
      if (out.mime !== "image/png") throw new Error("the new picture is " + out.mime);
      // the engine reports starting up and loading the model only when it has to (here: a model it has not seen yet)
      if (!/^preparing(,runtime)?(,model)?,inference,finishing$/.test(out.stages.join(","))) throw new Error("the steps were " + out.stages.join(","));
      if (out.undone.src !== out.originalSrc || out.undone.originalSrc !== undefined) throw new Error("undo did not bring the photo back: " + JSON.stringify(out.undone));
      const { original, strongMeasured: strong, lightMeasured: light } = out;
      if (original.step < 55) throw new Error("the test wall has no stripes to blur: " + JSON.stringify(original));
      if (strong.inside) throw new Error(strong.inside + " numbers inside the disc changed: the subject was touched");
      if (light.inside) throw new Error(light.inside + " numbers inside the disc changed with the light blur");
      if (strong.step > 12)
        throw new Error("the stripes behind the disc are still sharp: the largest step between neighbours is " + strong.step + " (it was " + original.step + ")");
      if (!(light.step > strong.step && light.step < original.step))
        throw new Error("the light blur is not between none and strong: " + original.step + ", " + light.step + ", " + strong.step);
      if (Math.abs(strong.mean - original.mean) > 4) throw new Error("the wall changed colour: " + original.mean.toFixed(1) + " became " + strong.mean.toFixed(1));
      if (!strong.opaque || !light.opaque) throw new Error("the opacity changed");
      if (out.modelRuns !== 1) throw new Error("the model was asked " + out.modelRuns + " times for two tries on the same photo");
      if (!out.light.applied) throw new Error("the second try " + JSON.stringify(out.light));
      if (out.jobAfter !== null) throw new Error("a job is still marked as running");
      return `subject untouched, stripes from a step of ${original.step} to ${strong.step} (strong) and ${light.step} (light), wall colour kept, the model asked once; strong ${out.strongMs} ms, the retry ${out.lightMs} ms`;
    });

    await gpuStep(
      "job layer (colour pop): the subject stays exactly as it was, the wall behind it turns grey, a second try does not ask the model again, a grey wall is left alone",
      async () => {
        const out = await page.evaluate(
          async ({ base64, sha256, io }) => {
            const [{ useEditor }, factory, assets, service, state] = await Promise.all([
              // the store the app runs on: an import of it can be a second copy on a dev server that has hot-reloaded a module it uses
              Promise.resolve({ useEditor: window.__editor }),
              import("/src/core/factory.ts"),
              import("/src/core/assets.ts"),
              import("/src/ml/service.ts"),
              import("/src/ml/state.ts"),
            ]);
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const spec = {
              id: "synthetic-pop",
              task: "background-removal",
              tool: "Background remover",
              name: "Synthetic",
              summary: "test",
              repo: "none",
              revision: "0".repeat(40),
              file: "none",
              bytes: bytes.length,
              sha256,
              requires: "webgpu",
              gpuFeatures: [],
              io,
              licence: { name: "none", url: "https://example.test", notice: "none" },
              credit: { text: "none", url: "https://example.test" },
            };
            // everything real except which model it is, where its bytes come from, and a count of how often the model is asked
            const base = service.defaultDeps();
            let modelRuns = 0;
            const deps = {
              ...base,
              client: { ...base.client, run: (...args) => (modelRuns++, base.client.run(...args)) },
              spec: (id) => (id === "synthetic-pop" ? spec : undefined),
              defaultModel: () => "synthetic-pop",
              download: async (_spec, options) => {
                options.onProgress?.(bytes.length, bytes.length);
                return new Blob([bytes]);
              },
            };
            await service.installModel("synthetic-pop", { warm: false }, deps);

            const W = 320;
            const H = 240;
            const place = async (draw, name) => {
              const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
              const g = canvas.getContext("2d");
              draw(g);
              const original = g.getImageData(0, 0, W, H);
              const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
              const asset = await assets.addAssetFromBlob(png, name);
              const photo = factory.createImage({ src: assets.assetSrc(asset.id), x: 20, y: 20, width: W, height: H, naturalWidth: W, naturalHeight: H });
              useEditor.getState().actions.openDesign(factory.createDesign({ width: 800, height: 600, pages: [factory.createPage({ elements: [photo] })] }));
              return { id: photo.id, original };
            };
            const find = (id) => JSON.parse(JSON.stringify(useEditor.getState().design.pages[0].elements.find((e) => e.id === id)));
            const read = async (blob) => {
              const bitmap = await createImageBitmap(blob);
              const c = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
              const ctx = c.getContext("2d");
              ctx.drawImage(bitmap, 0, 0);
              return ctx.getImageData(0, 0, c.width, c.height);
            };
            /** numbers that changed inside the disc, and how far from grey the wall is (the largest spread between the red, green and blue of a pixel) */
            const measure = (picture, original) => {
              let inside = 0;
              for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                  if ((x - 160) ** 2 + (y - 120) ** 2 > 40 ** 2) continue;
                  for (let k = 0; k < 4; k++) if (picture.data[(y * W + x) * 4 + k] !== original.data[(y * W + x) * 4 + k]) inside++;
                }
              }
              let spread = 0;
              for (let y = 10; y < 70; y++) {
                for (let x = 10; x < 70; x++) {
                  const i = (y * W + x) * 4;
                  spread = Math.max(
                    spread,
                    Math.max(picture.data[i], picture.data[i + 1], picture.data[i + 2]) - Math.min(picture.data[i], picture.data[i + 1], picture.data[i + 2]),
                  );
                }
              }
              return { inside, spread };
            };

            // a wall of red and blue stripes (the stand-in model reads brightness, which these share), a white disc in front
            const wall = await place((g) => {
              for (let x = 0; x < W; x += 20) {
                g.fillStyle = (x / 20) % 2 ? "rgb(0,0,60)" : "rgb(60,0,0)";
                g.fillRect(x, 0, 20, H);
              }
              g.fillStyle = "#fff";
              g.beginPath();
              g.arc(160, 120, 60, 0, Math.PI * 2);
              g.fill();
            }, "Wall");
            const stages = [];
            const stop = state.useMlStore.subscribe((s) => {
              const stage = s.job?.stage;
              if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
            });
            const first = await service.colourPop(wall.id, {}, deps);
            stop();
            const afterFirst = find(wall.id);
            const firstAsset = await assets.getAsset(afterFirst.src.slice(6));
            const firstMeasured = measure(await read(firstAsset.blob), wall.original);

            // Undo, and a faded colour pop: the model is not asked again
            useEditor.getState().actions.undo();
            const undone = find(wall.id);
            const second = await service.colourPop(wall.id, { style: "faded" }, deps);
            const secondAsset = await assets.getAsset(find(wall.id).src.slice(6));
            const secondMeasured = measure(await read(secondAsset.blob), wall.original);

            // a wall that is grey already has no colour to take out: nothing is saved
            const grey = await place((g) => {
              g.fillStyle = "#404040"; // darker than half: the stand-in model reads brightness as how much is subject
              g.fillRect(0, 0, W, H);
              g.fillStyle = "#fff";
              g.beginPath();
              g.arc(160, 120, 60, 0, Math.PI * 2);
              g.fill();
            }, "Grey wall");
            const before = (await assets.listAssets()).length;
            const nothing = await service.colourPop(grey.id, {}, deps);
            const greyAfter = { assets: (await assets.listAssets()).length - before };

            return {
              first,
              stages,
              element: { src: afterFirst.src, originalSrc: afterFirst.originalSrc, naturalWidth: afterFirst.naturalWidth, naturalHeight: afterFirst.naturalHeight },
              mime: firstAsset.mime,
              undone: { src: undone.src, originalSrc: undone.originalSrc },
              original: measure(wall.original, wall.original),
              firstMeasured,
              second,
              secondMeasured,
              nothing,
              greyAfter,
              modelRuns,
              jobAfter: state.useMlStore.getState().job,
            };
          },
          { base64: model.base64, sha256: model.sha256, io: model.io },
        );

        if (JSON.stringify(out.first) !== JSON.stringify({ applied: true, scaled: false, width: 320, height: 240 })) throw new Error("outcome " + JSON.stringify(out.first));
        const el = out.element;
        if (!/^asset:/.test(el.src) || !el.originalSrc || el.src === el.originalSrc) throw new Error("the photo is " + JSON.stringify(el));
        if (el.naturalWidth !== 320 || el.naturalHeight !== 240 || out.mime !== "image/png")
          throw new Error("the new picture is " + el.naturalWidth + "x" + el.naturalHeight + " " + out.mime);
        if (!/^preparing(,runtime)?(,model)?,inference,finishing$/.test(out.stages.join(","))) throw new Error("the steps were " + out.stages.join(","));
        if (out.undone.src !== el.originalSrc || out.undone.originalSrc !== undefined) throw new Error("undo did not bring the photo back: " + JSON.stringify(out.undone));
        const { original, firstMeasured: pop, secondMeasured: faded } = out;
        if (original.spread < 55) throw new Error("the test wall has no colour to take out: " + JSON.stringify(original));
        if (pop.inside) throw new Error(pop.inside + " numbers inside the disc changed: the subject was touched");
        if (faded.inside) throw new Error(faded.inside + " numbers inside the disc changed with the faded style");
        // the stand-in model reads the wall as 8 % subject, so 8 % of its colour stays: grey to within a few levels, not exactly
        if (pop.spread > 8) throw new Error("the wall is not grey: its colours still differ by " + pop.spread + " (they differed by " + original.spread + ")");
        if (!(faded.spread > pop.spread + 10 && faded.spread < original.spread - 10))
          throw new Error("the faded style is not between colour and grey: " + original.spread + ", " + faded.spread + ", " + pop.spread);
        if (!out.second.applied) throw new Error("the second try " + JSON.stringify(out.second));
        if (out.modelRuns !== 2) throw new Error("the model was asked " + out.modelRuns + " times for two tries on one photo and a try on another");
        if (JSON.stringify(out.nothing) !== JSON.stringify({ applied: false, reason: "no-colour" })) throw new Error("a grey wall gave " + JSON.stringify(out.nothing));
        if (out.greyAfter.assets !== 0) throw new Error("a picture was saved for a grey wall");
        if (out.jobAfter !== null) throw new Error("a job is still marked as running");
        return `subject untouched, the wall's colours from a spread of ${original.spread} to ${pop.spread} (black and white) and ${faded.spread} (faded), the model asked once for the two tries, a grey wall left alone`;
      },
    );

    await gpuStep("job layer (upscale): the tiles meet exactly, transparency and the original are kept, a JPEG stays a JPEG, Cancel ends the worker", async () => {
      const out = await page.evaluate(
        async ({ base64, sha256, io }) => {
          const [{ useEditor }, factory, assets, service, state] = await Promise.all([
            // the store the app runs on: an import of it can be a second copy on a dev server that has hot-reloaded a module it uses
            Promise.resolve({ useEditor: window.__editor }),
            import("/src/core/factory.ts"),
            import("/src/core/assets.ts"),
            import("/src/ml/service.ts"),
            import("/src/ml/state.ts"),
          ]);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const spec = {
            id: "synthetic-up",
            task: "upscaling",
            tool: "Upscaler",
            name: "Synthetic upscaler",
            summary: "test",
            repo: "none",
            revision: "0".repeat(40),
            file: "none",
            bytes: bytes.length,
            sha256,
            requires: "webgpu",
            gpuFeatures: [],
            io,
            licence: { name: "none", url: "https://example.test", notice: "none" },
            credit: { text: "none", url: "https://example.test" },
          };
          // everything real except which model it is and where its bytes come from
          const deps = {
            ...service.defaultDeps(),
            spec: (id) => (id === "synthetic-up" ? spec : undefined),
            defaultModel: () => "synthetic-up",
            download: async (_spec, options) => {
              options.onProgress?.(bytes.length, bytes.length);
              return new Blob([bytes]);
            },
          };

          const W = 100;
          const H = 80;
          const newCanvas = () => Object.assign(document.createElement("canvas"), { width: W, height: H });
          /** a picture with gradients, hard edges, a diagonal line and text: no two neighbouring tiles look alike */
          const solidPicture = () => {
            const c = newCanvas();
            const g = c.getContext("2d");
            const gradient = g.createLinearGradient(0, 0, W, H);
            gradient.addColorStop(0, "#1a73e8");
            gradient.addColorStop(1, "#f4b400");
            g.fillStyle = gradient;
            g.fillRect(0, 0, W, H);
            g.fillStyle = "#d93025";
            g.fillRect(14, 10, 40, 26);
            g.fillStyle = "#188038";
            g.beginPath();
            g.arc(70, 52, 18, 0, 7);
            g.fill();
            g.strokeStyle = "#ffffff";
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(0, 79);
            g.lineTo(99, 0);
            g.stroke();
            g.fillStyle = "#ffffff";
            g.font = "bold 22px sans-serif";
            g.fillText("Aa", 18, 70);
            return c;
          };
          /** a red disc on a transparent background, with soft edges */
          const cutoutPicture = () => {
            const c = newCanvas();
            const g = c.getContext("2d");
            g.fillStyle = "#ff0000";
            g.beginPath();
            g.arc(50, 40, 26, 0, 7);
            g.fill();
            return c;
          };
          const blobOf = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
          const place = async (blob, name) => {
            const asset = await assets.addAssetFromBlob(blob, name);
            const photo = factory.createImage({ src: assets.assetSrc(asset.id), x: 20, y: 20, width: W, height: H, naturalWidth: W, naturalHeight: H });
            useEditor.getState().actions.openDesign(factory.createDesign({ width: 800, height: 600, pages: [factory.createPage({ elements: [photo] })] }));
            return photo.id;
          };
          const find = (id) => JSON.parse(JSON.stringify(useEditor.getState().design.pages[0].elements.find((e) => e.id === id)));
          const read = async (blob) => {
            const bitmap = await createImageBitmap(blob);
            const c = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
            const g = c.getContext("2d");
            g.drawImage(bitmap, 0, 0);
            return g.getImageData(0, 0, c.width, c.height);
          };
          /** how many numbers of the result are not those of the original pixel the result pixel lies in, and the largest difference */
          const compare = (source, result, factor) => {
            let wrong = 0;
            let worst = 0;
            for (let Y = 0; Y < result.height; Y++) {
              for (let X = 0; X < result.width; X++) {
                const s = (Math.floor(Y / factor) * source.width + Math.floor(X / factor)) * 4;
                const r = (Y * result.width + X) * 4;
                for (let k = 0; k < 4; k++) {
                  const d = Math.abs(source.data[s + k] - result.data[r + k]);
                  if (d > worst) worst = d;
                  if (d) wrong++;
                }
              }
            }
            return { wrong, worst };
          };
          const assetOf = (el) => assets.getAsset(el.src.slice(6));
          const solid = solidPicture();
          const solidPixels = solid.getContext("2d").getImageData(0, 0, W, H);

          // 1. no model on the device yet: the job refuses to download anything on its own
          const id = await place(await blobOf(solid, "image/png"), "Solid");
          let refusal = null;
          try {
            await service.upscale(id, { factor: 2 }, deps);
          } catch (e) {
            refusal = e.code;
          }
          const installed = await service.installModel("synthetic-up", {}, deps);

          // 2. twice as large, tile by tile (100 x 80 in tiles of 48 with 4 pixels of context: 3 x 2 tiles)
          const progress = [];
          const stop = state.useMlStore.subscribe((s) => {
            const p = s.job?.progress;
            if (p !== undefined && progress[progress.length - 1] !== p) progress.push(p);
          });
          const started = performance.now();
          const two = await service.upscale(id, { factor: 2 }, deps);
          const twoMs = Math.round(performance.now() - started);
          stop();
          const afterTwo = find(id);
          const twoAsset = await assetOf(afterTwo);
          const twoPixels = await read(twoAsset.blob);
          const twoCompared = compare(solidPixels, twoPixels, 2);

          // 3. undo, then four times as large
          useEditor.getState().actions.undo();
          const undone = find(id);
          const four = await service.upscale(id, { factor: 4 }, deps);
          const afterFour = find(id);
          const fourAsset = await assetOf(afterFour);
          const fourCompared = compare(solidPixels, await read(fourAsset.blob), 4);

          // 4. the original comes back, with its own size
          await service.restoreOriginal(id, deps);
          const restored = find(id);

          // 5. a picture with transparency keeps it, and its edge has no dark fringe (the model never sees black there)
          const cutId = await place(await blobOf(cutoutPicture(), "image/png"), "Disc");
          await service.upscale(cutId, { factor: 2 }, deps);
          const cutAsset = await assetOf(find(cutId));
          const cut = await read(cutAsset.blob);
          const at = (x, y) => Array.from(cut.data.slice((y * cut.width + x) * 4, (y * cut.width + x) * 4 + 4));
          let soft = 0;
          let dark = 0;
          for (let i = 0; i < cut.data.length; i += 4) {
            const a = cut.data[i + 3];
            if (a > 20 && a < 235) {
              soft++;
              if (cut.data[i] < 245 || cut.data[i + 1] > 10 || cut.data[i + 2] > 10) dark++;
            }
          }
          const cutOut = { size: [cut.width, cut.height], mime: cutAsset.mime, centre: at(100, 80), corner: at(2, 2), soft, dark };

          // 6. a JPEG photograph stays a JPEG
          const jpegId = await place(await blobOf(solid, "image/jpeg"), "Photo");
          await service.upscale(jpegId, { factor: 2 }, deps);
          const jpegAsset = await assetOf(find(jpegId));

          // 7. Cancel in the middle of the first tile ends the worker; nothing changes, and the next job starts a new worker
          const cancelId = await place(await blobOf(solid, "image/png"), "Cancelled");
          const before = (await assets.listAssets()).length;
          const control = new AbortController();
          const unsubscribe = state.useMlStore.subscribe((s) => {
            if (s.job?.stage === "inference") control.abort();
          });
          let cancelCode = null;
          try {
            await service.upscale(cancelId, { factor: 2, signal: control.signal }, deps);
          } catch (e) {
            cancelCode = e.code;
          }
          unsubscribe();
          const cancelled = {
            code: cancelCode,
            src: find(cancelId).src,
            originalSrc: find(cancelId).originalSrc,
            newAssets: (await assets.listAssets()).length - before,
            job: state.useMlStore.getState().job,
          };
          const again = await service.upscale(cancelId, { factor: 2 }, deps);

          return {
            refusal,
            warmError: installed.warmError ? installed.warmError.code : null,
            two: {
              result: two,
              ms: twoMs,
              progress,
              element: {
                src: afterTwo.src,
                originalSrc: afterTwo.originalSrc,
                naturalWidth: afterTwo.naturalWidth,
                naturalHeight: afterTwo.naturalHeight,
                width: afterTwo.width,
                height: afterTwo.height,
              },
              mime: twoAsset.mime,
              compared: twoCompared,
              size: [twoPixels.width, twoPixels.height],
            },
            undone: { src: undone.src, naturalWidth: undone.naturalWidth },
            four: { result: four, compared: fourCompared, naturalWidth: afterFour.naturalWidth },
            restored: { src: restored.src, originalSrc: restored.originalSrc, naturalWidth: restored.naturalWidth, naturalHeight: restored.naturalHeight },
            cutOut,
            jpeg: { mime: jpegAsset.mime },
            cancelled,
            again,
            jobAfter: state.useMlStore.getState().job,
          };
        },
        { base64: upscaler.base64, sha256: upscaler.sha256, io: upscaler.io },
      );

      if (out.refusal !== "not-installed") throw new Error("the job did not refuse to run without the model: " + out.refusal);
      if (out.warmError) throw new Error("the warm-up failed: " + out.warmError);
      if (JSON.stringify(out.two.result) !== JSON.stringify({ factor: 2, width: 200, height: 160 })) throw new Error("result " + JSON.stringify(out.two.result));
      if (out.two.size.join("x") !== "200x160" || out.two.mime !== "image/png") throw new Error("the new picture is " + out.two.size.join("x") + " " + out.two.mime);
      if (out.two.progress.length !== 6) throw new Error("expected 6 tiles, progress went " + JSON.stringify(out.two.progress));
      if (out.two.compared.wrong) throw new Error(`${out.two.compared.wrong} numbers of the 2x picture differ from the original's (largest difference ${out.two.compared.worst})`);
      const el = out.two.element;
      if (!/^asset:/.test(el.src) || el.naturalWidth !== 200 || el.naturalHeight !== 160 || el.width !== 100 || el.height !== 80)
        throw new Error("the photo is " + JSON.stringify(el));
      if (!el.originalSrc) throw new Error("the original was not remembered");
      if (out.undone.src !== el.originalSrc || out.undone.naturalWidth !== 100) throw new Error("undo did not bring the photo back: " + JSON.stringify(out.undone));
      if (JSON.stringify(out.four.result) !== JSON.stringify({ factor: 4, width: 400, height: 320 })) throw new Error("4x result " + JSON.stringify(out.four.result));
      if (out.four.compared.wrong)
        throw new Error(`${out.four.compared.wrong} numbers of the 4x picture differ from the original's (largest difference ${out.four.compared.worst})`);
      if (out.restored.src !== el.originalSrc || out.restored.originalSrc !== undefined || out.restored.naturalWidth !== 100 || out.restored.naturalHeight !== 80)
        throw new Error("restore did not work: " + JSON.stringify(out.restored));
      const { size, mime, centre, corner, soft, dark } = out.cutOut;
      if (size.join("x") !== "200x160" || mime !== "image/png") throw new Error("the cut-out is " + size.join("x") + " " + mime);
      if (centre[3] !== 255 || centre[0] !== 255) throw new Error("the disc centre should be solid red: " + centre);
      if (corner[3] !== 0) throw new Error("the corner is not transparent: " + corner);
      if (soft < 20) throw new Error("the edge has only " + soft + " soft pixels: the transparency was not kept");
      if (dark) throw new Error(dark + " of " + soft + " edge pixels are not the red of the disc: a dark fringe");
      if (out.jpeg.mime !== "image/jpeg") throw new Error("a JPEG photograph came back as " + out.jpeg.mime);
      const c = out.cancelled;
      if (c.code !== "aborted") throw new Error("Cancel gave " + c.code);
      if (!/^asset:/.test(c.src) || c.originalSrc !== undefined || c.newAssets !== 0 || c.job !== null) throw new Error("Cancel left traces: " + JSON.stringify(c));
      if (out.again.width !== 200) throw new Error("the job after Cancel did not work: " + JSON.stringify(out.again));
      if (out.jobAfter !== null) throw new Error("a job is still marked as running");
      return `2x in ${out.two.ms} ms over ${out.two.progress.length} tiles, 2x and 4x identical to the original's pixels, ${soft} soft edge pixels without a fringe, JPEG kept, Cancel clean`;
    });
  }

  await step("no errors in the console", async () => {
    if (logs.length) throw new Error(logs.slice(0, 3).join(" | "));
  });

  console.log(results.join("\n"));
  console.log("shots in", OUT);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.log("CRASH", e.message.split("\n")[0]);
  process.exit(1);
});
