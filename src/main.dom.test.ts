import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EditorHook = { getState: () => unknown };
const exposedStore = () => (window as unknown as { __editor?: EditorHook }).__editor;

/** Every "load" listener main.tsx adds to the window (the window outlives each test, so they are removed again). */
let loadListeners: EventListenerOrEventListenerObject[] = [];

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
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "load") loadListeners.push(listener);
    add(type, listener, options);
  });
});

afterEach(() => {
  for (const listener of loadListeners) window.removeEventListener("load", listener);
  vi.unstubAllEnvs();
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
});

describe("main", () => {
  it("renders the app into #root", async () => {
    await boot("#/trash");
    expect(await screen.findByRole("heading", { level: 1, name: "Trash" })).toBeTruthy();
    expect(document.getElementById("root")?.querySelector(".cf-dash")).toBeTruthy();
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
    function fakeServiceWorker(register: () => Promise<unknown>) {
      const spy = vi.fn(register);
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: spy } });
      return spy;
    }

    it("registers the service worker once the page has loaded in a production build", async () => {
      vi.stubEnv("PROD", true);
      const register = fakeServiceWorker(() => Promise.resolve({}));
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
      const register = fakeServiceWorker(() => Promise.resolve({}));
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
