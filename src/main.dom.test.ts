import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProblems, listProblems } from "@/core/problems";

type EditorHook = { getState: () => unknown };
const exposedStore = () => (window as unknown as { __editor?: EditorHook }).__editor;

/** Every "load" listener main.tsx adds to the window (the window outlives each test, so they are removed again), and the ones that catch problems. */
let loadListeners: EventListenerOrEventListenerObject[] = [];
let problemListeners: Array<[string, EventListenerOrEventListenerObject]> = [];

/** Put an empty #root in the page and run main.tsx on it, as index.html does. */
async function boot(hash = "#/trash") {
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  window.location.hash = hash;
  vi.resetModules();
  await import("@/main");
}

beforeEach(() => {
  delete (window as unknown as { __editor?: unknown }).__editor;
  loadListeners = [];
  problemListeners = [];
  localStorage.clear();
  clearProblems();
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "load") loadListeners.push(listener);
    if (type === "error" || type === "unhandledrejection") problemListeners.push([type, listener]);
    add(type, listener, options);
  });
});

afterEach(() => {
  for (const listener of loadListeners) window.removeEventListener("load", listener);
  for (const [type, listener] of problemListeners) window.removeEventListener(type, listener);
  vi.unstubAllEnvs();
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
});

describe("main", () => {
  it("renders the app into #root", async () => {
    await boot("#/trash");
    expect(await screen.findByRole("heading", { level: 1, name: "Trash" })).toBeTruthy();
    expect(document.getElementById("root")?.querySelector(".cf-dash")).toBeTruthy();
  });

  it("tells the person to reload when another tab upgrades the library under this one", async () => {
    await boot("#/trash");
    // the page has read the library, so this tab holds a connection to the database
    await screen.findByText("The trash is empty");
    try {
      // what a newer release does the first time it changes the stores: it asks for a higher version of the database
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("craftly", 2);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
      // (the apps of the tests before this one still hold a connection and say it too: more than one notice is fine)
      expect((await screen.findAllByText("Craftly was updated in another tab. Reload this tab to keep working.")).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByRole("button", { name: "Reload" }).length).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("craftly");
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      });
    }
  });

  it("writes down a failure that nothing waited for, from the start, so that it can be reported", async () => {
    await boot("#/trash");
    await screen.findByText("The trash is empty");
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("a failure nothing waited for") }));
    expect(listProblems()[0]).toMatchObject({ kind: "promise", message: "a failure nothing waited for", route: "trash" });
  });

  it("exposes the editor store on the window while developing, for scripted tests and the console", async () => {
    await boot();
    await waitFor(() => expect(exposedStore()).toBeTruthy());
    expect(typeof exposedStore()?.getState).toBe("function");
  });

  it("keeps the store private in a production build", async () => {
    vi.stubEnv("DEV", false);
    await boot();
    await screen.findByRole("heading", { level: 1, name: "Trash" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exposedStore()).toBeUndefined();
  });

  it("exposes the store in a production build made for end-to-end runs", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_EXPOSE_STORE", "1");
    await boot();
    await waitFor(() => expect(exposedStore()).toBeTruthy());
  });

  describe("offline support", () => {
    /** What a registration offers a page that has nothing waiting. */
    const registration = () => ({ waiting: null, installing: null, addEventListener: () => undefined, removeEventListener: () => undefined, update: async () => undefined });

    function fakeServiceWorker(register: () => Promise<unknown>) {
      const spy = vi.fn(register);
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: spy, controller: null } });
      return spy;
    }

    it("registers the service worker once the page has loaded in a production build", async () => {
      vi.stubEnv("PROD", true);
      const register = fakeServiceWorker(() => Promise.resolve(registration()));
      await boot();
      expect(register).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("load"));
      expect(register).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledWith("/sw.js");
    });

    it("carries on when the service worker cannot be registered", async () => {
      vi.stubEnv("PROD", true);
      const register = fakeServiceWorker(() => Promise.reject(new Error("blocked")));
      await boot();
      window.dispatchEvent(new Event("load"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(register).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole("heading", { level: 1, name: "Trash" })).toBeTruthy();
    });

    it("does not register it while developing, where it would fight hot reloading", async () => {
      const register = fakeServiceWorker(() => Promise.resolve(registration()));
      await boot();
      window.dispatchEvent(new Event("load"));
      expect(register).not.toHaveBeenCalled();
    });

    it("does nothing in a browser without service workers", async () => {
      vi.stubEnv("PROD", true);
      await boot();
      expect(loadListeners).toHaveLength(0);
    });
  });
});
