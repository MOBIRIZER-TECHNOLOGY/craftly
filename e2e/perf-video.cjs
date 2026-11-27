/*
 * How long a long video download takes and how much memory the browser uses for it (docs/PERFORMANCE.md, "Long video
 * downloads"): a design of MINUTES pages of a minute (10), each filled by a looping 720p clip recorded here, downloaded as video
 * at RES (1080p). NOISE=1 fills the clip with detail that changes every frame, the most the encoder ever has to write.
 * PROFILE=1 samples the page for 15 s part-way instead and prints where the time goes. Not part of run-all: it takes minutes.
 * Memory is the working set of every process of the browser started here (Windows: PowerShell is asked).
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { launchPersistent, BASE } = require("./lib.cjs");
const MINUTES = Number(process.env.MINUTES ?? 10);
const DIR = path.join(require("node:os").tmpdir(), "craftly-perf-video-" + Date.now());

function memoryMB() {
  // every chrome.exe whose ancestor is the browser started for this profile
  const ps = `$all = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize;
$root = $all | Where-Object { $_.CommandLine -like '*${path.basename(DIR)}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1;
if (-not $root) { '0'; exit }
$ids = @($root.ProcessId); $changed = $true
while ($changed) { $changed = $false; foreach ($p in $all) { if (($ids -contains $p.ParentProcessId) -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $changed = $true } } }
[math]::Round((($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object WorkingSetSize -Sum).Sum) / 1MB)`;
  try {
    return Number(execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim());
  } catch {
    return -1;
  }
}

(async () => {
  const ctx = await launchPersistent(DIR, { viewport: { width: 1440, height: 900 }, acceptDownloads: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
  await page.goto(BASE + "/#/", { waitUntil: "load" });
  await page.getByText("What will you design today?").waitFor({ timeout: 30000 });
  await page.evaluate(async () => {
    const loaded = (p) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => new URL(n).pathname === p)
        .pop() ?? p;
    window.__journey = {
      lib: await import(loaded("/src/core/library.ts")),
      factory: await import(loaded("/src/core/factory.ts")),
      assets: await import(loaded("/src/core/assets.ts")),
    };
  });
  const id = await page.evaluate(
    async ([minutes, noise]) => {
      const { lib, factory, assets } = window.__journey;
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const g = c.getContext("2d", { alpha: false });
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 4_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const start = performance.now();
      rec.start(200);
      await new Promise((done) => {
        const tick = () => {
          const t = (performance.now() - start) / 1000;
          g.fillStyle = `hsl(${(t * 72) % 360} 70% 50%)`;
          g.fillRect(0, 0, 1280, 720);
          g.fillStyle = "#fff";
          g.fillRect(((t * 300) % 1280) - 100, 300, 200, 120);
          if (noise) {
            // detail everywhere that changes every frame: the encoder needs all of its bitrate for it
            const img = g.getImageData(0, 0, 1280, 720);
            for (let i = 0; i < img.data.length; i += 4) {
              const v = (Math.random() * 255) | 0;
              img.data[i] = v;
              img.data[i + 1] = (v * 7) & 255;
              img.data[i + 2] = 255 - v;
            }
            g.putImageData(img, 0, 0);
          }
          if (t < 5) requestAnimationFrame(tick);
          else done();
        };
        tick();
      });
      await new Promise((r) => {
        rec.onstop = r;
        rec.stop();
      });
      const clip = await assets.addAssetFromFile(new File(chunks, "Loop.webm", { type: "video/webm" }));
      const design = await lib.createBlankDesign({ typeId: "custom", width: 1920, height: 1080, title: "Ten minutes" });
      const open = await lib.getDesignForEditing(design.id);
      const first = open.design.pages[0];
      open.design.pages = Array.from({ length: minutes }, (_, i) => ({
        ...first,
        id: "p" + i,
        duration: 60,
        elements: [factory.createVideo({ src: `asset:${clip.id}`, naturalWidth: 1280, naturalHeight: 720, duration: 5, x: 0, y: 0, width: 1920, height: 1080 })],
      }));
      await lib.saveDesign(open.design, undefined, open.revision);
      return design.id;
    },
    [MINUTES, !!process.env.NOISE],
  );
  await page.goto(BASE + "/#/design/" + encodeURIComponent(id), { waitUntil: "load" });
  await page.locator(".cf-workspace").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Share", exact: true }).first().click();
  await page.getByRole("button", { name: "Download", exact: true }).first().click();
  const dl = page.locator(".cf-dl");
  await dl.waitFor({ timeout: 5000 });
  await page.getByLabel("File type").click();
  await page
    .getByRole("option", { name: /^Video/ })
    .first()
    .click();
  await page.waitForTimeout(500);
  await dl.getByText(process.env.RES ?? "1080p", { exact: true }).click();
  await page.waitForTimeout(300);
  console.log("panel:", (await dl.innerText()).replace(/\s+/g, " ").slice(0, 400));
  const base = memoryMB();
  let peak = base;
  const started = Date.now();
  const timer = setInterval(() => {
    const now = memoryMB();
    peak = Math.max(peak, now);
    dl.innerText({ timeout: 2000 })
      .catch(() => "?")
      .then((text) => console.log(`t=${Math.round((Date.now() - started) / 1000)}s memory=${now}MB panel=${text.replace(/\s+/g, " ").slice(-120)}`));
  }, 15000);
  if (process.env.PROFILE) {
    await dl.getByRole("button", { name: "Download", exact: true }).click();
    await page.waitForTimeout(20000);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await cdp.send("Profiler.start");
    await page.waitForTimeout(15000);
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map();
    const dt = profile.timeDeltas;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const f = n.callFrame;
      const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(
      [...self]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k, v]) => `${((v / total) * 100).toFixed(1)}% ${k}`)
        .join(String.fromCharCode(10)),
    );
    console.log("panel:", (await dl.innerText()).split(/s+/).join(" ").slice(-60));
    process.exit(0);
  }
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: Number(process.env.LIMIT_MIN ?? 60) * 60 * 1000 }),
    dl.getByRole("button", { name: "Download", exact: true }).click(),
  ]);
  const saved = await file.path();
  clearInterval(timer);
  const after = memoryMB();
  const size = fs.statSync(saved).size;
  const fd = fs.openSync(saved, "r");
  const boxes = [];
  let at = 0;
  while (at < size && boxes.length < 6) {
    const h = Buffer.alloc(16);
    fs.readSync(fd, h, 0, 16, at);
    let len = h.readUInt32BE(0);
    const type = h.toString("latin1", 4, 8);
    if (len === 1) len = Number(h.readBigUInt64BE(8));
    boxes.push(type + ":" + len);
    if (!len) break;
    at += len;
  }
  fs.closeSync(fd);
  console.log("boxes", boxes.join(" "));
  console.log(
    JSON.stringify({
      minutes: MINUTES,
      name: file.suggestedFilename(),
      MB: Math.round(size / 1048576),
      seconds: Math.round((Date.now() - started) / 1000),
      memoryBeforeMB: base,
      peakMB: Math.max(peak, after),
      afterMB: after,
    }),
  );
  await ctx.close();
  fs.rmSync(DIR, { recursive: true, force: true });
})().catch((e) => {
  console.log("FAILED", e.message);
  process.exit(1);
});
