/**
 * Transitions on the timeline: the button over each join between pages, and the page area showing a transition while the playhead
 * is inside it.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** the page area listens for pictures that arrive: the listeners are kept here, to call them */
const arrivals = vi.hoisted(() => new Set<() => void>());
vi.mock(import("@/render/images"), async (original) => ({
  ...(await original()),
  onImagesChange: (cb: () => void) => {
    arrivals.add(cb);
    return () => arrivals.delete(cb);
  },
}));
import { createDesign, createPage } from "@/core/factory";
import { useEditor } from "@/core/store";
import { stopPreview } from "@/editor/canvas/preview";
import { PlaybackRenderer } from "@/render/playback";
import { renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { Timeline } from "./Timeline";
import { TransitionOverlay } from "./TransitionOverlay";
import { resetTimeline, seekTimeline, setTimelineOpen, useTimeline } from "./timelineStore";

/** three pages of 2 s; a slide of 1 s into the second, a cut into the third */
const design = () =>
  createDesign({
    title: "Transitions",
    width: 400,
    height: 300,
    pages: [
      createPage({ id: "p1", duration: 2 }),
      createPage({ id: "p2", duration: 2, transition: { kind: "slide", duration: 1, direction: "left" } }),
      createPage({ id: "p3", duration: 2 }),
    ],
  });

beforeEach(async () => {
  resetEditor();
  resetTimeline();
  await clearLibrary();
});

afterEach(() => {
  resetTimeline();
  stopPreview();
  resetEditor();
  vi.restoreAllMocks();
});

describe("the joins between pages", () => {
  it("name the transition into a page, or offer one; the first page has none", async () => {
    const { container } = await renderChrome(<Timeline />, design());
    expect(container.querySelectorAll(".cf-tl__join")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Transition into page 2: Slide, 1.0 s" }).className).toContain("has-transition");
    expect(screen.getByRole("button", { name: "Add a transition into page 3" })).toBeTruthy();
  });

  it("put the playhead in the middle of the transition and open the page's transition in the Animate panel", async () => {
    await renderChrome(<Timeline />, design());
    fireEvent.click(screen.getByRole("button", { name: "Transition into page 2: Slide, 1.0 s" }));
    expect(useTimeline.getState().time).toBe(2.5);
    expect(useEditor.getState().activePageId).toBe("p2");
    expect(useEditor.getState().context).toEqual({ kind: "animate", tab: "page" });
    // a join without one: the playhead goes to the start of the page
    fireEvent.click(screen.getByRole("button", { name: "Add a transition into page 3" }));
    expect(useTimeline.getState().time).toBe(5);
    expect(useEditor.getState().activePageId).toBe("p3");
  });

  it("show only the transitions to one who may only look, and open no panel for them", async () => {
    await renderChrome(<Timeline />, design());
    act(() => useEditor.getState().actions.setMode("view"));
    expect(screen.queryByRole("button", { name: /Add a transition/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transition into page 2: Slide, 1.0 s" }));
    expect(useTimeline.getState().time).toBe(2.5);
    expect(useEditor.getState().context).toBeNull();
  });

  it("follow a transition chosen in the panel", async () => {
    await renderChrome(<Timeline />, design());
    act(() => {
      useEditor.getState().actions.setActivePage("p3");
      useEditor.getState().actions.setPageTransition({ kind: "dissolve", duration: 0.5 });
    });
    expect(screen.getByRole("button", { name: "Transition into page 3: Dissolve, 0.5 s" })).toBeTruthy();
  });
});

describe("the page area during a transition", () => {
  const mount = async () => {
    await renderChrome(<div />, design());
    return render(<TransitionOverlay left={10} top={20} width={400} height={300} />);
  };

  it("shows nothing while the timeline is closed or the playhead is on a page", async () => {
    const view = await mount();
    act(() => seekTimeline(2.5));
    expect(view.container.querySelector("canvas")).toBeNull();
    act(() => {
      setTimelineOpen(true);
      seekTimeline(1);
    });
    expect(view.container.querySelector("canvas")).toBeNull();
  });

  it("paints the transition at the playhead's moment over the page, where the page is, letting the pointer through", async () => {
    const renderAt = vi.spyOn(PlaybackRenderer.prototype, "renderAt").mockReturnValue(true);
    const view = await mount();
    act(() => {
      setTimelineOpen(true);
      seekTimeline(2.5);
    });
    const canvas = view.container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.className).toBe("cf-tl-overlay");
    expect(canvas.style.left).toBe("10px");
    expect(canvas.style.width).toBe("400px");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(renderAt).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ total: 7 }), 2.5);
    act(() => seekTimeline(2.8));
    expect(renderAt).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 2.8);
    // past the transition, it goes
    act(() => seekTimeline(3.5));
    expect(view.container.querySelector("canvas")).toBeNull();
  });

  it("paints again when a picture or a font arrives", async () => {
    const renderAt = vi.spyOn(PlaybackRenderer.prototype, "renderAt").mockReturnValue(false);
    await mount();
    act(() => {
      setTimelineOpen(true);
      seekTimeline(2.5);
    });
    const before = renderAt.mock.calls.length;
    expect(arrivals.size).toBe(1);
    act(() => arrivals.forEach((cb) => cb()));
    expect(renderAt.mock.calls.length).toBe(before + 1);
    // once the playhead leaves the transition, it no longer listens
    act(() => seekTimeline(4));
    expect(arrivals.size).toBe(0);
  });
});
