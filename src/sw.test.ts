import { describe, expect, it, vi } from "vitest";
import { FakeNetwork, loadWorker, ORIGIN } from "@/test/swHarness";

/** What the server of one build answers: the app shell, the three kinds of file precache.json lists, and the list. */
function serveBuild(network: FakeNetwork, build: string, runtime: string[] = []): FakeNetwork {
  return network
    .serve("/", `<html>shell ${build}</html>`, "text/html")
    .serve("/index.html", `<html>shell ${build}</html>`, "text/html")
    .serve("/manifest.webmanifest", "{}", "application/manifest+json")
    .serve("/favicon.svg", "<svg/>", "image/svg+xml")
    .serve("/icon-192.png", "png192", "image/png")
    .serve("/icon-512.png", "png512", "image/png")
    .serve(`/assets/index-${build}.js`, `// app ${build}`, "text/javascript")
    .serve(`/assets/index-${build}.css`, "body{}", "text/css")
    .serve(`/assets/font-${build}.woff2`, "font", "font/woff2")
    .serve(
      "/precache.json",
      JSON.stringify({ buildId: build, files: [`assets/index-${build}.js`, `assets/index-${build}.css`, `assets/font-${build}.woff2`], runtime }),
      "application/json",
    );
}

const BUILD_CACHES = /^craftly-[a-f0-9]{10}$/;
const builds = async (worker: ReturnType<typeof loadWorker>) => (await worker.caches.keys()).filter((name) => BUILD_CACHES.test(name));
const text = async (response: Response | undefined) => (await response?.text()) ?? "(no response)";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An installed and active worker of `build`, over the storage of the one before it. */
async function running(build: string, over: Partial<Parameters<typeof loadWorker>[0]> = {}) {
  const network = over.network ?? serveBuild(new FakeNetwork(), build);
  const worker = loadWorker({ buildId: build, network, caches: over.caches });
  await worker.install();
  await worker.activate();
  return worker;
}

describe("the service worker", () => {
  it("listens for the four events it works with", () => {
    expect(loadWorker().listening().sort()).toEqual(["activate", "fetch", "install", "message"]);
  });

  describe("installing", () => {
    it("stores the app shell and every file of the build in a cache named after the build", async () => {
      const worker = loadWorker({ buildId: "b1", network: serveBuild(new FakeNetwork(), "b1") });
      await worker.install();
      const stored = [...worker.caches.stores.get("craftly-b1")!.entries.keys()].map((url) => url.replace(ORIGIN, "")).sort();
      expect(stored).toEqual([
        "/",
        "/assets/font-b1.woff2",
        "/assets/index-b1.css",
        "/assets/index-b1.js",
        "/favicon.svg",
        "/icon-192.png",
        "/icon-512.png",
        "/index.html",
        "/manifest.webmanifest",
      ]);
    });

    it("does not take over by itself: the worker that is running keeps its pages until the person agrees or every tab is closed", async () => {
      const worker = loadWorker({ network: serveBuild(new FakeNetwork(), "build1") });
      await worker.install();
      expect(worker.skipWaiting).not.toHaveBeenCalled();
      expect(worker.claim).not.toHaveBeenCalled();
    });

    it("keeps the web assembly files that this build still uses and drops the ones it does not", async () => {
      const network = serveBuild(new FakeNetwork(), "b2", ["assets/ort-new.wasm"]);
      const worker = loadWorker({ buildId: "b2", network });
      const runtime = await worker.caches.open("craftly-runtime");
      await runtime.put("/assets/ort-old.wasm", new Response("old"));
      await runtime.put("/assets/ort-new.wasm", new Response("new"));
      await worker.install();
      expect([...runtime.entries.keys()].map((url) => url.replace(ORIGIN, ""))).toEqual(["/assets/ort-new.wasm"]);
    });

    it("installs with the shell alone when the build's file list is not there, as under a dev server", async () => {
      const network = serveBuild(new FakeNetwork(), "b1");
      network.serve("/precache.json", "<html>not json</html>", "text/html");
      const worker = loadWorker({ buildId: "b1", network });
      await worker.install();
      expect([...worker.caches.stores.get("craftly-b1")!.entries.keys()]).toHaveLength(6);
    });

    it("does not fail because a font or a picture could not be fetched: it is cached later, when it is first used", async () => {
      const network = serveBuild(new FakeNetwork(), "b1");
      network.serve("/precache.json", JSON.stringify({ buildId: "b1", files: ["assets/index-b1.js", "assets/missing.png"], runtime: [] }), "application/json");
      const worker = loadWorker({ buildId: "b1", network });
      await worker.install();
      const stored = [...worker.caches.stores.get("craftly-b1")!.entries.keys()];
      expect(stored.some((url) => url.endsWith("/assets/index-b1.js"))).toBe(true);
      expect(stored.some((url) => url.endsWith("missing.png"))).toBe(false);
    });

    it("fails, and so leaves the running worker alone, when the shell cannot be fetched", async () => {
      const network = serveBuild(new FakeNetwork(), "b1");
      network.online = false;
      await expect(loadWorker({ network }).install()).rejects.toThrow();
    });
  });

  describe("being asked to take over", () => {
    it("takes over when a page says so", () => {
      const worker = loadWorker();
      worker.message({ type: "SKIP_WAITING" });
      expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("does nothing for any other message", () => {
      const worker = loadWorker();
      const port = { postMessage: vi.fn() };
      for (const data of ["SKIP_WAITING", null, undefined, 42, {}, { type: "other" }, { type: "skip_waiting" }]) worker.message(data, port);
      expect(worker.skipWaiting).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
    });

    it("tells a page which build it is, on the port the page sent along", () => {
      const worker = loadWorker({ buildId: "b7" });
      const port = { postMessage: vi.fn() };
      worker.message({ type: "VERSION" }, port);
      expect(port.postMessage).toHaveBeenCalledWith({ build: "b7" });
      expect(() => worker.message({ type: "VERSION" })).not.toThrow(); // no port: nobody to tell
    });
  });

  describe("taking over", () => {
    it("claims the pages that are open, so the first visit works offline without a reload", async () => {
      const worker = loadWorker({ network: serveBuild(new FakeNetwork(), "build1") });
      await worker.install();
      await worker.activate();
      expect(worker.claim).toHaveBeenCalledTimes(1);
    });

    it("keeps its own files, the web assembly cache and the build that ran before it, and leaves unrelated caches alone", async () => {
      const first = await running("aaaaaaaaaa");
      const stray = await first.caches.open("some-other-cache");
      await stray.put("/x", new Response("x"));
      await (await first.caches.open("craftly-runtime")).put("/assets/ort.wasm", new Response("wasm"));
      const second = await running("bbbbbbbbbb", { network: serveBuild(first.network, "bbbbbbbbbb"), caches: first.caches });
      const names = await second.caches.keys();
      expect(names).toContain("craftly-aaaaaaaaaa");
      expect(names).toContain("craftly-bbbbbbbbbb");
      expect(names).toContain("craftly-runtime");
      expect(names).toContain("some-other-cache");
    });

    it("keeps only one build back: the one that ran before the build that takes over now", async () => {
      const first = await running("aaaaaaaaaa");
      const second = await running("bbbbbbbbbb", { network: serveBuild(first.network, "bbbbbbbbbb"), caches: first.caches });
      expect(await builds(second)).toEqual(["craftly-aaaaaaaaaa", "craftly-bbbbbbbbbb"]);
      const third = await running("cccccccccc", { network: serveBuild(first.network, "cccccccccc"), caches: first.caches });
      expect(await builds(third)).toEqual(["craftly-bbbbbbbbbb", "craftly-cccccccccc"]);
    });

    it("keeps the build whose pages are open, not one that was stored by a worker that never took over", async () => {
      const first = await running("aaaaaaaaaa");
      const waiting = loadWorker({ buildId: "bbbbbbbbbb", network: serveBuild(first.network, "bbbbbbbbbb"), caches: first.caches });
      await waiting.install(); // bbbbbbbbbb is stored, then replaced by cccccccccc before it ever ran
      const third = await running("cccccccccc", { network: serveBuild(first.network, "cccccccccc"), caches: first.caches });
      expect(await builds(third)).toEqual(["craftly-aaaaaaaaaa", "craftly-cccccccccc"]);
    });

    it("has no build to keep the first time", async () => {
      const worker = await running("aaaaaaaaaa");
      expect(await builds(worker)).toEqual(["craftly-aaaaaaaaaa"]);
    });
  });

  describe("answering requests", () => {
    it("leaves every request that is not a GET to the browser", async () => {
      const worker = await running("b1");
      expect(await worker.request("/assets/index-b1.js", { method: "POST" })).toBeUndefined();
    });

    it("leaves other sites alone", async () => {
      const worker = await running("b1");
      expect(await worker.request("https://elsewhere.example/lib.js")).toBeUndefined();
    });

    it("leaves model files to the app, which stores them in its own database", async () => {
      const worker = await running("b1");
      expect(await worker.request("/models/isnet.onnx")).toBeUndefined();
    });

    it("opens a page from the network first, and keeps the latest copy as the shell", async () => {
      const worker = await running("b1");
      worker.network.serve("/index.html", "<html>fresh from the server</html>", "text/html");
      worker.network.serve("/", "<html>fresh from the server</html>", "text/html");
      expect(await text(await worker.request("/", { mode: "navigate" }))).toBe("<html>fresh from the server</html>");
      await tick();
      const shell = await worker.caches.stores.get("craftly-b1")!.match("./index.html");
      expect(await text(shell)).toBe("<html>fresh from the server</html>");
    });

    it("does not keep an error page of the host as the shell, and opens the stored shell in its place", async () => {
      const worker = await running("b1");
      worker.network.serve("/", () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
      expect(await text(await worker.request("/", { mode: "navigate" }))).toBe("<html>shell b1</html>");
      await tick();
      expect(await text(await worker.caches.stores.get("craftly-b1")!.match("./index.html"))).toBe("<html>shell b1</html>");
    });

    it("passes on an answer that says the page is not there, without keeping it", async () => {
      const worker = await running("b1");
      worker.network.serve("/", () => new Response("<html>gone</html>", { status: 404, headers: { "content-type": "text/html" } }));
      const response = await worker.request("/", { mode: "navigate" });
      expect(response?.status).toBe(404);
      await tick();
      expect(await text(await worker.caches.stores.get("craftly-b1")!.match("./index.html"))).toBe("<html>shell b1</html>");
    });

    it("does not keep what another address answers as the shell: a text file, or a page that is not the app's", async () => {
      const worker = await running("b1");
      worker.network.serve("/robots.txt", "User-agent: *", "text/plain");
      worker.network.serve("/other/page.html", "<html>somebody else's page</html>", "text/html");
      expect(await text(await worker.request("/robots.txt", { mode: "navigate" }))).toBe("User-agent: *");
      expect(await text(await worker.request("/other/page.html", { mode: "navigate" }))).toBe("<html>somebody else's page</html>");
      await tick();
      expect(await text(await worker.caches.stores.get("craftly-b1")!.match("./index.html"))).toBe("<html>shell b1</html>");
    });

    it("does not keep an answer for the app's page that is no page", async () => {
      const worker = await running("b1");
      worker.network.serve("/", '{"error":"maintenance"}', "application/json");
      expect(await text(await worker.request("/", { mode: "navigate" }))).toBe('{"error":"maintenance"}');
      await tick();
      expect(await text(await worker.caches.stores.get("craftly-b1")!.match("./index.html"))).toBe("<html>shell b1</html>");
    });

    it("keeps the page as the shell when it is asked for by name", async () => {
      const worker = await running("b1");
      worker.network.serve("/index.html", "<html>fresh by name</html>", "text/html; charset=utf-8");
      expect(await text(await worker.request("/index.html", { mode: "navigate" }))).toBe("<html>fresh by name</html>");
      await tick();
      expect(await text(await worker.caches.stores.get("craftly-b1")!.match("./index.html"))).toBe("<html>fresh by name</html>");
    });

    it("opens the stored shell when there is no connection", async () => {
      const worker = await running("b1");
      worker.network.online = false;
      expect(await text(await worker.request("/some/route", { mode: "navigate" }))).toBe("<html>shell b1</html>");
    });

    it("serves a file of the build from the cache, without asking the network", async () => {
      const worker = await running("b1");
      const before = worker.network.calls.length;
      expect(await text(await worker.request("/assets/index-b1.js"))).toBe("// app b1");
      expect(worker.network.calls).toHaveLength(before);
    });

    it("still finds the files of an older build in its cache, for a tab that is running them", async () => {
      const first = await running("b1");
      const second = await running("b2", { network: serveBuild(first.network, "b2"), caches: first.caches });
      first.network.online = false; // and the server no longer has them
      expect(await text(await second.request("/assets/index-b1.js"))).toBe("// app b1");
    });

    it("fetches a file that was not stored, and stores it for next time", async () => {
      const worker = await running("b1");
      worker.network.serve("/assets/late.js", "// late", "text/javascript");
      expect(await text(await worker.request("/assets/late.js"))).toBe("// late");
      await tick();
      expect(await text(await worker.caches.stores.get("craftly-b1")!.match("/assets/late.js"))).toBe("// late");
    });

    it("does not store an answer that is not a success", async () => {
      const worker = await running("b1");
      const response = await worker.request("/assets/missing.js");
      expect(response?.status).toBe(404);
      await tick();
      expect(worker.caches.stores.get("craftly-b1")!.entries.has(`${ORIGIN}/assets/missing.js`)).toBe(false);
    });

    it("stores a web assembly file in the cache that survives updates", async () => {
      const worker = await running("b1");
      worker.network.serve("/assets/ort.wasm", () => new Response("wasm bytes", { status: 200, headers: { "content-type": "application/wasm" } }));
      await worker.request("/assets/ort.wasm");
      await tick();
      expect(worker.caches.stores.get("craftly-runtime")?.entries.has(`${ORIGIN}/assets/ort.wasm`)).toBe(true);
      expect(worker.caches.stores.get("craftly-b1")!.entries.has(`${ORIGIN}/assets/ort.wasm`)).toBe(false);
    });

    it("does not store a web page under the name of a web assembly file, which is what a host that answers every path with its home page would send", async () => {
      const worker = await running("b1");
      worker.network.serve("/assets/ort.wasm", "<html>home page</html>", "text/html");
      expect(await text(await worker.request("/assets/ort.wasm"))).toBe("<html>home page</html>");
      await tick();
      expect(worker.caches.stores.get("craftly-runtime")?.entries.has(`${ORIGIN}/assets/ort.wasm`) ?? false).toBe(false);
      expect(worker.caches.stores.get("craftly-b1")!.entries.has(`${ORIGIN}/assets/ort.wasm`)).toBe(false);
    });
  });
});
