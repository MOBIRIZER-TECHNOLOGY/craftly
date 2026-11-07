/**
 * The scrolling surface around the page: measuring the available space, laying the page out (fit, zoom, keeping the
 * view centred), following native scrolling and mounting the overlays and whatever floats on top.
 */
import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShape } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { canvasDesign, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { startPreview } from "./preview";
import { screenToDesign, useView } from "./viewStore";

const state = () => useEditor.getState();
const rect = (width: number, height: number) => ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The design point shown in the middle of the workspace. */
const centre = (rig: CanvasRig) => screenToDesign({ ...useView.getState(), scrollLeft: rig.scroller.scrollLeft, scrollTop: rig.scroller.scrollTop }, 500, 350);

describe("laying out the page", () => {
  it("fits the page in the workspace and centres it on a paper sheet", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(state().viewport).toEqual({ w: 1000, h: 700 });
    expect(state().zoom).toBe(1);
    const content = rig.container.querySelector<HTMLElement>(".cf-workspace__content")!;
    expect([content.style.width, content.style.height]).toEqual(["1000px", "700px"]);
    const paper = rig.container.querySelector<HTMLElement>(".cf-paper")!;
    expect([paper.style.left, paper.style.top, paper.style.width, paper.style.height]).toEqual(["72px", "48px", "856px", "604px"]);
    const frame = rig.container.querySelector<HTMLElement>(".cf-pageframe")!;
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(["72px", "48px", "856px", "604px"]);
    expect(useView.getState()).toMatchObject({ pageLeft: 72, pageTop: 48, pageW: 856, pageH: 604, zoom: 1, width: 1000, height: 700 });
  });

  it("makes the scrollable area larger than the workspace when the page is zoomed in", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => getActions().setZoom(2));
    const content = rig.container.querySelector<HTMLElement>(".cf-workspace__content")!;
    expect([content.style.width, content.style.height]).toEqual(["1856px", "1304px"]);
    const paper = rig.container.querySelector<HTMLElement>(".cf-paper")!;
    expect([paper.style.width, paper.style.height]).toEqual(["1712px", "1208px"]);
  });

  it("keeps the middle of the view where it was when the zoom changes", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const before = centre(rig);
    act(() => getActions().setZoom(3));
    const after = centre(rig);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    act(() => getActions().setZoom(0.5));
    expect(centre(rig).x).toBeCloseTo(before.x, 6);
  });

  it("re-fits the page when the workspace is resized", async () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(() => callback([], this as unknown as ResizeObserver));
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const rig = await mountWorkspace(canvasDesign());
    expect(state().zoom).toBe(1);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(800, 500));
    act(() => observers.forEach((notify) => notify()));
    expect(state().viewport).toEqual({ w: 800, h: 500 });
    expect(state().zoom).toBeCloseTo((500 - 96) / 604, 6);
    expect(useView.getState()).toMatchObject({ width: 800, height: 500 });
    expect(rig.container.querySelector(".cf-workspace")).toBeTruthy();
  });

  it("leaves the scroll position alone when only the size of the workspace changes", async () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(() => callback([], this as unknown as ResizeObserver));
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const rig = await mountWorkspace(canvasDesign());
    act(() => getActions().setZoom(2));
    rig.scroller.scrollLeft = 150;
    rig.scroller.scrollTop = 90;
    fireEvent.scroll(rig.scroller);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(900, 600));
    act(() => observers.forEach((notify) => notify()));
    expect(state().viewport).toEqual({ w: 900, h: 600 });
    expect(state().zoom).toBe(2);
    expect([rig.scroller.scrollLeft, rig.scroller.scrollTop]).toEqual([150, 90]);
    expect(useView.getState()).toMatchObject({ width: 900, height: 600, scrollLeft: 150, scrollTop: 90 });
  });

  it("lays the page out again when the design gets another size", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 100 })]));
    act(() => getActions().resizeDesign(428, 302, false));
    expect(state().zoom).toBeCloseTo(2, 6);
    expect(useView.getState().pageW).toBeCloseTo(856);
    expect(rig.container.querySelector<HTMLElement>(".cf-paper")!.style.width).toBe("856px");
  });

  it("keeps its layout when the design is closed", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => getActions().closeDesign());
    expect(useView.getState().pageW).toBe(856);
    expect(rig.container.querySelector(".cf-workspace")).toBeTruthy();
  });
});

describe("scrolling", () => {
  it("tells the view store where the workspace has been scrolled to", async () => {
    const rig = await mountWorkspace(canvasDesign());
    rig.scroller.scrollLeft = 120;
    rig.scroller.scrollTop = 45;
    fireEvent.scroll(rig.scroller);
    expect(useView.getState()).toMatchObject({ scrollLeft: 120, scrollTop: 45 });
  });

  it("stops listening when it is removed", async () => {
    const rig = await mountWorkspace(canvasDesign());
    rig.unmount();
    rig.scroller.scrollLeft = 300;
    fireEvent.scroll(rig.scroller);
    expect(useView.getState().scrollLeft).toBe(0);
  });
});

describe("what it hosts", () => {
  it("draws whatever is put inside it on top of the page", async () => {
    const rig = await mountWorkspace(canvasDesign(), <button type="button">Floating tool</button>);
    const button = rig.getByRole("button", { name: "Floating tool" });
    expect(button.parentElement).toBe(rig.host);
  });

  it("is one named stop in the tab order, so that the keyboard can reach the canvas and walk its elements", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(rig.host.tabIndex).toBe(0);
    expect(rig.host.hasAttribute("data-cf-workspace")).toBe(true);
    expect(rig.getByRole("group", { name: "Design canvas" })).toBe(rig.host);
    const hint = document.getElementById(rig.host.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toMatch(/Tab moves between the elements/);
  });

  it("shows the cursor of the active tool and marks a running preview", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(rig.host.className).toBe("cf-workspace");
    act(() => getActions().setTool("draw"));
    expect(rig.host.className).toContain("cf-workspace--tool-draw");
    act(() => getActions().setTool("select"));
    expect(rig.host.className).not.toContain("cf-workspace--tool");
    act(() => startPreview(0, 3));
    expect(rig.host.className).toContain("is-previewing");
  });
});
