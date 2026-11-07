import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadImage } from "@/render/images";
import { contextOf } from "@/test/canvasMock";
import { PreviewCanvas } from "./PreviewCanvas";

const canvasOf = (container: HTMLElement) => container.querySelector("canvas") as HTMLCanvasElement;
const setRatio = (value: number) => Object.defineProperty(window, "devicePixelRatio", { value, configurable: true });

beforeEach(() => setRatio(1));
afterEach(() => {
  setRatio(1);
  vi.unstubAllGlobals();
});

describe("<PreviewCanvas>", () => {
  it("paints once, on a cleared canvas scaled to the device, and tells the painter its size", async () => {
    setRatio(2);
    const draw = vi.fn();
    const { container } = render(<PreviewCanvas width={80} height={40} draw={draw} deps={[]} className="tile" />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    const canvas = canvasOf(container);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 80, 40, 2);
    expect(canvas.width).toBe(160);
    expect(canvas.height).toBe(80);
    expect(canvas.className).toBe("tile");
    expect(canvas.style.width).toBe("80px");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    const names = contextOf(canvas)!.calls.map((c) => c.name);
    expect(names.slice(0, 3)).toEqual(["setTransform", "clearRect", "scale"]);
    expect(contextOf(canvas)!.callsTo("scale")[0]).toEqual([2, 2]);
  });

  it("caps the backing store at twice the CSS size and treats a missing ratio as 1", async () => {
    setRatio(3);
    const { container, unmount } = render(<PreviewCanvas width={50} height={50} draw={() => undefined} deps={[]} />);
    await waitFor(() => expect(canvasOf(container).width).toBe(100));
    unmount();
    setRatio(0);
    const second = render(<PreviewCanvas width={50} height={50} draw={() => undefined} deps={[]} />);
    await waitFor(() => expect(canvasOf(second.container).width).toBe(50));
  });

  it("repaints when a dependency changes and not for other renders", async () => {
    const draw = vi.fn();
    const { rerender } = render(<PreviewCanvas width={20} height={20} draw={draw} deps={["a"]} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    rerender(<PreviewCanvas width={20} height={20} draw={draw} deps={["a"]} className="other" />);
    await new Promise((r) => setTimeout(r, 60));
    expect(draw).toHaveBeenCalledTimes(1);
    rerender(<PreviewCanvas width={20} height={20} draw={draw} deps={["b"]} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(2));
  });

  it("always paints with the latest painter", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<PreviewCanvas width={20} height={20} draw={first} deps={["a"]} />);
    rerender(<PreviewCanvas width={20} height={20} draw={second} deps={["a"]} />);
    await waitFor(() => expect(first.mock.calls.length + second.mock.calls.length).toBeGreaterThan(0));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps trying while the painter says it is not ready, and stops once it is", async () => {
    let ready = false;
    const draw = vi.fn(() => (ready ? undefined : false));
    render(<PreviewCanvas width={20} height={20} draw={draw} deps={[]} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    // a picture arrives: the preview paints again
    ready = true;
    await act(async () => void (await loadImage("https://example.test/first.png")));
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(2));
    // finished: more pictures arriving do not repaint it
    await act(async () => void (await loadImage("https://example.test/second.png")));
    await new Promise((r) => setTimeout(r, 60));
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("stops listening for pictures when it goes away", async () => {
    const draw = vi.fn(() => false);
    const { unmount } = render(<PreviewCanvas width={20} height={20} draw={draw} deps={[]} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => void (await loadImage("https://example.test/third.png")));
    await new Promise((r) => setTimeout(r, 40));
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("does not paint a canvas that left the page before its turn came", async () => {
    const draw = vi.fn();
    const { unmount } = render(<PreviewCanvas width={20} height={20} draw={draw} deps={[]} />);
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(draw).not.toHaveBeenCalled();
  });

  it("survives a painter that throws and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const draw = vi.fn(() => {
      throw new Error("no paint today");
    });
    render(<PreviewCanvas width={20} height={20} draw={draw} deps={[]} />);
    await waitFor(() => expect(warn).toHaveBeenCalledWith("Preview could not be painted", expect.any(Error)));
  });

  it("paints nothing where a canvas has no 2D context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const draw = vi.fn();
    render(<PreviewCanvas width={20} height={20} draw={draw} deps={[]} />);
    await new Promise((r) => setTimeout(r, 60));
    expect(draw).not.toHaveBeenCalled();
  });

  it("spreads a long list of previews over several frames and still paints all of them", async () => {
    // the clock moves 5ms with every look at it, so a frame has time for one preview before its 9ms are used up
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 5));
    const draws = Array.from({ length: 4 }, () => vi.fn());
    render(
      <>
        {draws.map((draw, i) => (
          <PreviewCanvas key={i} width={20} height={20} draw={draw} deps={[]} />
        ))}
      </>,
    );
    await waitFor(() => expect(draws.every((d) => d.mock.calls.length === 1)).toBe(true));
  });
});

describe("<PreviewCanvas> in lazy mode", () => {
  type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
  const observers: Array<{ callback: Callback; disconnect: ReturnType<typeof vi.fn> }> = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        callback: Callback;
        disconnect = vi.fn();
        constructor(callback: Callback) {
          this.callback = callback;
          observers.push(this);
        }
        observe() {}
        unobserve() {}
      },
    );
  });

  it("waits until the canvas scrolls into view", async () => {
    const draw = vi.fn();
    render(<PreviewCanvas width={20} height={20} draw={draw} deps={[]} lazy />);
    await new Promise((r) => setTimeout(r, 60));
    expect(draw).not.toHaveBeenCalled();
    // a report that it is still out of view changes nothing
    act(() => observers[0].callback([{ isIntersecting: false }]));
    await new Promise((r) => setTimeout(r, 40));
    expect(draw).not.toHaveBeenCalled();
    act(() => observers[0].callback([{ isIntersecting: true }]));
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("paints at once in a browser without an intersection observer", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const draw = vi.fn();
    render(<PreviewCanvas width={20} height={20} draw={draw} deps={[]} lazy />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
  });
});

describe("<PreviewCanvas> in fluid mode", () => {
  let callbacks: Array<() => void>;
  let size = { width: 200, height: 100 };
  beforeEach(() => {
    callbacks = [];
    size = { width: 200, height: 100 };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: size.height, ...size, toJSON: () => ({}) }) as DOMRect,
    );
  });

  it("takes the size its container gives it and keeps up with changes of two pixels or more", async () => {
    const draw = vi.fn();
    const { container } = render(<PreviewCanvas width={96} height={96} fluid draw={draw} deps={[]} />);
    const canvas = canvasOf(container);
    expect(canvas.style.width).toBe("100%");
    act(() => callbacks[0]());
    await waitFor(() => expect(canvas.width).toBe(200));
    expect(canvas.height).toBe(100);
    expect(draw).toHaveBeenLastCalledWith(expect.anything(), 200, 100, 1);
    const painted = draw.mock.calls.length;
    // a pixel more is not worth a repaint
    size = { width: 201, height: 100 };
    act(() => callbacks[0]());
    await new Promise((r) => setTimeout(r, 60));
    expect(draw).toHaveBeenCalledTimes(painted);
    size = { width: 300, height: 150 };
    act(() => callbacks[0]());
    await waitFor(() => expect(canvas.width).toBe(300));
    // an element with no size yet (hidden) is ignored
    size = { width: 0, height: 0 };
    act(() => callbacks[0]());
    await new Promise((r) => setTimeout(r, 40));
    expect(canvas.width).toBe(300);
  });

  it("keeps its own size in a browser without a resize observer", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const draw = vi.fn();
    const { container } = render(<PreviewCanvas width={96} height={96} fluid draw={draw} deps={[]} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(canvasOf(container).width).toBe(96);
  });
});
