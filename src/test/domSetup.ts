/**
 * Setup for the component tests (the "ui" project: jsdom). jsdom is a DOM without a browser around it, so the pieces
 * Craftly leans on - canvas, IndexedDB, observers, matchMedia, image decoding, object URLs - are provided here.
 */
import "fake-indexeddb/auto";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { installCanvasMock } from "./canvasMock";
import { installMatchMedia, resetMedia } from "./media";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A screen that loads its code lazily (the dashboard, a side-panel tab) can take many seconds to arrive when the machine
// is busy, so `findBy*` and `waitFor` wait that long before they give up. A test that passes never waits for it.
configure({ asyncUtilTimeout: 20_000 });

/**
 * Craftly's screens are updated from places a test cannot wrap in `act()`: store writes made by the code under test,
 * observers, timers, image loads. React's "not wrapped in act(...)" warning for those fired thousands of times in one
 * run and buried the messages that matter, so it alone is dropped. Everything else React and the app print still shows.
 */
const printError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act(")) return;
  printError(...args);
};

installCanvasMock();

/* ---------- layout: jsdom reports 0 x 0 for everything, so give the page a plausible size ---------- */
Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });

installMatchMedia();

/** Observers that report once, at once, so components that wait for a size or for visibility render their content. */
class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() => {
      const r = target.getBoundingClientRect();
      this.callback([{ target, contentRect: r, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as unknown as ResizeObserverEntry], this);
    });
  }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = TestResizeObserver;

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [0];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback([{ target, isIntersecting: true, intersectionRatio: 1, boundingClientRect: target.getBoundingClientRect() } as IntersectionObserverEntry], this),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
globalThis.IntersectionObserver = TestIntersectionObserver;

/* ---------- things jsdom leaves out ---------- */
const element = Element.prototype as unknown as Record<string, unknown>;
element.scrollIntoView ??= () => undefined;
element.setPointerCapture ??= () => undefined;
element.releasePointerCapture ??= () => undefined;
element.hasPointerCapture ??= () => false;
const htmlElement = HTMLElement.prototype as unknown as Record<string, unknown>;
htmlElement.scrollTo ??= () => undefined;
htmlElement.scrollBy ??= () => undefined;
window.scrollTo = () => undefined;
window.print = () => undefined;
window.open = () => null;
(document as unknown as Record<string, unknown>).execCommand = () => false;
(document as unknown as Record<string, unknown>).elementFromPoint ??= () => null;
(HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen = function requestFullscreen(this: HTMLElement) {
  Object.defineProperty(document, "fullscreenElement", { value: this, configurable: true });
  return Promise.resolve();
};
(document as unknown as Record<string, unknown>).exitFullscreen = () => {
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  return Promise.resolve();
};

let objectUrls = 0;
URL.createObjectURL = () => `blob:test/${++objectUrls}`;
URL.revokeObjectURL = () => undefined;

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: vi.fn(async () => undefined), readText: vi.fn(async () => ""), write: vi.fn(async () => undefined), read: vi.fn(async () => []) },
});

globalThis.createImageBitmap = (async (source: { width?: number; height?: number }) => ({
  width: source.width ?? 64,
  height: source.height ?? 48,
  close() {},
})) as typeof createImageBitmap;

/**
 * Images "load" a tick after `src` is set, at 64 x 48 (or 24 x 24 for SVG). A source that contains "broken" fails, which
 * is how a test exercises the error paths.
 */
const imageProto = HTMLImageElement.prototype;
const nativeSrc = Object.getOwnPropertyDescriptor(imageProto, "src");
Object.defineProperty(imageProto, "src", {
  configurable: true,
  get() {
    return this.getAttribute("src") ?? "";
  },
  set(value: string) {
    this.setAttribute("src", value);
    const broken = String(value).includes("broken");
    queueMicrotask(() => {
      if (broken) this.dispatchEvent(new Event("error"));
      else this.dispatchEvent(new Event("load"));
    });
  },
});
void nativeSrc;
Object.defineProperty(imageProto, "naturalWidth", { configurable: true, get: () => 64 });
Object.defineProperty(imageProto, "naturalHeight", { configurable: true, get: () => 48 });
Object.defineProperty(imageProto, "complete", { configurable: true, get: () => true });
imageProto.decode = () => Promise.resolve();

/* ---------- every test starts from a clean browser ---------- */
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
  resetMedia();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
