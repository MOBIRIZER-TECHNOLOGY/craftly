/*
 * A measurement, not a journey (it is not part of run-all.cjs and never fails): how smooth is dragging one element with the
 * real pointer on a heavy page? It builds heavy pages through the store, drags the element on top along a path of 120 pointer
 * moves (sent on a clock at 60 a second, without waiting for the page) and records, in the page:
 *
 *  - frame: the time from one animation frame to the next while the drag runs, between frames that repaint the page (16.7 ms
 *    is 60 frames a second; a headless Chrome ticks every 18 ms here, which the page with one shape shows as the floor);
 *  - move: the time in the pointermove listeners of one move (the store commit, text boxes, attached lines, snapping);
 *  - paint: the time inside the animation-frame callbacks of a frame (the canvas repaint is one of them);
 *  - busy: the main thread's task time per repaint over the whole drag, as Chrome's own counters have it (CDP
 *    Performance.getMetrics), and what of it is script outside the listeners and the repaint, layout and style, or no script;
 *  - long tasks (over 50 ms), how often the page canvas was repainted, how many canvas calls one repaint makes, and how many
 *    went to smaller canvases (thumbnails) during the drag;
 *  - whether the last frame of the drag is the picture that the page shows once the pointer is let go (pixel for pixel).
 *
 * Every page is measured at 100 % and at the zoom that fits it, RUNS times (default 3); the table gives the median of the runs
 * and the worst frame of all of them. Other programs on the machine make the numbers noisy: compare medians, not single runs.
 *
 *   node e2e/perf-drag.cjs                         all pages, headless, against BASE (default: the dev server)
 *   ONLY=shapes,blend RUNS=5 HEADED=1 node e2e/perf-drag.cjs
 *   PROFILE=blend node e2e/perf-drag.cjs           also prints where the CPU time of that page's drag went (function names)
 *
 * A production build is the honest target (a dev build is slower): build with VITE_EXPOSE_STORE=1 into dist-perf, serve it with
 * `npx vite preview --outDir dist-perf --port 4179` and set BASE=http://127.0.0.1:4179. docs/PERFORMANCE.md has the numbers.
 */
const fs = require("node:fs");
const { launch, outDir, BASE } = require("./lib.cjs");

const OUT = outDir("perf-drag");
const RUNS = Number(process.env.RUNS || 3);
const MOVES = Number(process.env.MOVES || 120);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const PROFILE = process.env.PROFILE || "";

/** Runs in the page before the app's own code: counts and times what the drag makes the page do. */
function instrument() {
  const P = (window.__perf = { on: false, frames: [], moves: [], long: [], handler: 0, raf: 0, ops: 0, small: 0, repaints: 0, n: 0 });
  // every pointermove listener is timed (the canvas controller's and React's own)
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const wrappers = new WeakMap();
  const timed = (fn) => {
    let w = wrappers.get(fn);
    if (!w) {
      w = function (e) {
        if (!P.on) return fn.call(this, e);
        const t = performance.now();
        try {
          return fn.call(this, e);
        } finally {
          P.handler += performance.now() - t;
        }
      };
      wrappers.set(fn, w);
    }
    return w;
  };
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    return add.call(this, type, type === "pointermove" && typeof fn === "function" ? timed(fn) : fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    return remove.call(this, type, (type === "pointermove" && typeof fn === "function" && wrappers.get(fn)) || fn, opts);
  };
  // a message posted when a pointer move arrives is delivered after all its listeners have run: their time is then known
  const channel = new MessageChannel();
  const started = [];
  channel.port1.onmessage = () => {
    const m = started.shift();
    if (m) P.moves.push({ handler: P.handler - m.h });
  };
  add.call(
    window,
    "pointermove",
    () => {
      if (!P.on) return;
      started.push({ h: P.handler });
      P.n++;
      channel.port2.postMessage(0);
    },
    true,
  );
  // the app's animation-frame callbacks are timed; a ticker of our own writes one record per frame
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((ts) => {
      if (!P.on) return cb(ts);
      const t = performance.now();
      try {
        cb(ts);
      } finally {
        P.raf += performance.now() - t;
      }
    });
  let last = { raf: 0, ops: 0, repaints: 0, n: 0 };
  const tick = (ts) => {
    if (P.on) {
      P.frames.push({ ts, raf: P.raf - last.raf, ops: P.ops - last.ops, repaints: P.repaints - last.repaints, moves: P.n - last.n });
      last = { raf: P.raf, ops: P.ops, repaints: P.repaints, n: P.n };
    }
    raf(tick);
  };
  raf(tick);
  // canvas calls; a clearRect over the whole page canvas is a repaint. Calls on a canvas narrower than the page canvas are
  // counted apart: those are the thumbnails of the page strip and of the panels, which are no part of the page's own frame
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of ["fill", "stroke", "fillRect", "strokeRect", "fillText", "strokeText", "drawImage", "clearRect"]) {
    const original = proto[name];
    proto[name] = function (...args) {
      if (P.on) {
        const main = document.querySelector("canvas.cf-pageview");
        if (main && this.canvas.width < main.width) P.small++;
        else P.ops++;
        if (name === "clearRect" && this.canvas.classList?.contains("cf-pageview") && args[2] >= this.canvas.width) P.repaints++;
      }
      return original.apply(this, args);
    };
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (P.on) P.long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    // no long task observer in this browser: the frame times still show a blocked page
  }
}

/** The heavy pages. Each runs in the page, puts its elements on the (emptied) active page and gives back the id of the one to drag. */
const SCENARIOS = {
  one: {
    title: "1 shape (the floor of this measurement)",
    build: () => {
      const { els, shape, put } = window.__perfKit();
      els.push(shape({ x: 880, y: 470, width: 160, height: 120, fill: { type: "solid", color: "#e11d48" } }));
      return put(els);
    },
  },
  shapes: {
    title: "300 shapes",
    build: () => {
      const { els, rnd, shape, COLOURS, put } = window.__perfKit();
      for (let i = 0; i < 299; i++)
        els.push(
          shape({
            shape: i % 3 === 0 ? "ellipse" : "rect",
            x: rnd() * 1760,
            y: rnd() * 960,
            width: 60 + rnd() * 160,
            height: 50 + rnd() * 120,
            rotation: i % 5 === 0 ? rnd() * 60 - 30 : 0,
            radius: i % 4 === 0 ? 16 : 0,
            fill: { type: "solid", color: COLOURS[i % COLOURS.length] },
            stroke: i % 2 ? { color: "#1d2733", width: 3, style: i % 6 === 1 ? "dashed" : "solid" } : null,
          }),
        );
      return put(els);
    },
  },
  text: {
    title: "150 text boxes of 4 lines",
    build: () => {
      const { els, rnd, COLOURS, put, text } = window.__perfKit();
      const WORDS = "the quick brown fox jumps over a lazy dog while seven wizards quietly mix bright jade paint for every zebra".split(" ");
      for (let i = 0; i < 150; i++) {
        const line = () => Array.from({ length: 5 + Math.floor(rnd() * 3) }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(" ");
        els.push(
          text({
            x: (i % 15) * 126 + 10,
            y: Math.floor(i / 15) * 106 + 8,
            width: 118,
            fontSize: 11 + (i % 4),
            fontWeight: i % 3 === 0 ? 700 : 400,
            italic: i % 7 === 0,
            color: COLOURS[i % COLOURS.length],
            paragraphs: [0, 1, 2, 3].map(() => ({ runs: [{ text: line() }] })),
          }),
        );
      }
      return put(els);
    },
  },
  photos: {
    title: "40 photos with filters and shadows + 100 shapes",
    build: async () => {
      const { els, rnd, shape, COLOURS, put, photo } = window.__perfKit();
      const pictures = [0, 1, 2, 3, 4, 5].map((k) => photo(k));
      for (let i = 0; i < 100; i++)
        els.push(
          shape({
            shape: i % 2 ? "ellipse" : "rect",
            x: rnd() * 1760,
            y: rnd() * 960,
            width: 60 + rnd() * 140,
            height: 50 + rnd() * 100,
            fill: { type: "solid", color: COLOURS[i % COLOURS.length] },
            shadow: i % 3 === 0 ? { color: "rgba(0,0,0,0.4)", blur: 18, x: 0, y: 8 } : null,
          }),
        );
      for (let i = 0; i < 40; i++)
        els.push({
          id: "x",
          type: "image",
          src: pictures[i % pictures.length],
          naturalWidth: 800,
          naturalHeight: 600,
          x: (i % 8) * 236 + 20,
          y: Math.floor(i / 8) * 212 + 16,
          width: 216,
          height: 162,
          rotation: i % 6 === 0 ? 4 : 0,
          opacity: 1,
          crop: { x: 0, y: 0, w: 1, h: 1 },
          mask: "rect",
          radius: i % 2 ? 14 : 0,
          stroke: null,
          isFrame: false,
          shadow: { color: "rgba(0,0,0,0.45)", blur: 24, x: 0, y: 10 },
          filter: {
            preset: "none",
            intensity: 100,
            brightness: 8 + (i % 5),
            contrast: 12,
            saturation: i % 2 ? 30 : -40,
            warmth: i % 3 ? 25 : 0,
            fade: 0,
            vignette: i % 4 === 0 ? 40 : 0,
            blur: 0,
            hue: i % 5 === 0 ? 20 : 0,
            duotone: null,
          },
        });
      els.push(shape({ x: 880, y: 470, width: 160, height: 120, fill: { type: "solid", color: "#e11d48" }, shadow: { color: "rgba(0,0,0,0.4)", blur: 18, x: 0, y: 8 } }));
      return put(els);
    },
  },
  blend: {
    title: "60 shapes with blend modes",
    build: () => {
      const { els, rnd, shape, COLOURS, put } = window.__perfKit();
      const MODES = ["multiply", "screen", "overlay", "darken", "lighten", "soft-light", "hard-light", "difference", "color", "luminosity"];
      for (let i = 0; i < 59; i++)
        els.push(
          shape({
            shape: i % 2 ? "ellipse" : "rect",
            x: rnd() * 1600,
            y: rnd() * 840,
            width: 180 + rnd() * 160,
            height: 140 + rnd() * 120,
            fill: { type: "solid", color: COLOURS[i % COLOURS.length] },
            blend: MODES[i % MODES.length],
          }),
        );
      els.push(shape({ x: 880, y: 470, width: 160, height: 120, fill: { type: "solid", color: "#e11d48" }, blend: "multiply" }));
      return put(els);
    },
  },
  arrows: {
    title: "120 boxes + 60 attached arrows",
    build: () => {
      const { els, shape, COLOURS, put } = window.__perfKit();
      for (let i = 0; i < 119; i++)
        els.push(
          shape({ x: (i % 15) * 126 + 14, y: Math.floor(i / 15) * 130 + 14, width: 90, height: 60, radius: 8, fill: { type: "solid", color: COLOURS[i % COLOURS.length] } }),
        );
      const dragged = put(els);
      const s = window.__editor.getState();
      const ids = s.design.pages.find((p) => p.id === s.activePageId).elements.map((e) => e.id);
      // four arrows end at the box that is dragged, the others join neighbours
      for (let i = 0; i < 4; i++) s.actions.connect(ids[i * 20 + 3], dragged);
      for (let i = 0; i < 56; i++) s.actions.connect(ids[i * 2], ids[i * 2 + 1]);
      s.actions.clearSelection();
      return dragged;
    },
  },
};

/** Runs in the page once: what the builders share. */
function kit() {
  window.__perfKit = () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
    const base = { id: "x", rotation: 0, opacity: 1 };
    const shape = (init) => ({ ...base, type: "shape", shape: "rect", fill: null, stroke: null, radius: 0, ...init });
    const text = (init) => ({
      ...base,
      type: "text",
      height: 60,
      fontFamily: "Plus Jakarta Sans",
      fontSize: 12,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: "#0e1318",
      gradient: null,
      align: "left",
      lineHeight: 1.25,
      letterSpacing: 0,
      textCase: "none",
      autoWidth: false,
      effect: { kind: "none" },
      curve: 0,
      list: null,
      ...init,
    });
    /** a drawn picture of 800 x 600 as a JPEG: stripes and discs, different for every k */
    const photo = (k) => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 800, 600);
      grad.addColorStop(0, `hsl(${k * 55}, 70%, 55%)`);
      grad.addColorStop(1, `hsl(${k * 55 + 120}, 70%, 35%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 800, 600);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `hsla(${(i * 37 + k * 20) % 360}, 80%, 60%, 0.5)`;
        g.beginPath();
        g.arc((i * 131 + k * 50) % 800, (i * 89) % 600, 20 + ((i * 7) % 50), 0, Math.PI * 2);
        g.fill();
      }
      return c.toDataURL("image/jpeg", 0.8);
    };
    /** empties the page, adds the elements (the last one is the one to drag, on top) and gives its id */
    const put = (els) => {
      const { actions } = window.__editor.getState();
      actions.selectAll();
      actions.deleteElements();
      const ids = actions.addElements(els, { center: false, select: false });
      return ids[ids.length - 1];
    };
    const COLOURS = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#475569", "#ea580c"];
    const els = [];
    return { els, rnd, shape, text, photo, put, COLOURS };
  };
}

const sorted = (list) => [...list].sort((a, b) => a - b);
const quantile = (list, q) => {
  const s = sorted(list);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const median = (list) => quantile(list, 0.5);
const f1 = (n) => n.toFixed(1);

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(instrument);
  await ctx.addInitScript(kit);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  /** Chrome's own counters of the main thread, in seconds since the page began: all tasks, and the script, layout and style part of them. */
  const counters = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const of = (name) => metrics.find((m) => m.name === name).value;
    return { task: of("TaskDuration"), script: of("ScriptDuration"), layout: of("LayoutDuration") + of("RecalcStyleDuration") };
  };
  const wait = (ms) => page.waitForTimeout(ms);

  await page.goto(BASE + "/#/", { waitUntil: "load" });
  await page.getByText("What will you design today?").waitFor({ timeout: 30000 });
  await page
    .getByRole("button", { name: /^Presentation/ })
    .first()
    .click();
  await page.waitForURL(/#\/design\//, { timeout: 15000 });
  await page.locator(".cf-workspace").waitFor({ timeout: 20000 });
  await wait(900);

  const machine = await page.evaluate(() => {
    let gpu = "unknown";
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch {
      // no WebGL: the renderer stays unknown
    }
    return { gpu, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory, dpr: window.devicePixelRatio, ua: navigator.userAgent };
  });

  /** One drag of the element along a figure of eight; gives what the page recorded. */
  const drag = async (id, profile) => {
    // where the element is on the screen; the workspace is scrolled when it is not in view
    const at = await page.evaluate((id) => {
      const s = window.__editor.getState();
      const el = s.design.pages.find((p) => p.id === s.activePageId).elements.find((e) => e.id === id);
      const frame = document.querySelector(".cf-pageframe");
      let scroller = frame.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight && scroller.scrollWidth <= scroller.clientWidth) scroller = scroller.parentElement;
      const where = () => {
        const b = frame.getBoundingClientRect();
        return { x: b.left + (el.x + el.width / 2) * s.zoom, y: b.top + (el.y + el.height / 2) * s.zoom };
      };
      const view = (scroller || document.documentElement).getBoundingClientRect();
      let p = where();
      if (scroller) {
        scroller.scrollLeft += p.x - (view.left + view.width / 2);
        scroller.scrollTop += p.y - (view.top + view.height / 2);
        p = where();
      }
      return { ...p, x0: el.x, past: s.past.length, zoom: s.zoom };
    }, id);
    await wait(300);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    // the first moves start the gesture (it begins after 3 px) and are not measured
    await page.mouse.move(at.x + 6, at.y);
    await wait(120);
    if (profile) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
    }
    const before = await counters();
    await page.evaluate(() => {
      const P = window.__perf;
      Object.assign(P, { frames: [], moves: [], long: [], small: 0, on: true });
    });
    // The moves are sent on a clock, one every 60th of a second, without waiting for the page to answer: a mouse does not wait
    // either, and a page that is too slow then gets several moves in one frame (or none), which the record shows.
    const t0 = performance.now();
    const sent = [];
    let end = at;
    for (let i = 1; i <= MOVES; i++) {
      const t = (i / MOVES) * Math.PI * 1.75;
      end = { x: at.x + 6 + 170 * Math.sin(t), y: at.y + 90 * Math.sin(2 * t) };
      while (performance.now() < t0 + i * (1000 / 60)) await new Promise((r) => setImmediate(r));
      sent.push(cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1, pointerType: "mouse" }));
    }
    await Promise.all(sent);
    const sendMs = performance.now() - t0;
    // the frame of the last move
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const rec = await page.evaluate(() => {
      const P = window.__perf;
      P.on = false;
      return { frames: P.frames, moves: P.moves, long: P.long, small: P.small };
    });
    const now = await counters();
    const perRepaint = (seconds) => (seconds * 1000) / Math.max(1, rec.frames.filter((f) => f.repaints > 0).length);
    const busy = perRepaint(now.task - before.task);
    const script = perRepaint(now.script - before.script);
    const layout = perRepaint(now.layout - before.layout);
    const handlers = perRepaint(rec.moves.reduce((sum, m) => sum + m.handler, 0) / 1000);
    const painting = perRepaint(rec.frames.reduce((sum, f) => sum + f.raf, 0) / 1000);
    let hot = null;
    if (profile) {
      const { profile: prof } = await cdp.send("Profiler.stop");
      await cdp.send("Profiler.disable");
      hot = selfTimes(prof);
    }
    // The picture of the last frame of the drag, and the picture once the pointer is let go at the same place: whatever is
    // done to make a drag smooth, the two must be the same picture (read from a copy, so that the page canvas is left as it is).
    const snap = (name) =>
      page.evaluate(async (name) => {
        const canvas = document.querySelector("canvas.cf-pageview");
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        const g = copy.getContext("2d", { willReadFrequently: true });
        g.drawImage(await createImageBitmap(canvas), 0, 0);
        const now = g.getImageData(0, 0, copy.width, copy.height).data;
        const before = window.__perfSnap;
        window.__perfSnap = name === "drag" ? now : null;
        if (name === "drag") return null;
        let differ = 0;
        let worst = 0;
        for (let i = 0; i < now.length; i += 4) {
          const d = Math.max(Math.abs(now[i] - before[i]), Math.abs(now[i + 1] - before[i + 1]), Math.abs(now[i + 2] - before[i + 2]), Math.abs(now[i + 3] - before[i + 3]));
          if (d) differ++;
          if (d > worst) worst = d;
        }
        return { differ, worst };
      }, name);
    await page.mouse.move(end.x, end.y);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await snap("drag");
    await page.mouse.up();
    await wait(200);
    const picture = await snap("rest");
    const after = await page.evaluate((id) => {
      const s = window.__editor.getState();
      const el = s.design.pages.find((p) => p.id === s.activePageId).elements.find((e) => e.id === id);
      return { x: el.x, past: s.past.length };
    }, id);
    // one drag is one step of the history, whatever is done to make it smooth
    const ok = after.x !== at.x0 && after.past === at.past + 1;
    await page.evaluate(() => window.__editor.getState().actions.undo());
    await wait(150);
    // The time of a frame is the time since the animation frame before it, for a frame that repainted the page after a frame
    // that did: a page that paints too slowly gets its animation frames late. (While the element snaps to a guide it stands
    // still and nothing is painted; a browser with nothing to show may then leave frames out, and that is no slow frame.)
    const painted = rec.frames.filter((f) => f.repaints > 0);
    const intervals = rec.frames.map((f, i) => (i && f.repaints > 0 && rec.frames[i - 1].repaints > 0 ? f.ts - rec.frames[i - 1].ts : -1)).filter((ms) => ms >= 0);
    return {
      ok,
      picture,
      zoom: at.zoom,
      frameMedian: median(intervals),
      frameP95: quantile(intervals, 0.95),
      frameWorst: Math.max(0, ...intervals),
      moveMedian: median(rec.moves.map((m) => m.handler)),
      moveP95: quantile(
        rec.moves.map((m) => m.handler),
        0.95,
      ),
      sendMs,
      paintMedian: median(painted.map((f) => f.raf)),
      paintP95: quantile(
        painted.map((f) => f.raf),
        0.95,
      ),
      busyPerFrame: busy,
      // the script that is neither a pointer listener nor an animation-frame callback: what React renders after a change, mostly
      otherScript: Math.max(0, script - handlers - painting),
      layout,
      // main thread time that is no script, layout or style: handing the canvas calls on, garbage collection
      rest: Math.max(0, busy - script - layout),
      frames: rec.frames.length,
      movesSeen: rec.moves.length,
      repaints: rec.frames.reduce((n, f) => n + f.repaints, 0),
      opsPerRepaint: median(painted.map((f) => f.ops)),
      small: rec.small,
      longTasks: rec.long.length,
      longWorst: Math.max(0, ...rec.long),
      hot,
    };
  };

  /** The functions that used the most CPU time themselves, from a sampling profile. */
  function selfTimes(prof) {
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dt = prof.timeDeltas || [];
    prof.samples.forEach((id, i) => {
      const n = byId.get(id);
      const file = (n.callFrame.url || "").split("/").pop().split("?")[0];
      const key = `${n.callFrame.functionName || "(anonymous)"} ${file}:${n.callFrame.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    return [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, ms]) => `${f1(ms).padStart(8)} ms ${((ms / total) * 100).toFixed(1).padStart(5)} %  ${name}`);
  }

  const rows = [];
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.includes(key)) continue;
    const id = await page.evaluate(scenario.build);
    // pictures and fonts load, the autosave writes the page
    await wait(key === "photos" ? 3500 : 1500);
    for (const zoom of ["100 %", "fit"]) {
      await page.evaluate((zoom) => {
        const { actions } = window.__editor.getState();
        if (zoom === "fit") actions.setZoomMode("fit");
        else actions.setZoom(1);
      }, zoom);
      await wait(500);
      const runs = [];
      for (let r = 0; r < RUNS; r++) runs.push(await drag(id, false));
      const pick = (name) => median(runs.map((x) => x[name]));
      const row = {
        page: scenario.title,
        zoom: zoom === "fit" ? `fit (${Math.round(runs[0].zoom * 100)} %)` : zoom,
        frameMedian: pick("frameMedian"),
        frameP95: pick("frameP95"),
        frameWorst: Math.max(...runs.map((x) => x.frameWorst)),
        moveMedian: pick("moveMedian"),
        moveP95: pick("moveP95"),
        movesSeen: pick("movesSeen"),
        paintMedian: pick("paintMedian"),
        paintP95: pick("paintP95"),
        busyPerFrame: pick("busyPerFrame"),
        otherScript: pick("otherScript"),
        layout: pick("layout"),
        rest: pick("rest"),
        repaints: pick("repaints"),
        frames: pick("frames"),
        opsPerRepaint: pick("opsPerRepaint"),
        small: pick("small"),
        longTasks: runs.reduce((n, x) => n + x.longTasks, 0),
        longWorst: Math.max(...runs.map((x) => x.longWorst)),
        ok: runs.every((x) => x.ok),
        differ: Math.max(...runs.map((x) => x.picture.differ)),
        differBy: Math.max(...runs.map((x) => x.picture.worst)),
      };
      rows.push(row);
      console.log(
        `${row.page} @ ${row.zoom}: frame ${f1(row.frameMedian)} / ${f1(row.frameP95)} / ${f1(row.frameWorst)} ms (median / p95 / worst), move ${f1(row.moveMedian)} / ${f1(row.moveP95)}, paint ${f1(row.paintMedian)} / ${f1(row.paintP95)}, busy ${f1(row.busyPerFrame)} per repaint (other script ${f1(row.otherScript)}, layout ${f1(row.layout)}, rest ${f1(row.rest)}), ${row.movesSeen} moves seen, ${row.repaints} repaints in ${row.frames} frames, ${row.opsPerRepaint} canvas calls each, ${row.small} calls on thumbnails in the whole drag, long tasks ${row.longTasks}, picture of the drag against the page at rest: ${row.differ ? `${row.differ} px differ, by up to ${row.differBy} of 255` : "the same"}${row.ok ? "" : "  (!! the drag did not move the element by one undo step)"}`,
      );
      if (PROFILE === key) {
        const p = await drag(id, true);
        console.log(`  CPU profile of one drag (self time):\n  ${p.hot.join("\n  ")}`);
      }
    }
  }

  const table = [
    "| Page | Zoom | Frame median | Frame p95 | Worst frame | Move median | Move p95 | Paint median | Paint p95 | Busy per repaint | of it: other script | layout and style | no script | Moves seen / repaints / frames | Canvas calls per repaint | Canvas calls on thumbnails, whole drag | Long tasks | Last frame of the drag against the page at rest |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.page} | ${r.zoom} | ${f1(r.frameMedian)} | ${f1(r.frameP95)} | ${f1(r.frameWorst)} | ${f1(r.moveMedian)} | ${f1(r.moveP95)} | ${f1(r.paintMedian)} | ${f1(r.paintP95)} | ${f1(r.busyPerFrame)} | ${f1(r.otherScript)} | ${f1(r.layout)} | ${f1(r.rest)} | ${r.movesSeen} / ${r.repaints} / ${r.frames} | ${r.opsPerRepaint} | ${r.small} | ${r.longTasks}${r.longTasks ? ` (worst ${Math.round(r.longWorst)} ms)` : ""} | ${r.differ ? `${r.differ} px differ, by up to ${r.differBy} of 255` : "same"} |`,
    ),
  ].join("\n");
  const version = browser.version();
  console.log(`\n${BASE}, Chrome ${version}, ${process.env.HEADED ? "headed" : "headless"}, ${RUNS} runs of ${MOVES} moves, all times in ms`);
  console.log(`GPU: ${machine.gpu}; ${machine.cores} logical cores; device pixel ratio ${machine.dpr}\n`);
  console.log(table);
  if (errors.length) console.log("\n" + errors.join("\n"));
  fs.writeFileSync(OUT + "result.json", JSON.stringify({ base: BASE, version, headed: !!process.env.HEADED, machine, rows }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
