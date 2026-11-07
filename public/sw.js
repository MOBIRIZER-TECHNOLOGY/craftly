/*
 * Craftly service worker - makes the whole app work offline after the first visit.
 *  - install: stores the app shell and every file the build produced (listed in precache.json)
 *  - navigation requests: network first, fall back to the cached app shell
 *  - same-origin assets: cache first, filled lazily for anything that was not precached
 *  - WebAssembly files (the ONNX runtime of the on-device photo tools) go to a cache of their own: they are fetched on
 *    first use, not on the first visit, and a new build keeps them because their names change only with their content
 * Designs and uploads live in IndexedDB, so nothing else is needed to keep working offline.
 * The build replaces the build id below, so every new build installs a fresh worker and drops the old cache.
 */
const VERSION = "craftly-__BUILD_ID__";
const RUNTIME = "craftly-runtime";
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
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
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
