import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraphic, createImage, createPage, createText } from "@/core/factory";
import { getImage, getSvgImage, onImagesChange } from "@/render/images";
import { graphicMarkup } from "@/render/renderPage";
import { isCancelled } from "./errors";
import { breathe, loadPageResources } from "./resources";

let serial = 0;
const photo = () => createImage({ src: `blob:test/resource-${++serial}.png`, width: 50, height: 50, naturalWidth: 64, naturalHeight: 48 });
const logo = () => createGraphic({ svg: `<svg viewBox="0 0 10 10" data-n="${++serial}"><circle r="5" fill="#123456"/></svg>` });

describe("breathe", () => {
  it("carries on at once while the slice is not used up, answering the same start time", async () => {
    const since = performance.now();
    expect(await breathe(since, 10_000)).toBe(since);
  });

  it("hands the thread back after a long slice and starts a new one", async () => {
    const since = performance.now() - 1000;
    const next = await breathe(since, 24);
    expect(next).toBeGreaterThan(since + 900);
  });

  describe("where there is no performance timer", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("tells the time with the wall clock instead", async () => {
      vi.stubGlobal("performance", undefined);
      const quick = Date.now();
      expect(await breathe(quick, 10_000)).toBe(quick);
      const next = await breathe(Date.now() - 1000, 24);
      expect(next).toBeGreaterThan(Date.now() - 500);
    });
  });

  it("stops when the signal has been aborted, before and after waiting", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(breathe(performance.now(), 24, aborted.signal)).rejects.toSatisfy(isCancelled);

    const during = new AbortController();
    const promise = breathe(performance.now() - 1000, 24, during.signal);
    during.abort();
    await expect(promise).rejects.toSatisfy(isCancelled);
  });
});

describe("loadPageResources", () => {
  it("has the pictures, graphics and fonts of a page ready when it is done", async () => {
    const image = photo();
    const graphic = logo();
    const page = createPage({
      background: { type: "image", src: "blob:test/background-res.png", fit: "cover" },
      elements: [image, graphic, createText({ text: "words" })],
    });
    await loadPageResources(page);
    expect(getImage(image.src as string)).not.toBeNull();
    expect(getImage("blob:test/background-res.png")).not.toBeNull();
    expect(getSvgImage(graphicMarkup(graphic))).not.toBeNull();
  });

  it("is fine with a page that needs nothing", async () => {
    await expect(loadPageResources(createPage())).resolves.toBeUndefined();
  });

  it("does not stop for a picture that cannot be loaded", async () => {
    const page = createPage({ elements: [createImage({ src: "blob:test/broken-res.png", width: 10, height: 10 }), photo()] });
    await expect(loadPageResources(page)).resolves.toBeUndefined();
  });

  it("stops between two pictures when the export is cancelled", async () => {
    const controller = new AbortController();
    const elements = [photo(), photo(), photo()];
    const stop = onImagesChange(() => controller.abort());
    await expect(loadPageResources(createPage({ elements }), controller.signal)).rejects.toSatisfy(isCancelled);
    stop();
    // the first one finished, the rest were never asked for
    const loaded = elements.filter((e) => getImage(e.src as string) !== null);
    expect(loaded.length).toBeLessThan(elements.length);
  });

  it("stops after the first picture when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadPageResources(createPage({ elements: [photo(), photo()] }), controller.signal)).rejects.toSatisfy(isCancelled);
  });
});
