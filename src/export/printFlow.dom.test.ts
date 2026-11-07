import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import { isCancelled } from "./errors";
import { printDesign } from "./print";

function design(pageCount = 2): Design {
  return createDesign({
    title: "Menu & more",
    width: 200,
    height: 100,
    pages: Array.from({ length: pageCount }, (_v, i) => createPage({ background: solid("#ffffff"), elements: [createShape("rect", { x: i * 10, y: 0, width: 30, height: 30 })] })),
  });
}

interface FakeImage {
  complete: boolean;
  decode: () => Promise<void>;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

interface FakeWindow {
  document: { images: FakeImage[] };
  addEventListener: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  print: ReturnType<typeof vi.fn>;
}

/**
 * jsdom does not load images into frames, so the print iframe gets a stand-in window. `settle` fires the frame's
 * load (or error) event once the module has put it on the page.
 */
function stubFrame(options: { images?: Partial<FakeImage>[]; noWindow?: boolean; fail?: boolean } = {}) {
  const win: FakeWindow = {
    document: { images: (options.images ?? [{}, {}]).map((over) => ({ complete: true, decode: () => Promise.resolve(), onload: null, onerror: null, ...over })) },
    addEventListener: vi.fn(),
    focus: vi.fn(),
    print: vi.fn(),
  };
  const frames: HTMLIFrameElement[] = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = create(tag);
    if (tag === "iframe") {
      frames.push(el as HTMLIFrameElement);
      Object.defineProperty(el, "contentWindow", { get: () => (options.noWindow ? null : win), configurable: true });
    }
    return el;
  }) as never);
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement) queueMicrotask(() => node.dispatchEvent(new Event(options.fail ? "error" : "load")));
    return result;
  }) as never);
  return { win, frames };
}

let urls: string[];
let revoked: string[];

beforeEach(() => {
  urls = [];
  revoked = [];
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:print/${++n}`;
    urls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.push(url);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("printing a design", () => {
  it("renders every page, shows them one per sheet in a hidden frame and opens the print dialog", async () => {
    const { win, frames } = stubFrame();
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    const progress = vi.fn();
    const open = vi.fn();
    await printDesign(design(), { onProgress: progress, openPrintDialog: open });
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    // PNG pages at twice the design size
    expect(toBlob.mock.calls.map((c) => c[1])).toEqual(["image/png", "image/png"]);
    expect((toBlob.mock.contexts as HTMLCanvasElement[]).length).toBe(2);
    const [frame] = frames;
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.tabIndex).toBe(-1);
    expect(frame.style.cssText).toContain("opacity: 0");
    expect(frame.srcdoc).toContain("@page { size: 200px 100px; margin: 0; }");
    expect(frame.srcdoc).toContain(`<img src="${urls[0]}" alt="Page 1">`);
    expect(frame.srcdoc).toContain("<title>Menu &amp; more</title>");
    expect(document.body.contains(frame)).toBe(true);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(win);
    expect(win.print).not.toHaveBeenCalled();
  });

  it("calls the browser's own print by default", async () => {
    const { win } = stubFrame();
    await printDesign(design(1));
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it("prints only the pages asked for, ignoring numbers that are not pages", async () => {
    stubFrame();
    const progress = vi.fn();
    await printDesign(design(3), { pages: [2, 7, -1, 0], onProgress: progress, openPrintDialog: () => undefined });
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(urls).toHaveLength(2);
  });

  it("says there is nothing to print when no page is chosen", async () => {
    await expect(printDesign(design(), { pages: [9] })).rejects.toMatchObject({ code: "no-pages", message: "There is nothing to print." });
  });

  it("says printing is not available where there is no document", async () => {
    vi.stubGlobal("document", undefined);
    await expect(printDesign(design())).rejects.toMatchObject({ code: "unsupported", message: "Printing is not available here." });
  });

  it("switches to JPEG pages once there are too many for lossless images", async () => {
    stubFrame();
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    await printDesign(design(13), { openPrintDialog: () => undefined });
    expect(toBlob.mock.calls.every((c) => c[1] === "image/jpeg" && c[2] === 0.95)).toBe(true);
    toBlob.mockClear();
    await printDesign(design(12), { openPrintDialog: () => undefined });
    expect(toBlob.mock.calls.every((c) => c[1] === "image/png" && c[2] === undefined)).toBe(true);
  });

  it("waits for pictures that are still loading, and for them to be decoded", async () => {
    const decoded = vi.fn(() => Promise.reject(new Error("cannot decode")));
    const slow: Partial<FakeImage> = { complete: false, decode: decoded };
    const { win } = stubFrame({ images: [slow, {}] });
    let opened = false;
    const done = printDesign(design(), { openPrintDialog: () => (opened = true) });
    await vi.waitFor(() => expect(win.document.images[0].onload).toBeTypeOf("function"));
    expect(opened).toBe(false);
    win.document.images[0].onload?.();
    await done;
    expect(opened).toBe(true);
    // a picture that fails to decode must not stop the printing
    expect(decoded).toHaveBeenCalled();
  });

  it("also carries on when a picture fails to load", async () => {
    const { win } = stubFrame({ images: [{ complete: false }] });
    const open = vi.fn();
    const done = printDesign(design(1), { openPrintDialog: open });
    await vi.waitFor(() => expect(win.document.images[0].onerror).toBeTypeOf("function"));
    win.document.images[0].onerror?.();
    await done;
    expect(open).toHaveBeenCalledTimes(1);
  });

  describe("cleaning up", () => {
    it("takes the frame away and gives the page images back once printing is over", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { win, frames } = stubFrame();
      await printDesign(design(), { openPrintDialog: () => undefined });
      expect(document.body.contains(frames[0])).toBe(true);
      const [event, onAfterPrint] = win.addEventListener.mock.calls[0] as [string, () => void];
      expect(event).toBe("afterprint");
      onAfterPrint();
      // the dialog may still be closing: a little grace before the images go
      vi.advanceTimersByTime(499);
      expect(revoked).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(document.body.contains(frames[0])).toBe(false);
      expect(revoked.sort()).toEqual([...urls].sort());
    });

    it("cleans up after five minutes when the browser never says printing is over", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { frames } = stubFrame();
      await printDesign(design(), { openPrintDialog: () => undefined });
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(document.body.contains(frames[0])).toBe(true);
      vi.advanceTimersByTime(1);
      expect(document.body.contains(frames[0])).toBe(false);
      expect(revoked).toHaveLength(2);
    });

    it("gives the images back when a page cannot be rendered", async () => {
      stubFrame();
      let call = 0;
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => {
        call++;
        callback(call === 1 ? new Blob(["page"], { type }) : null);
      });
      await expect(printDesign(design(), { openPrintDialog: () => undefined })).rejects.toMatchObject({ code: "too-large" });
      expect(urls).toHaveLength(1);
      expect(revoked).toEqual(urls);
    });

    it("stops when it is cancelled, giving back what it made", async () => {
      const { frames } = stubFrame();
      const controller = new AbortController();
      const error = await printDesign(design(3), { signal: controller.signal, onProgress: (done) => done === 1 && controller.abort(), openPrintDialog: () => undefined }).catch(
        (e) => e,
      );
      expect(isCancelled(error)).toBe(true);
      expect(revoked).toEqual(urls);
      expect(urls).toHaveLength(1);
      expect(frames).toHaveLength(0);
    });

    it("removes the frame and says so when it cannot be loaded", async () => {
      const { frames } = stubFrame({ fail: true });
      await expect(printDesign(design(), { openPrintDialog: () => undefined })).rejects.toMatchObject({
        code: "unsupported",
        message: "Could not prepare the pages for printing.",
      });
      expect(document.body.contains(frames[0])).toBe(false);
      expect(revoked.sort()).toEqual([...urls].sort());
    });

    it("removes the frame and says so when the browser gives no window to print from", async () => {
      const { frames } = stubFrame({ noWindow: true });
      await expect(printDesign(design(), { openPrintDialog: () => undefined })).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining("Allow pop-ups") });
      expect(document.body.contains(frames[0])).toBe(false);
      expect(revoked.sort()).toEqual([...urls].sort());
    });
  });
});
