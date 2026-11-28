/**
 * <Timeline>: a block for every page as long as it lasts, Play and the clock, a playhead to move with the keys or the pointer,
 * and handles that set how long a page lasts.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createVideo } from "@/core/factory";
import { useEditor } from "@/core/store";
import { stopPreview, usePreview } from "@/editor/canvas/preview";
import { renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { Timeline } from "./Timeline";
import { pauseTimeline, resetTimeline, useTimeline } from "./timelineStore";

const design = () =>
  createDesign({
    title: "Timeline",
    width: 400,
    height: 300,
    pages: [createPage({ id: "p1", duration: 2 }), createPage({ id: "p2", duration: 3, transition: { kind: "dissolve", duration: 1 } })],
  });
const pages = () => useEditor.getState().design!.pages;
const playhead = () => screen.getByRole("slider", { name: "Playhead" });
const handle = (n: number) => screen.getByRole("slider", { name: `How long page ${n} lasts` });

beforeEach(async () => {
  resetEditor();
  resetTimeline();
  await clearLibrary();
});

afterEach(() => {
  pauseTimeline();
  resetTimeline();
  stopPreview();
  resetEditor();
});

describe("<Timeline>", () => {
  it("draws a block for every page with its number and length, a transition between them, and the clock", async () => {
    const { container } = await renderChrome(<Timeline />, design());
    expect(screen.getByRole("region", { name: "Timeline" })).toBeTruthy();
    expect([...container.querySelectorAll(".cf-tl__block")].map((b) => b.textContent)).toEqual(["12.0 s", "23.0 s"]);
    expect(container.querySelectorAll(".cf-tl__trans")).toHaveLength(1);
    expect(container.querySelector(".cf-tl__clock")?.textContent).toBe("0:00.0 / 0:06.0");
    expect(container.querySelector(".cf-tl__block.is-active")?.textContent).toBe("12.0 s");
    expect(playhead().getAttribute("aria-valuetext")).toBe("0:00.0 of 0:06.0, page 1 of 2");
  });

  it("moves the playhead with the keys, a tenth as far with Shift, and from page to page", async () => {
    await renderChrome(<Timeline />, design());
    fireEvent.keyDown(playhead(), { key: "ArrowRight" });
    expect(useTimeline.getState().time).toBe(1);
    expect(usePreview.getState().preview).toMatchObject({ from: 1, paused: true });
    fireEvent.keyDown(playhead(), { key: "ArrowRight", shiftKey: true });
    expect(useTimeline.getState().time).toBeCloseTo(1.1);
    fireEvent.keyDown(playhead(), { key: "ArrowLeft" });
    expect(useTimeline.getState().time).toBeCloseTo(0.1);
    fireEvent.keyDown(playhead(), { key: "PageDown" });
    expect(useTimeline.getState().time).toBe(3);
    expect(useEditor.getState().activePageId).toBe("p2");
    fireEvent.keyDown(playhead(), { key: "End" });
    expect(useTimeline.getState().time).toBe(6);
    fireEvent.keyDown(playhead(), { key: "PageUp" });
    expect(useTimeline.getState().time).toBe(3);
    fireEvent.keyDown(playhead(), { key: "PageUp" });
    expect(useTimeline.getState().time).toBe(0);
    fireEvent.keyDown(playhead(), { key: "Home" });
    expect(useTimeline.getState().time).toBe(0);
    // keys it does not know go on to the editor
    const other = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    playhead().dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it("plays and pauses with its button and with Space", async () => {
    await renderChrome(<Timeline />, design());
    fireEvent.click(screen.getByRole("button", { name: "Play from the playhead" }));
    expect(useTimeline.getState().playing).toBe(true);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    act(() => fireEvent.keyDown(playhead(), { key: " " }));
    expect(useTimeline.getState().playing).toBe(false);
    act(() => fireEvent.keyDown(playhead(), { key: "k" }));
    expect(useTimeline.getState().playing).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(useTimeline.getState().playing).toBe(false);
  });

  it("puts the playhead where it is pressed and follows a drag", async () => {
    await renderChrome(<Timeline />, design());
    const lane = playhead();
    // the lane starts at 0 in the test page; 16 px of room, then 60 px a second
    fireEvent.pointerDown(lane, { button: 0, clientX: 16 + 60, pointerId: 1 });
    expect(useTimeline.getState().time).toBe(1);
    fireEvent.pointerMove(lane, { clientX: 16 + 60 * 4, pointerId: 1 });
    expect(useTimeline.getState().time).toBe(4);
    fireEvent.pointerUp(lane, { pointerId: 1 });
    fireEvent.pointerMove(lane, { clientX: 16, pointerId: 1 });
    expect(useTimeline.getState().time).toBe(4);
    // another button does nothing
    fireEvent.pointerDown(lane, { button: 2, clientX: 16, pointerId: 2 });
    expect(useTimeline.getState().time).toBe(4);
  });

  it("sets how long a page lasts with its handle's keys, one step at a time even before the timeline is drawn again", async () => {
    await renderChrome(<Timeline />, design());
    fireEvent.keyDown(handle(2), { key: "ArrowRight" });
    fireEvent.keyDown(handle(2), { key: "ArrowRight", shiftKey: true });
    expect(pages()[1].duration).toBeCloseTo(4.1);
    fireEvent.keyDown(handle(2), { key: "ArrowDown" });
    expect(pages()[1].duration).toBeCloseTo(3.1);
    fireEvent.keyDown(handle(1), { key: "Home" });
    expect(pages()[0].duration).toBe(1);
    fireEvent.keyDown(handle(1), { key: "End" });
    expect(pages()[0].duration).toBe(60);
    fireEvent.keyDown(handle(1), { key: "Tab" });
    expect(pages()[0].duration).toBe(60);
    expect(handle(1).getAttribute("aria-valuetext")).toBe("60.0 s");
  });

  it("drags a page's end at the scale of the press, and a double click gives the page its own length back", async () => {
    await renderChrome(<Timeline />, design());
    const h = handle(1);
    fireEvent.pointerDown(h, { button: 0, clientX: 200, pointerId: 3 });
    fireEvent.pointerMove(h, { clientX: 200 + 90, pointerId: 3 });
    expect(pages()[0].duration).toBe(3.5);
    fireEvent.pointerMove(h, { clientX: 200 - 600, pointerId: 3 });
    expect(pages()[0].duration).toBe(1);
    fireEvent.pointerUp(h, { pointerId: 3 });
    fireEvent.pointerMove(h, { clientX: 900, pointerId: 3 });
    expect(pages()[0].duration).toBe(1);
    // a press on the handle does not move the playhead
    expect(useTimeline.getState().time).toBe(0);
    fireEvent.doubleClick(h);
    expect(pages()[0].duration).toBeUndefined();
  });

  it("does not cut a page that follows a long clip to the longest length that can be set by hand", async () => {
    const long = design();
    const clip = createVideo({ src: "asset:a_long", naturalWidth: 320, naturalHeight: 180, duration: 90 });
    long.pages[0] = createPage({ id: "p1", elements: [clip] });
    await renderChrome(<Timeline />, long);
    expect(handle(1).getAttribute("aria-valuetext")).toBe("90.0 s");
    // growing it would set 91 s by hand, which is cut to 60: it is left to follow its clip
    fireEvent.keyDown(handle(1), { key: "ArrowRight" });
    fireEvent.keyDown(handle(1), { key: "End" });
    expect(pages()[0].duration).toBeUndefined();
    // made shorter, it gets the longest length that can be set by hand
    fireEvent.keyDown(handle(1), { key: "ArrowLeft" });
    expect(pages()[0].duration).toBe(60);
  });

  it("offers no handles to a person who may only look", async () => {
    await renderChrome(<Timeline />, design());
    act(() => useEditor.getState().actions.setMode("view"));
    expect(screen.queryByRole("slider", { name: /How long page/ })).toBeNull();
    expect(playhead()).toBeTruthy();
  });
});
