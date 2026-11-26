/**
 * A clip's row on the timeline: where its bar is, what dragging or the keys do to its ends and its middle, and Split.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createGroup, createPage, createShape, createVideo } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { VideoElement } from "@/core/types";
import { stopPreview } from "@/editor/canvas/preview";
import { renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { MAX_ROWS, clipLanes, clipRows, clipSpan, dragClip, pageClips } from "./ClipBar";
import { clearClipFrames, tileMoments } from "./clipFrames";
import { Timeline } from "./Timeline";
import { resetTimeline, seekTimeline } from "./timelineStore";

const video = (id: string, over: Partial<VideoElement> = {}): VideoElement => ({
  ...createVideo({ id, src: "asset:a_clip", naturalWidth: 320, naturalHeight: 180, duration: 4 }),
  name: id,
  ...over,
});
const design = () =>
  createDesign({
    title: "Clips",
    width: 400,
    height: 300,
    pages: [
      createPage({ id: "p1", duration: 5, elements: [video("one", { trimEnd: 2, once: true, startAt: 1 }), video("two", { trimEnd: 2 })] }),
      createPage({ id: "p2", duration: 2 }),
    ],
  });
const clipNow = (id: string) => pageClips(useEditor.getState().design!.pages[0]).find((c) => c.id === id)!;
const bars = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".cf-tl__clip")];

beforeEach(async () => {
  resetEditor();
  resetTimeline();
  clearClipFrames();
  await clearLibrary();
});

afterEach(() => {
  resetTimeline();
  stopPreview();
  resetEditor();
});

describe("the maths of a clip's row", () => {
  it("lists a page's clips in paint order, groups and all, but not hidden ones", () => {
    const page = createPage({ elements: [video("a"), createGroup([createShape("rect"), video("b")]), video("c", { hidden: true })] });
    expect(pageClips(page).map((c) => c.id)).toEqual(["a", "b"]);
    expect(clipRows([page, createPage({})])).toBe(2);
    expect(clipRows([createPage({})])).toBe(0);
    expect(clipRows([createPage({ elements: [video("1"), video("2"), video("3"), video("4")] })])).toBe(MAX_ROWS);
  });

  it("gives the span of a clip on its page: once, over and over to the page's end, past the end cut off", () => {
    expect(clipSpan(video("a", { trimEnd: 2, once: true, startAt: 1 }), 5)).toEqual({ start: 1, end: 3 });
    expect(clipSpan(video("a", { trimEnd: 2, startAt: 1 }), 5)).toEqual({ start: 1, end: 5 });
    expect(clipSpan(video("a", { trimEnd: 4, speed: 2, once: true }), 5)).toEqual({ start: 0, end: 2 });
    expect(clipSpan(video("a", { once: true, startAt: 4 }), 5)).toEqual({ start: 4, end: 5 });
    expect(clipSpan(video("a", { once: true, startAt: 7 }), 5)).toEqual({ start: 5, end: 5 });
  });

  it("puts clips that play one after another on one row, and clips that play at once on rows of their own", () => {
    const once = (id: string, startAt: number, trimEnd = 1) => video(id, { trimEnd, once: true, startAt });
    // a 0-1, b 1-2 (just after a), c 0.5-1.5 (over both): a and b share the first row, c has the second
    const page = createPage({ elements: [once("c", 0.5), once("b", 1), once("a", 0)] });
    expect(clipLanes(page, 5)).toEqual({ rows: 2, row: { a: 0, c: 1, b: 0 } });
    // one after another, all on the first row, whatever their paint order
    expect(clipLanes(createPage({ elements: [once("x", 2), once("y", 0), once("z", 1)] }), 5)).toEqual({ rows: 1, row: { y: 0, z: 0, x: 0 } });
    // a clip that plays over and over takes its row to the page's end
    expect(clipLanes(createPage({ elements: [video("loop", { trimEnd: 1 }), once("after", 3)] }), 5).rows).toBe(2);
    expect(clipLanes(createPage({}), 5)).toEqual({ rows: 0, row: {} });
  });

  it("makes room for at most MAX_ROWS rows: a further clip goes on the row that is free soonest", () => {
    const page = createPage({
      elements: [
        video("a", { trimEnd: 4, once: true }),
        video("b", { trimEnd: 1, once: true }),
        video("c", { trimEnd: 3, once: true }),
        video("d", { trimEnd: 1, once: true, startAt: 0.5 }),
      ],
    });
    // a 0-4, b 0-1, c 0-3 take the three rows; d (0.5-1.5) goes where b ends, the soonest
    expect(clipLanes(page, 5)).toEqual({ rows: MAX_ROWS, row: { a: 0, b: 1, c: 2, d: 1 } });
  });

  it("counts the rows of the busiest page", () => {
    const pages = [
      createPage({ elements: [video("a", { trimEnd: 1, once: true }), video("b", { trimEnd: 1, once: true, startAt: 1 })] }),
      createPage({ elements: [video("c"), video("d")] }),
    ];
    expect(clipRows(pages, [5, 5])).toBe(2);
    expect(clipRows(pages.slice(0, 1), [5])).toBe(1);
  });

  it("spreads the pictures over the trimmed part", () => {
    expect(tileMoments(0, 4, 4)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(tileMoments(1, 1, 2)).toEqual([1, 1]);
    expect(tileMoments(0, 2, 0)).toEqual([1]);
  });

  it("trims the start keeping what plays where it was, trims the end, and moves the start on the page, within bounds", () => {
    const el = { trimStart: 1, trimEnd: 3, duration: 4, speed: 2, startAt: 2 };
    expect(dragClip(el, "start", 0.25)).toEqual({ trimStart: 1.5, startAt: 2.25 });
    // not before the clip's beginning, nor closer than a tenth to its end
    expect(dragClip(el, "start", -5)).toEqual({ trimStart: 0, startAt: 1.5 });
    expect(dragClip(el, "start", 5)).toEqual({ trimStart: 2.9, startAt: 2.95 });
    // not before its page's start
    expect(dragClip({ ...el, startAt: 0 }, "start", -0.25)).toEqual({ trimStart: 1, startAt: 0 });
    expect(dragClip(el, "end", 0.25)).toEqual({ trimEnd: 3.5 });
    expect(dragClip(el, "end", 5)).toEqual({ trimEnd: 4 });
    expect(dragClip(el, "end", -5)).toEqual({ trimEnd: 1.1 });
    expect(dragClip(el, "move", -5)).toEqual({ startAt: 0 });
    expect(dragClip({ ...el, startAt: undefined, speed: 0 }, "move", 1.5)).toEqual({ startAt: 1.5 });
  });
});

describe("<Timeline>: the clips", () => {
  it("gives every clip a bar under its page, as long as it plays (to the page's end for a loop, with its plays marked)", async () => {
    const { container } = await renderChrome(<Timeline />, design());
    const [one, two] = bars(container);
    // 16 px of room, 60 px a second
    expect(one.style.left).toBe(`${16 + 60}px`);
    expect(one.style.width).toBe(`${2 * 60}px`);
    expect(one.querySelectorAll(".cf-tl__play")).toHaveLength(1);
    expect(two.style.width).toBe(`${5 * 60}px`);
    expect(two.querySelectorAll(".cf-tl__play")).toHaveLength(3);
    expect(two.style.top).not.toBe(one.style.top);
    // the band grows for the rows
    expect((container.querySelector(".cf-tl") as HTMLElement).style.height).toContain("60px");
  });

  it("draws clips that play one after another on one row, and the band grows for that one row only", async () => {
    const after = createDesign({
      title: "After",
      width: 400,
      height: 300,
      pages: [createPage({ id: "p1", duration: 5, elements: [video("late", { trimEnd: 2, once: true, startAt: 2 }), video("early", { trimEnd: 2, once: true })] })],
    });
    const { container } = await renderChrome(<Timeline />, after);
    const [late, early] = bars(container);
    expect(late.style.top).toBe(early.style.top);
    expect(early.style.left).toBe("16px");
    expect(late.style.left).toBe(`${16 + 2 * 60}px`);
    expect((container.querySelector(".cf-tl") as HTMLElement).style.height).toContain("30px");
  });

  it("begins the first play of a loop carried on from a split page part-way, before the bar does", async () => {
    const carried = createDesign({
      title: "Carried",
      width: 400,
      height: 300,
      pages: [createPage({ id: "p1", duration: 3, elements: [video("loop", { trimEnd: 2, loopFrom: 1.5 })] })],
    });
    const { container } = await renderChrome(<Timeline />, carried);
    const plays = [...bars(container)[0].querySelectorAll<HTMLElement>(".cf-tl__play")];
    // 3 s of a 2 s loop from 1.5 s into it: the end of one play, a whole one, and the start of a third
    expect(plays.map((p) => [p.style.left, p.style.width])).toEqual([
      ["-90px", "120px"],
      ["30px", "120px"],
      ["150px", "30px"],
    ]);
  });

  it("trims a clip's ends and moves it with the keys, a tenth of a second at a time (Shift: a hundredth)", async () => {
    await renderChrome(<Timeline />, design());
    fireEvent.keyDown(screen.getByRole("slider", { name: "End of one" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "End of one" }), { key: "ArrowLeft", shiftKey: true });
    expect(clipNow("one").trimEnd).toBeCloseTo(1.89);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Start of one" }), { key: "ArrowRight" });
    expect(clipNow("one")).toMatchObject({ trimStart: 0.1, startAt: 1.1 });
    fireEvent.keyDown(screen.getByRole("slider", { name: "When one starts" }), { key: "ArrowDown" });
    expect(clipNow("one").startAt).toBe(1);
    fireEvent.keyDown(screen.getByRole("slider", { name: "When one starts" }), { key: "Tab" });
    expect(clipNow("one").startAt).toBe(1);
    // Enter on its middle chooses it on its page
    fireEvent.keyDown(screen.getByRole("slider", { name: "When one starts" }), { key: "Enter" });
    expect(useEditor.getState().selection).toEqual(["one"]);
  });

  it("drags a clip's middle to move it, at the scale of the press, as one step of Undo; a press that does not move chooses it", async () => {
    const { container } = await renderChrome(<Timeline />, design());
    act(() => useEditor.getState().actions.setActivePage("p2"));
    const body = screen.getByRole("slider", { name: "When one starts" });
    fireEvent.pointerDown(body, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(body, { clientX: 101, pointerId: 1 });
    expect(clipNow("one").startAt).toBe(1);
    fireEvent.pointerMove(body, { clientX: 130, pointerId: 1 });
    fireEvent.pointerMove(body, { clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(body, { pointerId: 1 });
    expect(clipNow("one").startAt).toBe(2);
    fireEvent.pointerMove(body, { clientX: 400, pointerId: 1 });
    expect(clipNow("one").startAt).toBe(2);
    act(() => useEditor.getState().actions.undo());
    expect(clipNow("one").startAt).toBe(1);
    // a click: the page of the clip opens and the clip is chosen
    fireEvent.pointerDown(body, { button: 0, clientX: 100, pointerId: 2 });
    fireEvent.pointerUp(body, { pointerId: 2 });
    expect(useEditor.getState().activePageId).toBe("p1");
    expect(useEditor.getState().selection).toEqual(["one"]);
    expect(bars(container)[0].className).toContain("is-selected");
    // another button does nothing
    fireEvent.pointerDown(body, { button: 2, clientX: 100, pointerId: 3 });
    fireEvent.pointerMove(body, { clientX: 300, pointerId: 3 });
    expect(clipNow("one").startAt).toBe(1);
  });

  it("drags the ends to trim", async () => {
    await renderChrome(<Timeline />, design());
    const end = screen.getByRole("slider", { name: "End of one" });
    fireEvent.pointerDown(end, { button: 0, clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(end, { clientX: 170, pointerId: 1 });
    fireEvent.pointerUp(end, { pointerId: 1 });
    expect(clipNow("one").trimEnd).toBe(1.5);
    const start = screen.getByRole("slider", { name: "Start of one" });
    fireEvent.pointerDown(start, { button: 0, clientX: 100, pointerId: 2 });
    fireEvent.pointerMove(start, { clientX: 130, pointerId: 2 });
    fireEvent.pointerCancel(start, { pointerId: 2 });
    expect(clipNow("one")).toMatchObject({ trimStart: 0.5, startAt: 1.5 });
  });

  it("lets one who may only look choose a clip, but not change it", async () => {
    await renderChrome(<Timeline />, design());
    act(() => useEditor.getState().actions.setMode("view"));
    expect(screen.queryByRole("slider", { name: /^(Start|End) of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "one" }));
    expect(useEditor.getState().selection).toEqual(["one"]);
  });

  it("splits the page at the playhead with its button or S, only where both parts are long enough and not while playing", async () => {
    await renderChrome(<Timeline />, design());
    const split = () => screen.getByRole("button", { name: "Split" }) as HTMLButtonElement;
    expect(split().disabled).toBe(true);
    fireEvent.click(split());
    expect(useEditor.getState().design!.pages).toHaveLength(2);
    act(() => seekTimeline(2));
    expect(split().disabled).toBe(false);
    fireEvent.click(split());
    const pages = useEditor.getState().design!.pages;
    expect(pages.map((p) => p.duration)).toEqual([2, 3, 2]);
    expect(useEditor.getState().activePageId).toBe(pages[1].id);
    // S on the playhead, a second into the new page
    act(() => seekTimeline(3));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Playhead" }), { key: "s" });
    expect(useEditor.getState().design!.pages.map((p) => p.duration)).toEqual([2, 1, 2, 2]);
    // with Ctrl it is the editor's
    act(() => seekTimeline(4.5));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Playhead" }), { key: "s", ctrlKey: true });
    expect(useEditor.getState().design!.pages).toHaveLength(4);
  });
});
