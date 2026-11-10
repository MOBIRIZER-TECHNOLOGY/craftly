/*
 * Craftly service worker - makes the whole app work offline after the first visit, and updates it without pulling the
 * code out from under a tab that is open.
 *  - install: stores the app shell and every file the build produced (listed in precache.json), then WAITS. A new worker
 *    does not replace the running one by itself, so every open tab keeps the code it started with (and the files that
 *    code may still ask for) until the person presses Reload in the app, or closes the tabs
 *  - message: a page that wants the new version sends "SKIP_WAITING"; "VERSION" asks which build this worker is, on the
 *    port that comes with the message, so a page can tell whether it already runs it (src/serviceWorker.ts)
 *  - activate: claims the open pages and deletes the caches of older builds, except the build that ran before this one:
 *    a tab that is still open on it may ask for one more of its files
 *  - navigation requests: network first, fall back to the cached app shell
 *  - same-origin assets: cache first (any build's cache), filled lazily for anything that was not precached
 *  - WebAssembly files (the ONNX runtime of the on-device photo tools) go to a cache of their own: they are fetched on
 *    first use, not on the first visit, and a new build keeps them because their names change only with their content
 * Designs and uploads live in IndexedDB, so nothing else is needed to keep working offline.
 * The build replaces the build id below (and the same id in index.html and precache.json), so every new build installs a
 * fresh worker.
 */
const BUILD_ID = "__BUILD_ID__";
const VERSION = "craftly-" + BUILD_ID;
const RUNTIME = "craftly-runtime";
// an empty cache whose name records which build took over last: the build that was running before this one
const ACTIVE = "craftly-active-";
const isRuntimeFile = (url) => url.pathname.endsWith(".wasm");
// AI model files (about 90 MB) are kept by the app itself, in its own database: a copy here would double the storage
const isModelFile = (url) => url.pathname.endsWith(".onnx");
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./favicon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(SHELL);
      try {
        const res = await fetch("./precache.json", { cache: "no-store" });
        const { files, runtime = [] } = await res.json();
        const code = files.filter((f) => /\.(js|css)$/.test(f));
        const rest = files.filter((f) => !/\.(js|css)$/.test(f));
        await cache.addAll(code);
        // fonts and images are best effort: a miss only means they are cached later, on first use
        await Promise.allSettled(rest.map((f) => cache.add(f)));
        // runtime files of earlier builds that this build no longer uses
        const keep = new Set(runtime.map((f) => new URL(f, self.location.href).href));
        const store = await caches.open(RUNTIME);
        for (const request of await store.keys()) if (!keep.has(request.url)) await store.delete(request);
      } catch {
        /* dev server or unusual hosting: assets are cached lazily instead */
      }
      // no skipWaiting() here: see the message handler
    })(),
  );
});

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "SKIP_WAITING") self.skipWaiting();
  else if (message.type === "VERSION" && event.ports && event.ports[0]) event.ports[0].postMessage({ build: BUILD_ID });
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // the marker of the build that ran before this one says which files a tab that is still open on it may need
      const before = names.find((name) => /^craftly-active-[a-f0-9]{10}$/.test(name));
      const keep = new Set([VERSION, RUNTIME, ACTIVE + BUILD_ID, before ? "craftly-" + before.slice(ACTIVE.length) : null]);
      await Promise.all(names.filter((name) => /^craftly-(?:active-)?[a-f0-9]{10}$/.test(name) && !keep.has(name)).map((name) => caches.delete(name)));
      await caches.open(ACTIVE + BUILD_ID);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isModelFile(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html", { ignoreVary: true })),
    );
    return;
  }

  // ignoreVary: static hosts often send "Vary: Origin", and module scripts send an Origin header that the precache fetch lacks
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // a runtime file must really be one: a host that answers an unknown path with its home page (a 200 with HTML)
          // would otherwise get a web page stored under a .wasm name
          if (res.ok && (!isRuntimeFile(url) || /wasm/.test(res.headers.get("content-type") || ""))) {
            const copy = res.clone();
            caches.open(isRuntimeFile(url) ? RUNTIME : VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
