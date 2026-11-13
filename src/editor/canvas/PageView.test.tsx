/**
 * The page canvas: it paints the active page at the zoom and scroll position of the workspace, repaints when
 * anything it shows changes, hides the element that is being edited, plays previews and retries while pictures load.
 */
import { act, configure, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesign, createImage, createPage, createShape, createText } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { loadImage } from "@/render/images";
import { contextOf } from "@/test/canvasMock";
import { setMedia } from "@/test/media";
import { canvasDesign, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { startPreview, usePreview } from "./preview";
import { useView } from "./viewStore";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

const canvasOf = (rig: CanvasRig) => rig.container.querySelector<HTMLCanvasElement>("canvas.cf-pageview")!;
const ctxOf = (rig: CanvasRig) => contextOf(canvasOf(rig))!;
// (the recording context answers every property, `then` included: never resolve a promise with it)
const painted = async (rig: CanvasRig) => {
  await waitFor(() => expect(contextOf(canvasOf(rig))?.calls.length).toBeGreaterThan(0));
};
/** forget what was painted, run `change`, and wait for the next paint */
async function repaintAfter(rig: CanvasRig, change: () => void) {
  await painted(rig);
  ctxOf(rig).reset();
  act(change);
  await waitFor(() => expect(ctxOf(rig).calls.length).toBeGreaterThan(0));
}
const elementBox = (id: string) => {
  const el = useEditor.getState().design!.pages[0].elements.find((e) => e.id === id)!;
  return [el.x, el.y];
};
const words = (ctx: ReturnType<typeof ctxOf>) => ctx.callsTo("fillText").map((c) => String(c[0]));

const hello = () => createText({ id: "t", text: "Hello", x: 100, y: 100, width: 300, fontSize: 40 });
const photo = (src = "blob:test/ok.jpg") => createImage({ id: "img", src, x: 400, y: 300, width: 200, height: 150, naturalWidth: 400, naturalHeight: 300 });

afterEach(() => {
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true, writable: true });
});

describe("painting the page", () => {
  it("fills the canvas to the size of the workspace and paints the page with its text", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await painted(rig);
    const ctx = ctxOf(rig);
    const canvas = canvasOf(rig);
    expect([canvas.width, canvas.height]).toEqual([1000, 700]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["1000px", "700px"]);
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(words(ctx)).toContain("Hello"));
    expect(ctx.callsTo("fillRect").length).toBeGreaterThan(0);
  });

  it("places the page where the workspace shows it, at the current zoom", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await painted(rig);
    const ctx = ctxOf(rig);
    // zoom 100 %, scrolled to the corner: the page starts 72 px from the left and 48 px from the top
    // (the first paint may come before the workspace has taken the scroll to the corner in; the paint for it follows a frame later)
    await waitFor(() => expect(ctx.callsTo("setTransform")).toContainEqual([1, 0, 0, 1, 72, 48]));
    await repaintAfter(rig, () => getActions().setZoom(2));
    const zoomed = ctxOf(rig);
    const v = useView.getState();
    expect(zoomed.callsTo("setTransform")).toContainEqual([2, 0, 0, 2, -((v.scrollLeft - v.pageLeft) / 2) * 2, -((v.scrollTop - v.pageTop) / 2) * 2]);
  });

  it("paints at the device pixel ratio", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true, writable: true });
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await painted(rig);
    const ctx = ctxOf(rig);
    const canvas = canvasOf(rig);
    expect([canvas.width, canvas.height]).toEqual([2000, 1400]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["1000px", "700px"]);
    expect(ctx.callsTo("setTransform")).toContainEqual([2, 0, 0, 2, 144, 96]);
  });

  it("assumes one device pixel per pixel when the browser reports no ratio", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 0, configurable: true, writable: true });
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await painted(rig);
    expect([canvasOf(rig).width, canvasOf(rig).height]).toEqual([1000, 700]);
  });

  it("paints nothing without an open design", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await painted(rig);
    const ctx = ctxOf(rig);
    ctx.reset();
    act(() => getActions().closeDesign());
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(ctx.calls).toHaveLength(0);
  });

  it("copes with a canvas that has no 2D context", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await painted(rig);
    const before = ctxOf(rig);
    before.reset();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    act(() => getActions().setZoom(1.5));
    await waitFor(() => expect(getContext).toHaveBeenCalled());
    // the page is simply not painted: nothing was drawn and nothing broke
    expect(before.calls).toHaveLength(0);
    expect(canvasOf(rig).width).toBe(1000);
  });
});

describe("repainting", () => {
  it("repaints when the document changes", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await repaintAfter(rig, () => getActions().setTextProps(["t"], { color: "#ff0000" }));
    const ctx = ctxOf(rig);
    expect(words(ctx)).toContain("Hello");
  });

  it("repaints when the view scrolls", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await repaintAfter(rig, () => useView.getState().set({ scrollLeft: 40 }));
  });

  it("repaints when the screen's pixel density changes", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await repaintAfter(rig, () => setMedia("(resolution: 1dppx)", true));
  });

  it("shows the other page after the active page changes", async () => {
    const design = createDesign({
      title: "Two pages",
      width: 856,
      height: 604,
      pages: [
        createPage({ id: "p1", elements: [hello()] }),
        createPage({ id: "p2", elements: [createText({ id: "t2", text: "Second", x: 50, y: 50, width: 300, fontSize: 40 })] }),
      ],
    });
    const rig = await mountWorkspace(design);
    await repaintAfter(rig, () => getActions().setActivePage("p2"));
    const ctx = ctxOf(rig);
    await waitFor(() => expect(words(ctx)).toContain("Second"));
    expect(words(ctx)).not.toContain("Hello");
  });

  it("stops painting after the workspace is closed", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    await painted(rig);
    const ctx = ctxOf(rig);
    rig.unmount();
    ctx.reset();
    act(() => getActions().setZoom(2));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("the element being edited", () => {
  it("leaves out the text that is being typed into, and brings it back afterwards", async () => {
    const rig = await mountWorkspace(canvasDesign([hello(), createText({ id: "other", text: "Stays", x: 100, y: 300, width: 300, fontSize: 40 })]));
    await waitFor(() => expect(words(ctxOf(rig))).toContain("Hello"));
    await repaintAfter(rig, () => getActions().startTextEdit("t"));
    const editing = ctxOf(rig);
    expect(words(editing)).toContain("Stays");
    expect(words(editing)).not.toContain("Hello");
    await repaintAfter(rig, () => getActions().endTextEdit());
    const after = ctxOf(rig);
    expect(words(after)).toContain("Hello");
  });

  it("leaves out the picture that is being cropped", async () => {
    const rig = await mountWorkspace(canvasDesign([photo()]));
    await painted(rig);
    const ctx = ctxOf(rig);
    await waitFor(() => expect(ctx.callsTo("drawImage").length).toBeGreaterThan(0));
    await repaintAfter(rig, () => getActions().startCrop("img"));
    const cropping = ctxOf(rig);
    expect(cropping.callsTo("drawImage")).toHaveLength(0);
    await repaintAfter(rig, () => getActions().endCrop());
    const after = ctxOf(rig);
    expect(after.callsTo("drawImage").length).toBeGreaterThan(0);
  });
});

describe("pictures that are not ready", () => {
  it("repaints once a picture has loaded", async () => {
    const rig = await mountWorkspace(canvasDesign([photo()]));
    await painted(rig);
    const ctx = ctxOf(rig);
    await waitFor(() => expect(ctx.callsTo("drawImage").length).toBeGreaterThan(0));
  });

  it("keeps trying every quarter second while a picture is missing", async () => {
    const rig = await mountWorkspace(canvasDesign([photo("blob:test/broken.jpg")]));
    await painted(rig);
    const ctx = ctxOf(rig);
    await waitFor(() => expect(ctx.callsTo("fillRect").length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 60));
    ctx.reset();
    // nothing in the document changed, yet the page is painted again by the safety net
    await waitFor(() => expect(ctx.callsTo("fillRect").length).toBeGreaterThan(0), { timeout: 4000 });
  });

  it("cancels the retry when the workspace is closed", async () => {
    const rig = await mountWorkspace(canvasDesign([photo("blob:test/broken.jpg")]));
    await painted(rig);
    const ctx = ctxOf(rig);
    rig.unmount();
    ctx.reset();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("while something is dragged", () => {
  /** thirteen squares that stay where they are, and a box on top of them to drag */
  const crowded = () => [
    ...Array.from({ length: 13 }, (_, i) => createShape("rect", { id: `still${i}`, x: 20 + i * 30, y: 40, width: 20, height: 20 })),
    createShape("rect", { id: "box", x: 500, y: 300, width: 100, height: 100 }),
  ];
  /** presses on the box and moves far enough for the drag to begin, and waits for a frame that was put together from a kept picture */
  async function beginDrag(rig: CanvasRig) {
    await waitFor(() => expect(ctxOf(rig).callsTo("fill")).toHaveLength(14));
    act(() => {
      rig.down(550, 350);
      rig.move(560, 350);
    });
    await waitFor(() => expect(ctxOf(rig).callsTo("drawImage").length).toBeGreaterThan(0));
  }

  it("paints only what moves over a kept picture of the rest, and the whole page again when the drag ends", async () => {
    const rig = await mountWorkspace(canvasDesign(crowded()));
    await beginDrag(rig);
    const ctx = ctxOf(rig);
    ctx.reset();
    act(() => void rig.move(580, 360));
    await waitFor(() => expect(ctx.callsTo("fill").length).toBeGreaterThan(0));
    // the thirteen squares come from the picture that was kept: one drawImage, one fill for the box
    expect(ctx.callsTo("fill")).toHaveLength(1);
    expect(ctx.callsTo("drawImage")).toHaveLength(1);
    const kept = ctx.callsTo("drawImage")[0][0] as HTMLCanvasElement;
    expect([kept.width, kept.height]).toEqual([1000, 700]);

    ctx.reset();
    act(() => void rig.up(580, 360));
    await waitFor(() => expect(ctx.callsTo("fill")).toHaveLength(14));
    expect(ctx.callsTo("drawImage")).toHaveLength(0);
    // the kept picture is let go, and the drag is one step of the history as before
    expect(kept.width).toBe(0);
    expect(useEditor.getState().past).toHaveLength(1);
    expect(elementBox("box")).toEqual([530, 310]);
  });

  it("paints the kept picture again when a picture arrives in the middle of the drag", async () => {
    const rig = await mountWorkspace(canvasDesign(crowded()));
    await beginDrag(rig);
    const ctx = ctxOf(rig);
    const kept = contextOf(ctx.callsTo("drawImage")[0][0] as HTMLCanvasElement)!;
    kept.reset();
    act(() => void rig.move(580, 360));
    await waitFor(() => expect(ctx.callsTo("drawImage").length).toBeGreaterThan(1));
    expect(kept.calls).toHaveLength(0);
    void loadImage("blob:test/arrives-during-a-drag.png");
    await waitFor(() => expect(kept.callsTo("fill")).toHaveLength(13));
  });

  it("lets the kept picture go when the workspace is closed in the middle of the drag", async () => {
    const rig = await mountWorkspace(canvasDesign(crowded()));
    await beginDrag(rig);
    const ctx = ctxOf(rig);
    const kept = ctx.callsTo("drawImage")[0][0] as HTMLCanvasElement;
    rig.unmount();
    expect(kept.width).toBe(0);
  });

  it("paints nothing again after a click", async () => {
    const rig = await mountWorkspace(canvasDesign(crowded()));
    await waitFor(() => expect(ctxOf(rig).callsTo("fill")).toHaveLength(14));
    const ctx = ctxOf(rig);
    await new Promise((resolve) => setTimeout(resolve, 40));
    ctx.reset();
    act(() => {
      rig.down(550, 350);
      rig.up(550, 350);
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("previews", () => {
  /** performance.now() that can be pushed forward, so a preview can "run" for seconds in a moment */
  function clock() {
    const real = performance.now.bind(performance);
    let offset = 0;
    vi.spyOn(performance, "now").mockImplementation(() => real() + offset);
    return (ms: number) => void (offset += ms);
  }

  it("keeps painting frames while a preview plays, and stops itself at the end", async () => {
    const advance = clock();
    const animated = createShape("rect", { id: "a", x: 100, y: 100, width: 100, height: 100, animation: { in: { kind: "fade", duration: 1, delay: 0 } } });
    const rig = await mountWorkspace(canvasDesign([animated]));
    await painted(rig);
    const ctx = ctxOf(rig);
    ctx.reset();
    act(() => startPreview(0, 1));
    await waitFor(() => expect(ctx.callsTo("clearRect").length).toBeGreaterThan(2));
    expect(usePreview.getState().preview).not.toBeNull();
    advance(5000);
    await waitFor(() => expect(usePreview.getState().preview).toBeNull());
  });

  it("is dropped when another page becomes active", async () => {
    const design = createDesign({ title: "Two pages", width: 856, height: 604, pages: [createPage({ id: "p1", elements: [hello()] }), createPage({ id: "p2" })] });
    const rig = await mountWorkspace(design);
    await painted(rig);
    act(() => startPreview(0, 30));
    expect(usePreview.getState().preview).not.toBeNull();
    act(() => getActions().setActivePage("p2"));
    expect(usePreview.getState().preview).toBeNull();
  });

  it("marks the workspace while a preview is running", async () => {
    const rig = await mountWorkspace(canvasDesign([hello()]));
    expect(rig.host.className).not.toContain("is-previewing");
    act(() => startPreview(0, 30));
    expect(rig.host.className).toContain("is-previewing");
    act(() => usePreview.setState({ preview: null }));
    expect(rig.host.className).not.toContain("is-previewing");
  });
});
