import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage, createShape, solid } from "@/core/factory";
import { renderPage } from "@/render/renderPage";
import { renderExportCanvas } from "./raster";
import { nextMacrotask } from "./yield";

// What a pass "sees" of the loading pictures and fonts is scripted here: the real counters only move when a
// picture finishes loading, which cannot happen in the middle of a synchronous pass.
const epochs = vi.hoisted(() => ({ queue: [] as number[] }));

vi.mock("@/render/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/render/images")>();
  return { ...actual, imagesEpoch: vi.fn(() => (epochs.queue.length ? epochs.queue.shift()! : actual.imagesEpoch())) };
});
vi.mock("@/render/renderPage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/render/renderPage")>();
  return { ...actual, renderPage: vi.fn(actual.renderPage) };
});
vi.mock("./yield", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./yield")>();
  return { ...actual, nextMacrotask: vi.fn(actual.nextMacrotask) };
});

const small = { width: 100, height: 50 };
// 12 million pixels: three bands of 1000 rows
const large = { width: 4000, height: 3000 };
const page = () => createPage({ background: solid("#112233"), elements: [createShape("rect", { x: 5, y: 5, width: 20, height: 20 })] });

beforeEach(() => {
  epochs.queue = [];
});
afterEach(() => {
  // back to the real painter and the real timer calls
  vi.mocked(renderPage).mockReset();
  vi.mocked(nextMacrotask).mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("painting a page again when something finished loading while it was painted", () => {
  it("repeats a pass that came out incomplete when a picture arrived in the meantime, but only three times", async () => {
    vi.mocked(renderPage).mockReturnValue(false);
    epochs.queue = [1, 2, 2, 3, 4, 5];
    await renderExportCanvas(small, page(), { scale: 1 });
    expect(renderPage).toHaveBeenCalledTimes(3);
  });

  it("stops repeating as soon as a pass comes out complete", async () => {
    vi.mocked(renderPage).mockReturnValueOnce(false).mockReturnValueOnce(true);
    epochs.queue = [1, 2];
    await renderExportCanvas(small, page(), { scale: 1 });
    expect(renderPage).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a pass that is incomplete only because a picture will never load", async () => {
    vi.mocked(renderPage).mockReturnValue(false);
    epochs.queue = [7, 7];
    await renderExportCanvas(small, page(), { scale: 1 });
    expect(renderPage).toHaveBeenCalledTimes(1);
  });

  it("repeats a whole banded pass in the same way", async () => {
    vi.mocked(renderPage).mockReturnValue(false);
    epochs.queue = [1, 2, 2, 3, 4, 5];
    await renderExportCanvas(large, page(), { scale: 1 });
    // three bands per pass, three passes
    expect(renderPage).toHaveBeenCalledTimes(9);
  });

  it("does not repeat a banded pass that has nothing new to wait for", async () => {
    vi.mocked(renderPage).mockReturnValue(false);
    epochs.queue = [4, 4];
    await renderExportCanvas(large, page(), { scale: 1 });
    expect(renderPage).toHaveBeenCalledTimes(3);
  });
});

describe("handing the thread back between bands", () => {
  it("does so after every band once a band took longer than a slice", async () => {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (t += 30));
    await renderExportCanvas(large, page(), { scale: 1 });
    expect(nextMacrotask).toHaveBeenCalledTimes(3);
  });

  it("does not bother while the bands are quick", async () => {
    vi.spyOn(performance, "now").mockReturnValue(5);
    await renderExportCanvas(large, page(), { scale: 1 });
    expect(nextMacrotask).not.toHaveBeenCalled();
  });

  it("tells the time with the wall clock where there is no performance timer", async () => {
    vi.stubGlobal("performance", undefined);
    let t = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 30));
    const canvas = await renderExportCanvas(large, page(), { scale: 1 });
    expect([canvas.width, canvas.height]).toEqual([4000, 3000]);
    expect(nextMacrotask).toHaveBeenCalledTimes(3);
  });
});
