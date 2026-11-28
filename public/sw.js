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
 *  - navigation requests: network first, fall back to the cached app shell of this build. Only the app's own page, answered as
 *    a page and as a success, is kept as the shell: an error page of the host, or whatever answers another address
 *    (/robots.txt), is not
 *  - same-origin assets: cache first (any build's cache), filled lazily for anything that was not precached
 *  - account requests (a token in the header, or asked not to be stored) go to the network untouched, and an answer marked
 *    `cache-control: no-store` is never stored: an account server on the same address must not have a person's data kept here
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
// the address of the app's page: the folder this worker is served from, with or without index.html
const HOME = new URL("./", self.location.href).pathname;
const isHome = (url) => url.pathname === HOME || url.pathname === HOME + "index.html";
const isPage = (res) => res.ok && (res.headers.get("content-type") || "").toLowerCase().startsWith("text/html");
const PRIVATE_HEADERS = ["authorization", "x-craftly-key", "x-craftly-create-key", "x-craftly-admin-key"];
const isPrivateRequest = (req, url) =>
  url.pathname.startsWith(`${HOME}api/`) ||
  url.pathname === `${HOME}metrics` ||
  url.pathname.startsWith("/api/") ||
  url.pathname === "/metrics" ||
  PRIVATE_HEADERS.some((name) => req.headers.has(name));
// Only files of the application build belong in its caches: what the build put in assets/, and the app shell stored at install
// (the icon and the manifest a page asks for are answered from it offline). APIs and anything carrying a credential always go to
// the network.
const SHELL_PATHS = new Set(SHELL.map((path) => new URL(path, self.location.href).pathname));
const isStaticAsset = (url) => url.pathname.startsWith(`${HOME}assets/`) || SHELL_PATHS.has(url.pathname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(SHELL);
      // a host that sends ./index.html on to ./ (Cloudflare Pages does) has its answer stored as one that was redirected, and a
      // browser opens no page from such an answer: what arrived is stored again as an answer of its own
      const stored = await cache.match("./index.html");
      if (stored && stored.redirected) {
        await cache.put("./index.html", new Response(stored.body, { status: stored.status, statusText: stored.statusText, headers: stored.headers }));
      }
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
      // Workers before this rule could put a person's API answer in a build cache. Do not only bypass it: remove it.
      for (const name of names) {
        if (!/^craftly-(?:active-)?[a-f0-9]{10}$/.test(name)) continue;
        const store = await caches.open(name);
        for (const request of await store.keys()) if (isPrivateRequest(request, new URL(request.url))) await store.delete(request);
      }
      await Promise.all(names.filter((name) => /^craftly-(?:active-)?[a-f0-9]{10}$/.test(name) && !keep.has(name)).map((name) => caches.delete(name)));
      await caches.open(ACTIVE + BUILD_ID);
      await self.clients.claim();
    })(),
  );
});

// The shell to open when the network gives none: the one of this build. Cache Storage looks through its caches oldest first and
// the cache of the build before this one is kept, so asking all of them at once would start the old app (which cannot open a
// database that this build has upgraded). Another build's shell is only for when this one has none.
const storedShell = async () => {
  const own = await (await caches.open(VERSION)).match("./index.html", { ignoreVary: true });
  return own || caches.match("./index.html", { ignoreVary: true });
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isModelFile(url)) return;
  // an account server can be served from this address too: its requests carry the person's token or a key, and the app asks for
  // them not to be kept. A copy here would be served again after signing out, or to whoever signs in next, so the APIs, every
  // request with a credential and every request that asks not to be kept go to the network as they are
  if (isPrivateRequest(req, url) || req.cache === "no-store") return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          if (!isHome(url)) return res;
          if (isPage(res)) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put("./index.html", copy));
            return res;
          }
          // the host is in trouble (a 5xx page, a gateway's error): the app is all on this device, so open the copy that is here
          return res.status >= 500 ? (await storedShell()) || res : res;
        })
        .catch(() => storedShell()),
    );
    return;
  }

  if (!isStaticAsset(url) || req.cache === "no-store") return;

  // ignoreVary: static hosts often send "Vary: Origin", and module scripts send an Origin header that the precache fetch lacks
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // a runtime file must really be one: a host that answers an unknown path with its home page (a 200 with HTML)
          // would otherwise get a web page stored under a .wasm name
          // and an answer the server says must not be kept, or is for one person only, is not
          const cacheControl = res.headers.get("cache-control") || "";
          if (res.ok && !/no-store|private/i.test(cacheControl) && (!isRuntimeFile(url) || /wasm/.test(res.headers.get("content-type") || ""))) {
            const copy = res.clone();
            caches.open(isRuntimeFile(url) ? RUNTIME : VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
