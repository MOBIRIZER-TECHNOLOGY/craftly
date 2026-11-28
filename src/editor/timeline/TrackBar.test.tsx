/**
 * The sounds of the design on the timeline: their rows, what dragging or the keys do to them, choosing one, its controls, and
 * adding one from the uploads.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as assets from "@/core/assets";
import { MAX_TRACKS } from "@/core/audioTracks";
import { createDesign, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { AudioTrack, Design } from "@/core/types";
import { stopPreview } from "@/editor/canvas/preview";
import { renderChrome } from "@/test/chromeUtils";
import { typeNumber } from "@/test/ctxUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { addSoundToDesign } from "./addSound";
import { Timeline } from "./Timeline";
import { chooseTrack, resetTimeline, seekTimeline, setTimelineOpen, useTimeline } from "./timelineStore";
import { dragTrack, soundLanes } from "./TrackBar";

const sound = (id: string, over: Partial<AudioTrack> = {}): AudioTrack => ({ id, src: "asset:a_song", name: id, duration: 10, trimStart: 0, trimEnd: 2, startAt: 0, ...over });
const design = (audio: AudioTrack[] = [sound("song", { startAt: 1 })]): Design => ({
  ...createDesign({ title: "Music", width: 400, height: 300, pages: [createPage({ id: "p1", duration: 3 }), createPage({ id: "p2", duration: 3 })] }),
  audio,
});
const trackNow = (id: string) => useEditor.getState().design!.audio?.find((t) => t.id === id);
const bars = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".cf-tl__sound")];

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

describe("the maths of the sounds' rows", () => {
  it("puts sounds one after another on one row, and sounds that play at once on rows of their own", () => {
    const tracks = [sound("a"), sound("b", { startAt: 2 }), sound("c", { startAt: 1 }), sound("d", { loop: true, startAt: 4 })];
    expect(soundLanes(tracks, 6)).toEqual({ rows: 2, row: { a: 0, c: 1, b: 0, d: 0 } });
    expect(soundLanes([], 6)).toEqual({ rows: 0, row: {} });
  });

  it("trims the start keeping what plays where it was, trims the end, and moves the start, within bounds", () => {
    const t = { trimStart: 1, trimEnd: 3, duration: 4, startAt: 2 };
    expect(dragTrack(t, "start", 0.5)).toEqual({ trimStart: 1.5, startAt: 2.5 });
    // not before the sound's beginning, not before the design's, not closer than a tenth to its end
    expect(dragTrack(t, "start", -5)).toEqual({ trimStart: 0, startAt: 1 });
    expect(dragTrack({ ...t, startAt: 0.5 }, "start", -5)).toEqual({ trimStart: 0.5, startAt: 0 });
    expect(dragTrack(t, "start", 5)).toEqual({ trimStart: 2.9, startAt: 3.9 });
    expect(dragTrack(t, "end", 0.5)).toEqual({ trimEnd: 3.5 });
    expect(dragTrack(t, "end", 5)).toEqual({ trimEnd: 4 });
    expect(dragTrack(t, "end", -5)).toEqual({ trimEnd: 1.1 });
    expect(dragTrack(t, "move", -5)).toEqual({ startAt: 0 });
    expect(dragTrack(t, "move", 1.25)).toEqual({ startAt: 3.25 });
  });
});

describe("<Timeline>: the sounds", () => {
  it("gives every sound a bar under the clips, from its start for as long as it plays (to the design's end, its plays marked, when over and over)", async () => {
    const { container } = await renderChrome(<Timeline />, design([sound("once", { startAt: 1 }), sound("loop", { startAt: 3, loop: true, trimEnd: 1 })]));
    const [once, loop] = bars(container);
    // 16 px of room, 60 px a second: the design lasts 6 s
    expect(once.style.left).toBe(`${16 + 60}px`);
    expect(once.style.width).toBe(`${2 * 60}px`);
    expect(loop.style.left).toBe(`${16 + 3 * 60}px`);
    expect(loop.style.width).toBe(`${3 * 60}px`);
    expect(loop.querySelectorAll(".cf-tl__play")).toHaveLength(3);
    // one after another: one row, and the band grows for it
    expect(once.style.top).toBe(loop.style.top);
    expect((container.querySelector(".cf-tl") as HTMLElement).style.height).toContain("30px");
    expect(screen.getByRole("slider", { name: "When the sound loop starts" }).getAttribute("aria-valuetext")).toBe("At 0:03.0, plays 0:01.0, over and over");
  });

  it("drags a sound's middle to move it as one step of Undo, and its ends to trim it; a press chooses it", async () => {
    const { container } = await renderChrome(<Timeline />, design());
    const body = screen.getByRole("slider", { name: "When the sound song starts" });
    fireEvent.pointerDown(body, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(body, { clientX: 130, pointerId: 1 });
    fireEvent.pointerMove(body, { clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(body, { pointerId: 1 });
    expect(trackNow("song")!.startAt).toBe(2);
    act(() => useEditor.getState().actions.undo());
    expect(trackNow("song")!.startAt).toBe(1);
    expect(useTimeline.getState().track).toBe("song");
    expect(bars(container)[0].className).toContain("is-selected");
    const end = screen.getByRole("slider", { name: "End of song" });
    fireEvent.pointerDown(end, { button: 0, clientX: 200, pointerId: 2 });
    fireEvent.pointerMove(end, { clientX: 170, pointerId: 2 });
    fireEvent.pointerUp(end, { pointerId: 2 });
    expect(trackNow("song")!.trimEnd).toBe(1.5);
    // another button does nothing
    fireEvent.pointerDown(body, { button: 2, clientX: 100, pointerId: 3 });
    fireEvent.pointerMove(body, { clientX: 300, pointerId: 3 });
    expect(trackNow("song")!.startAt).toBe(1);
  });

  it("answers the keys: arrows move and trim, Enter chooses, Esc lets go, Delete removes", async () => {
    await renderChrome(<Timeline />, design());
    const body = screen.getByRole("slider", { name: "When the sound song starts" });
    fireEvent.keyDown(body, { key: "ArrowRight" });
    fireEvent.keyDown(body, { key: "ArrowRight", shiftKey: true });
    expect(trackNow("song")!.startAt).toBe(1.11);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Start of song" }), { key: "ArrowRight" });
    expect(trackNow("song")).toMatchObject({ trimStart: 0.1, startAt: 1.21 });
    fireEvent.keyDown(screen.getByRole("slider", { name: "End of song" }), { key: "ArrowLeft" });
    expect(trackNow("song")!.trimEnd).toBe(1.9);
    fireEvent.keyDown(body, { key: "Enter" });
    expect(useTimeline.getState().track).toBe("song");
    fireEvent.keyDown(body, { key: "Escape" });
    expect(useTimeline.getState().track).toBeNull();
    fireEvent.keyDown(body, { key: "x" });
    fireEvent.keyDown(body, { key: "Delete" });
    expect(useEditor.getState().design!.audio).toBeUndefined();
    expect(await screen.findByText("Sound removed")).toBeTruthy();
    act(() => useEditor.getState().actions.undo());
    expect(trackNow("song")).toBeDefined();
  });

  it("shows the chosen sound's controls: volume and fades, over and over, remove and done", async () => {
    const user = userEvent.setup();
    await renderChrome(<Timeline />, design());
    act(() => chooseTrack("song"));
    const controls = screen.getByRole("group", { name: "Sound: song" });
    const loop = within(controls).getByRole("button", { name: "Over and over" });
    expect(loop.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(loop);
    expect(trackNow("song")!.loop).toBe(true);
    expect(within(controls).getByRole("button", { name: "Over and over" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(controls).getByRole("button", { name: "Over and over" }));
    expect(trackNow("song")!.loop).toBeUndefined();

    await user.click(within(controls).getByRole("button", { name: "Volume and fades" }));
    const dialog = await screen.findByRole("dialog", { name: "Volume and fades" });
    const field = (name: string) => within(dialog).getByRole("spinbutton", { name: `${name} value` });
    await typeNumber(user, field("Volume (%)"), "40");
    await typeNumber(user, field("Fade in (seconds)"), "1.5");
    await typeNumber(user, field("Fade out (seconds)"), "9");
    expect(trackNow("song")).toMatchObject({ volume: 0.4, fadeIn: 1.5, fadeOut: 5 });
    await typeNumber(user, field("Volume (%)"), "100");
    await typeNumber(user, field("Fade in (seconds)"), "0");
    expect(trackNow("song")!.volume).toBeUndefined();
    expect(trackNow("song")!.fadeIn).toBeUndefined();
    await user.keyboard("{Escape}");

    fireEvent.click(within(controls).getByRole("button", { name: "Done" }));
    expect(useTimeline.getState().track).toBeNull();
    expect(screen.queryByRole("group", { name: "Sound: song" })).toBeNull();
    act(() => chooseTrack("song"));
    fireEvent.click(screen.getByRole("button", { name: "Remove the sound" }));
    expect(useEditor.getState().design!.audio).toBeUndefined();
    expect(screen.queryByRole("group", { name: "Sound: song" })).toBeNull();
  });

  it("lets go of a chosen sound when an element is chosen, and chosen elements when a sound is", async () => {
    const withShape = design();
    withShape.pages[0].elements = [createShape("rect", { id: "x" })];
    await renderChrome(<Timeline />, withShape);
    act(() => useEditor.getState().actions.select(["x"]));
    expect(useEditor.getState().selection).toEqual(["x"]);
    act(() => chooseTrack("song"));
    expect(useEditor.getState().selection).toEqual([]);
    act(() => useEditor.getState().actions.select(["x"]));
    expect(useTimeline.getState().track).toBeNull();
  });

  it("shows sounds to one who may only look, without anything to drag", async () => {
    const { container } = await renderChrome(<Timeline />, design());
    act(() => useEditor.setState({ mode: "view" }));
    expect(bars(container)).toHaveLength(1);
    expect(screen.queryByRole("slider", { name: "When the sound song starts" })).toBeNull();
    expect(within(bars(container)[0]).getByText("song")).toBeTruthy();
  });
});

describe("adding a sound of the uploads", () => {
  it("adds it whole, at the playhead of an open timeline, opens the timeline and chooses it", async () => {
    vi.spyOn(assets, "audioInfo").mockResolvedValue({ duration: 42 });
    await renderChrome(<Timeline />, design([]));
    act(() => {
      setTimelineOpen(true);
      seekTimeline(2.5);
    });
    let id = "";
    await act(async () => {
      id = await addSoundToDesign({ id: "a_new", name: "Theme", blob: new Blob(["x"]) });
    });
    expect(trackNow(id)).toMatchObject({ src: "asset:a_new", name: "Theme", duration: 42, trimStart: 0, trimEnd: 42, startAt: 2.5 });
    expect(useTimeline.getState()).toMatchObject({ open: true, track: id });
    expect(await screen.findByText("Theme was added to the timeline")).toBeTruthy();
  });

  it("starts at the beginning when the timeline is closed, and uses a length already known", async () => {
    const info = vi.spyOn(assets, "audioInfo");
    await renderChrome(<Timeline />, design([]));
    let id = "";
    await act(async () => {
      id = await addSoundToDesign({ id: "a_new", name: "Theme", blob: new Blob(["x"]) }, 7);
    });
    expect(info).not.toHaveBeenCalled();
    expect(trackNow(id)).toMatchObject({ startAt: 0, duration: 7 });
    expect(useTimeline.getState().open).toBe(true);
  });

  it("adds nothing to a design that holds the most sounds it may, and says so; nor to one that may only be looked at", async () => {
    await renderChrome(<Timeline />, design(Array.from({ length: MAX_TRACKS }, (_, i) => sound(`s${i}`))));
    let id = "x";
    await act(async () => {
      id = await addSoundToDesign({ id: "a_new", name: "Theme", blob: new Blob(["x"]) }, 7);
    });
    expect(id).toBe("");
    expect(await screen.findByText(`A design holds at most ${MAX_TRACKS} sounds. Remove one on the timeline first.`)).toBeTruthy();
    act(() => useEditor.setState({ mode: "view" }));
    await act(async () => {
      id = await addSoundToDesign({ id: "a_new", name: "Theme", blob: new Blob(["x"]) }, 7);
    });
    expect(id).toBe("");
    expect(useEditor.getState().actions.addAudioTrack(sound("more"))).toBe(false);
  });
});
