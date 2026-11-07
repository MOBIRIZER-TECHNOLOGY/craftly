import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, createText, solid } from "@/core/factory";
import type { Template } from "@/core/types";
import * as fonts from "@/render/fonts";
import * as renderPage from "@/render/renderPage";
import { contextOf } from "@/test/canvasMock";
import { settle } from "@/test/dashuiUtils";
import { PageThumb, TemplateThumb } from "./PageThumb";

const design = createDesign({
  width: 1280,
  height: 720,
  pages: [createPage({ background: solid("#ffffff"), elements: [createText({ text: "Hello", x: 40, y: 40 }), createShape("rect", { x: 100, y: 200, width: 300, height: 200 })] })],
});
const page = design.pages[0];
const otherPage = createPage({ background: solid("#000000"), elements: [createText({ text: "Other", x: 10, y: 10 })] });

const canvasOf = (container: HTMLElement) => container.querySelector("canvas") as HTMLCanvasElement;
const hostOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const paints = (container: HTMLElement) => contextOf(canvasOf(container))?.callsTo("drawImage").length ?? 0;

/** An IntersectionObserver the test fires by hand, to control when a thumbnail counts as visible. */
class ManualObserver {
  static instances: ManualObserver[] = [];
  disconnected = false;
  observed: Element[] = [];
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    ManualObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function setPixelRatio(value: number | undefined) {
  if (value === undefined) delete (window as unknown as { devicePixelRatio?: number }).devicePixelRatio;
  else Object.defineProperty(window, "devicePixelRatio", { value, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  ManualObserver.instances = [];
  setPixelRatio(undefined);
});

describe("<PageThumb>", () => {
  it("keeps the aspect ratio of the design and shows the placeholder colour until painted", () => {
    vi.stubGlobal("IntersectionObserver", ManualObserver);
    const { container } = render(<PageThumb design={design} page={page} width={200} className="thumb" />);
    const host = hostOf(container);
    expect(host.style.width).toBe("200px");
    expect(host.style.height).toBe("113px");
    expect(host.className).toBe("thumb");
    const reference = document.createElement("div");
    reference.style.background = "#eceef3";
    expect(host.style.background).toBe(reference.style.background);
  });

  it("uses the placeholder colour it is given", () => {
    vi.stubGlobal("IntersectionObserver", ManualObserver);
    const { container } = render(<PageThumb design={design} page={page} width={200} placeholder="#ff8800" />);
    const reference = document.createElement("div");
    reference.style.background = "#ff8800";
    expect(hostOf(container).style.background).toBe(reference.style.background);
  });

  it("waits until it scrolls into view (with a margin around the screen) before painting", async () => {
    vi.stubGlobal("IntersectionObserver", ManualObserver);
    const { container } = render(<PageThumb design={design} page={page} width={200} />);
    await settle();
    expect(paints(container)).toBe(0);
    const observer = ManualObserver.instances[0];
    expect(observer.observed).toEqual([hostOf(container)]);
    expect(observer.options?.rootMargin).toBe("240px");
    act(() => observer.fire(false));
    await settle();
    expect(paints(container)).toBe(0);
    act(() => observer.fire(true));
    await settle();
    expect(paints(container)).toBe(1);
  });

  it("paints at once where the browser cannot tell what is visible", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(<PageThumb design={design} page={page} width={200} />);
    await settle();
    expect(paints(container)).toBe(1);
  });

  it("stops watching when it goes away", () => {
    vi.stubGlobal("IntersectionObserver", ManualObserver);
    const { unmount } = render(<PageThumb design={design} page={page} width={200} />);
    unmount();
    expect(ManualObserver.instances[0].disconnected).toBe(true);
  });

  it("paints the page through the real renderer at the size it is shown", async () => {
    const { container } = render(<PageThumb design={design} page={page} width={200} sharp={false} />);
    await settle();
    const ctx = contextOf(canvasOf(container));
    expect(canvasOf(container).width).toBe(200);
    expect(canvasOf(container).height).toBe(113);
    expect(paints(container)).toBe(1);
    expect(ctx?.callsTo("drawImage")[0][1]).toBe(0);
  });

  describe("sharpness", () => {
    it("paints at the screen's pixel ratio, up to two times", async () => {
      setPixelRatio(2);
      const { container, unmount } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      expect(canvasOf(container).width).toBe(400);
      unmount();
      setPixelRatio(3);
      const second = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      expect(canvasOf(second.container).width).toBe(400);
    });

    it("stays at the shown size with sharp off", async () => {
      setPixelRatio(2);
      const { container } = render(<PageThumb design={design} page={page} width={200} sharp={false} />);
      await settle();
      expect(canvasOf(container).width).toBe(200);
    });

    it("never paints more than 900 pixels across", async () => {
      setPixelRatio(2);
      const { container } = render(<PageThumb design={design} page={page} width={700} />);
      await settle();
      expect(canvasOf(container).width).toBe(900);
    });

    it("treats a missing pixel ratio as one", async () => {
      setPixelRatio(0);
      const { container } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      expect(canvasOf(container).width).toBe(200);
    });
  });

  describe("repainting", () => {
    it("paints again when the page changes or the thumbnail is resized", async () => {
      const { container, rerender } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      expect(paints(container)).toBe(1);
      rerender(<PageThumb design={design} page={otherPage} width={200} />);
      await settle();
      expect(paints(container)).toBe(2);
      rerender(<PageThumb design={design} page={otherPage} width={260} />);
      await settle();
      expect(paints(container)).toBe(3);
    });

    it("does not paint again when nothing it shows has changed", async () => {
      const { container, rerender } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      rerender(<PageThumb design={{ ...design, title: "Renamed" } as typeof design} page={page} width={200} className="same-size" />);
      await settle();
      expect(paints(container)).toBe(1);
    });

    it("paints again when the design's size changes", async () => {
      const { container, rerender } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      rerender(<PageThumb design={{ width: 1080, height: 1080 }} page={page} width={200} />);
      await settle();
      expect(paints(container)).toBe(2);
      expect(hostOf(container).style.height).toBe("200px");
    });

    it("paints again when a font finishes loading, and stops listening when it goes away", async () => {
      let fontsLoaded: () => void = () => undefined;
      const unsubscribe = vi.fn();
      vi.spyOn(fonts, "onFontsChange").mockImplementation((callback) => {
        fontsLoaded = callback;
        return unsubscribe;
      });
      const { container, unmount } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      expect(paints(container)).toBe(1);
      act(() => fontsLoaded());
      await settle();
      expect(paints(container)).toBe(2);
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the renderer is slow or fails", () => {
    it("keeps the placeholder for a page that cannot be drawn", async () => {
      vi.spyOn(renderPage, "renderPageToCanvas").mockRejectedValue(new Error("no pixels today"));
      const { container } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      expect(paints(container)).toBe(0);
      expect(canvasOf(container)).toBeTruthy();
    });

    it("ignores a picture that arrives after the thumbnail went away or moved on", async () => {
      const resolvers: Array<(canvas: HTMLCanvasElement) => void> = [];
      vi.spyOn(renderPage, "renderPageToCanvas").mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
      const { container, rerender, unmount } = render(<PageThumb design={design} page={page} width={200} />);
      await settle();
      rerender(<PageThumb design={design} page={otherPage} width={200} />);
      await settle();
      expect(resolvers).toHaveLength(2);
      const stale = document.createElement("canvas");
      stale.width = 111;
      stale.height = 62;
      const fresh = document.createElement("canvas");
      fresh.width = 222;
      fresh.height = 125;
      await act(async () => resolvers[0](stale));
      expect(canvasOf(container).width).not.toBe(111);
      await act(async () => resolvers[1](fresh));
      expect(canvasOf(container).width).toBe(222);
      expect(paints(container)).toBe(1);
      const canvas = canvasOf(container);
      rerender(<PageThumb design={design} page={page} width={200} />);
      await settle();
      unmount();
      await act(async () => resolvers[2](stale));
      expect(canvas.width).toBe(222);
    });
  });
});

describe("<TemplateThumb>", () => {
  const template: Template = {
    id: "t-1",
    name: "Sunny",
    category: "social",
    typeId: "instagram-post",
    width: 1080,
    height: 1350,
    tags: [],
    accent: "#ff8800",
    pages: [page, otherPage],
  };

  it("paints the first page of the template on its accent colour", async () => {
    vi.stubGlobal("IntersectionObserver", ManualObserver);
    const spy = vi.spyOn(renderPage, "renderPageToCanvas");
    const { container } = render(<TemplateThumb template={template} width={160} className="tpl" />);
    const host = hostOf(container);
    const reference = document.createElement("div");
    reference.style.background = "#ff8800";
    expect(host.style.background).toBe(reference.style.background);
    expect(host.style.width).toBe("160px");
    expect(host.style.height).toBe("200px");
    expect(host.className).toBe("tpl");
    act(() => ManualObserver.instances[0].fire(true));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(template);
    expect(spy.mock.calls[0][1]).toBe(page);
  });
});
