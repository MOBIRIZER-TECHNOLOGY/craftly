import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShape, createVideo, VIDEO_SPEED_MAX, VIDEO_SPEED_MIN } from "@/core/factory";
import type { DesignElement, VideoElement } from "@/core/types";
import { stopPreview, usePreview } from "@/editor/canvas/preview";
import { ContextHost, live, openElements, selectElements, store, typeNumber } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";
import { FloatingToolbar } from "../FloatingToolbar";
import { VIDEO_SPEEDS } from "./VideoBar";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
  act(() => stopPreview());
});
afterEach(() => {
  act(() => stopPreview());
  restoreLayout();
});

const clip = (extra: Partial<VideoElement> = {}) => createVideo({ src: "asset:clip", x: 100, y: 100, width: 320, height: 180, duration: 10, ...extra });
const mount = (elements: DesignElement[], selected: DesignElement[] = elements) => {
  openElements(elements, { selected });
  return render(
    <>
      <FloatingToolbar />
      <ContextHost />
    </>,
  );
};
const bar = () => screen.getByRole("toolbar");
const kind = () => bar().getAttribute("data-cf-toolbar");
const btn = (name: string | RegExp) => within(bar()).getByRole("button", { name }) as HTMLButtonElement;
const has = (name: string | RegExp) => within(bar()).queryByRole("button", { name }) !== null;
const names = () =>
  within(bar())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
const items = () => screen.getAllByRole("menuitemcheckbox");
const checked = () => items().filter((item) => item.getAttribute("aria-checked") === "true");
const item = (name: string) => screen.getByRole("menuitemcheckbox", { name });
const preview = () => usePreview.getState().preview;

describe("which toolbar a clip gets", () => {
  it("gives a clip, and several clips, the video toolbar", () => {
    const [a, b] = [clip(), clip({ x: 500 })];
    mount([a, b], [a]);
    expect(kind()).toBe("video");
    expect(screen.getByRole("toolbar", { name: "Selected element common controls" })).toBeTruthy();
    selectElements(a, b);
    expect(kind()).toBe("video");
  });

  it("gives a clip selected with something else the toolbar of a mixed selection", () => {
    const [a, shape] = [clip(), createShape("rect", { x: 600, y: 100, width: 100, height: 100 })];
    mount([a, shape]);
    expect(kind()).toBe("multi");
  });

  it("acts on the clips of a selection whose other elements are locked", () => {
    const [a, fixed] = [clip(), createShape("rect", { x: 600, y: 100, width: 100, height: 100, locked: true })];
    mount([a, fixed]);
    expect(kind()).toBe("video");
  });
});

describe("video toolbar", () => {
  it("lists the controls of a clip", () => {
    mount([clip()]);
    expect(names()).toEqual([
      "Play",
      "Trim",
      "Speed",
      "Sound",
      "Audio",
      "Captions",
      "Frame shape",
      "Flip",
      "Corner radius",
      "Border",
      "Transparency",
      "Animate",
      "Position",
      "Copy style",
      "More actions",
    ]);
  });

  it("leaves out the trim for several clips and offers to align them", () => {
    const [a, b] = [clip(), clip({ x: 500 })];
    mount([a, b]);
    expect(has("Trim")).toBe(false);
    expect(has("Align")).toBe(true);
    expect(has("Group")).toBe(true);
  });

  it("does not offer to align a single clip", () => {
    mount([clip()]);
    expect(has("Align")).toBe(false);
  });
});

describe("video toolbar: playing", () => {
  it("plays the page from its start for as long as the longest clip plays once, and stops", async () => {
    const user = userEvent.setup();
    // 10 s at normal speed, and 6 s played at a quarter of the speed: 24 s
    const [a, b] = [clip(), clip({ x: 500, duration: 6, speed: 0.25 })];
    mount([a, b]);
    expect(preview()).toBeNull();
    await user.click(btn("Play"));
    // with the clips' sound: it was asked for by a click on the clip
    expect(preview()).toMatchObject({ from: 0, until: 24, sound: true });
    expect(has("Play")).toBe(false);
    await user.click(btn("Stop"));
    expect(preview()).toBeNull();
    expect(has("Play")).toBe(true);
  });

  it("plays until a clip that starts later has played once", async () => {
    const user = userEvent.setup();
    mount([clip({ duration: 4, startAt: 3 })]);
    await user.click(btn("Play"));
    expect(preview()).toMatchObject({ from: 0, until: 7 });
  });

  it("plays the trimmed part at the clip's speed", async () => {
    const user = userEvent.setup();
    mount([clip({ trimStart: 2, trimEnd: 8, speed: 2 })]);
    await user.click(btn("Play"));
    expect(preview()).toMatchObject({ from: 0, until: 3 });
  });

  it("plays at least a second of the page for a clip that is shorter than that", async () => {
    const user = userEvent.setup();
    mount([clip({ trimStart: 0, trimEnd: 0.4, speed: 4 })]);
    await user.click(btn("Play"));
    expect(preview()).toMatchObject({ from: 0, until: 1 });
  });

  it("shows Stop while a preview started elsewhere runs", () => {
    mount([clip()]);
    act(() => usePreview.setState({ preview: { startedAt: 0, from: 0, until: 5 } }));
    expect(has("Stop")).toBe(true);
    expect(has("Play")).toBe(false);
  });
});

describe("video toolbar: captions", () => {
  const openCaptions = async (el: VideoElement) => {
    const user = userEvent.setup();
    mount([el]);
    await user.click(btn("Captions"));
    const dialog = screen.getByRole("dialog", { name: "Captions" });
    return { user, dialog };
  };
  const box = (dialog: HTMLElement, name: string) => within(dialog).getByRole(name.includes("words") ? "textbox" : "spinbutton", { name }) as HTMLInputElement;

  it("says there are none, and adds a line of two seconds after the last", async () => {
    const el = clip();
    const { user, dialog } = await openCaptions(el);
    expect(within(dialog).getByText("No captions yet.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Add a line" }));
    await user.click(within(dialog).getByRole("button", { name: "Add a line" }));
    expect(live<VideoElement>(el).captions).toEqual([
      { start: 0, end: 2, text: "" },
      { start: 2, end: 4, text: "" },
    ]);
  });

  it("takes the words of a line in one step of undo, and its times", async () => {
    const el = clip({ captions: [{ start: 0, end: 2, text: "" }] });
    const { user, dialog } = await openCaptions(el);
    const before = store().past.length;
    await user.type(box(dialog, "Line 1: words"), "Hello there");
    expect(live<VideoElement>(el).captions![0].text).toBe("Hello there");
    expect(store().past.length).toBe(before + 1);
    await typeNumber(user, box(dialog, "Line 1: to (seconds)"), "3.5");
    expect(live<VideoElement>(el).captions![0]).toMatchObject({ start: 0, end: 3.5 });
  });

  it("keeps a line's end after its start, whichever is changed", async () => {
    const el = clip({ captions: [{ start: 1, end: 2, text: "a" }] });
    const { user, dialog } = await openCaptions(el);
    await typeNumber(user, box(dialog, "Line 1: from (seconds)"), "4");
    expect(live<VideoElement>(el).captions![0]).toMatchObject({ start: 4, end: 4.5 });
    await typeNumber(user, box(dialog, "Line 1: to (seconds)"), "1");
    expect(live<VideoElement>(el).captions![0]).toMatchObject({ start: 0.5, end: 1 });
  });

  it("removes a line, and leaves nothing behind when the last one goes", async () => {
    const el = clip({
      captions: [
        { start: 0, end: 1, text: "a" },
        { start: 1, end: 2, text: "b" },
      ],
    });
    const { user, dialog } = await openCaptions(el);
    await user.click(within(dialog).getByRole("button", { name: "Remove line 1" }));
    expect(live<VideoElement>(el).captions).toEqual([{ start: 1, end: 2, text: "b" }]);
    await user.click(within(dialog).getByRole("button", { name: "Remove line 1" }));
    expect("captions" in live<VideoElement>(el)).toBe(false);
  });

  it("is only there for a single clip", () => {
    mount([clip(), clip({ x: 500 })]);
    expect(screen.queryByRole("button", { name: "Captions" })).toBeNull();
  });
});

describe("video toolbar: audio", () => {
  const openAudio = async (els: VideoElement[]) => {
    const user = userEvent.setup();
    mount(els);
    await user.click(btn("Audio"));
    const dialog = screen.getByRole("dialog", { name: "Audio" });
    return { user, dialog };
  };
  const field = (dialog: HTMLElement, name: string) => within(dialog).getByRole("spinbutton", { name: `${name} value` });

  it("shows the full volume and no fades for a new clip", async () => {
    const { dialog } = await openAudio([clip()]);
    expect((field(dialog, "Volume (%)") as HTMLInputElement).value).toBe("100");
    expect((field(dialog, "Fade in (seconds)") as HTMLInputElement).value).toBe("0");
    expect((field(dialog, "Fade out (seconds)") as HTMLInputElement).value).toBe("0");
    expect(within(dialog).queryByRole("status")).toBeNull();
  });

  it("sets the volume and the fades, and leaves nothing behind at their defaults", async () => {
    const el = clip();
    const { user, dialog } = await openAudio([el]);
    await typeNumber(user, field(dialog, "Volume (%)"), "40");
    await typeNumber(user, field(dialog, "Fade in (seconds)"), "1.5");
    await typeNumber(user, field(dialog, "Fade out (seconds)"), "9");
    expect(live<VideoElement>(el)).toMatchObject({ volume: 0.4, fadeIn: 1.5, fadeOut: 5 });
    await typeNumber(user, field(dialog, "Volume (%)"), "100");
    await typeNumber(user, field(dialog, "Fade in (seconds)"), "0");
    const after = live<VideoElement>(el);
    expect("volume" in after).toBe(false);
    expect("fadeIn" in after).toBe(false);
  });

  it("sets them on every selected clip", async () => {
    const one = clip();
    const two = clip({ x: 500 });
    const { user, dialog } = await openAudio([one, two]);
    await typeNumber(user, field(dialog, "Volume (%)"), "25");
    expect([live<VideoElement>(one).volume, live<VideoElement>(two).volume]).toEqual([0.25, 0.25]);
  });

  it("says that a muted clip is not heard", async () => {
    const { dialog } = await openAudio([clip({ muted: true })]);
    expect(within(dialog).getByRole("status").textContent).toBe("The clip is muted: turn Sound on to hear it.");
  });
});

describe("video toolbar: trim", () => {
  const openTrim = async (el: VideoElement) => {
    const user = userEvent.setup();
    mount([el]);
    await user.click(btn("Trim"));
    const dialog = screen.getByRole("dialog", { name: "Trim" });
    return { user, dialog };
  };
  const field = (dialog: HTMLElement, name: "Start" | "End") => within(dialog).getByRole("spinbutton", { name: `${name} (seconds) value` });
  const reset = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Play the whole clip" }) as HTMLButtonElement;

  it("says that the whole clip plays and has nothing to reset while it is not trimmed", async () => {
    const { dialog } = await openTrim(clip());
    expect(within(dialog).getByRole("status").textContent).toBe("Plays 10 s of 10 s");
    expect(reset(dialog).disabled).toBe(true);
    const start = within(dialog).getByRole("slider", { name: "Start (seconds)" });
    expect([start.getAttribute("aria-valuemin"), start.getAttribute("aria-valuemax"), start.getAttribute("aria-valuenow")]).toEqual(["0", "10", "0"]);
    expect(within(dialog).getByRole("slider", { name: "End (seconds)" }).getAttribute("aria-valuenow")).toBe("10");
  });

  it("sets where the clip starts and stops, and says how much of it plays", async () => {
    const el = clip();
    const { user, dialog } = await openTrim(el);
    await typeNumber(user, field(dialog, "Start"), "2.5");
    expect(live<VideoElement>(el)).toMatchObject({ trimStart: 2.5, trimEnd: 10 });
    await typeNumber(user, field(dialog, "End"), "6");
    expect(live<VideoElement>(el)).toMatchObject({ trimStart: 2.5, trimEnd: 6 });
    expect(within(dialog).getByRole("status").textContent).toBe("Plays 3.5 s of 10 s");
    expect(reset(dialog).disabled).toBe(false);
  });

  it("rounds the length in its hint as the fields round theirs", async () => {
    // a browser's own recording: 2.385 s reads 2.38 in the End field, and the hint must not say 2.39
    const { dialog } = await openTrim(clip({ duration: 2.385, trimStart: 1.3, trimEnd: 2.385 }));
    expect((field(dialog, "End") as HTMLInputElement).value).toBe("2.38");
    expect(within(dialog).getByRole("status").textContent).toBe("Plays 1.08 s of 2.38 s");
  });

  it("moves the start out of the way of an end set before it", async () => {
    const el = clip({ trimStart: 5 });
    const { user, dialog } = await openTrim(el);
    await typeNumber(user, field(dialog, "End"), "2");
    expect(live<VideoElement>(el)).toMatchObject({ trimStart: 1.9, trimEnd: 2 });
  });

  it("keeps the start inside the clip", async () => {
    const el = clip();
    const { user, dialog } = await openTrim(el);
    await typeNumber(user, field(dialog, "Start"), "10");
    expect(live<VideoElement>(el)).toMatchObject({ trimStart: 9.9, trimEnd: 10 });
  });

  it("makes one step of undo of a drag along the slider", async () => {
    const el = clip();
    const { user, dialog } = await openTrim(el);
    const before = store().past.length;
    within(dialog).getByRole("slider", { name: "End (seconds)" }).focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(live<VideoElement>(el).trimEnd).toBeCloseTo(9.7);
    expect(store().past.length).toBe(before + 1);
  });

  it("sets when the clip starts on its page, and leaves nothing behind at 0", async () => {
    const el = clip();
    const { user, dialog } = await openTrim(el);
    const at = within(dialog).getByRole("spinbutton", { name: "Starts on the page at (seconds) value" });
    await typeNumber(user, at, "2.5");
    expect(live<VideoElement>(el).startAt).toBe(2.5);
    await typeNumber(user, at, "0");
    expect("startAt" in live<VideoElement>(el)).toBe(false);
  });

  it("plays the clip over and over unless it is set to play once", async () => {
    const el = clip();
    const { user, dialog } = await openTrim(el);
    const loop = within(dialog).getByRole("checkbox", { name: "Play over and over" }) as HTMLInputElement;
    expect(loop.checked).toBe(true);
    expect(within(dialog).getByText(/starts again whenever it ends/)).toBeTruthy();
    await user.click(loop);
    expect(live<VideoElement>(el).once).toBe(true);
    expect(within(dialog).getByText("The clip plays once, then stays on its last frame without sound.")).toBeTruthy();
    await user.click(loop);
    expect("once" in live<VideoElement>(el)).toBe(false);
  });

  it("plays the whole clip again", async () => {
    const el = clip({ trimStart: 1, trimEnd: 4 });
    const { user, dialog } = await openTrim(el);
    expect(within(dialog).getByRole("status").textContent).toBe("Plays 3 s of 10 s");
    await user.click(reset(dialog));
    expect(live<VideoElement>(el)).toMatchObject({ trimStart: 0, trimEnd: 10 });
    expect(reset(dialog).disabled).toBe(true);
  });

  it("counts a clip that stops before its end as trimmed", async () => {
    const { dialog } = await openTrim(clip({ trimEnd: 9 }));
    expect(reset(dialog).disabled).toBe(false);
  });

  it("gives a clip of no known length a slider of a tenth of a second", async () => {
    const el = clip();
    mount([el]);
    // a clip read as 0 s long (a design from elsewhere): the slider still has room for the shortest part that can play
    act(() => store().actions.updateElements([el.id], (v) => void ((v as VideoElement).duration = 0)));
    const user = userEvent.setup();
    await user.click(btn("Trim"));
    expect(
      within(screen.getByRole("dialog", { name: "Trim" }))
        .getByRole("slider", { name: "Start (seconds)" })
        .getAttribute("aria-valuemax"),
    ).toBe("0.1");
  });
});

describe("video toolbar: speed", () => {
  it("offers the speeds from a quarter to four times, slowest first", () => {
    expect(VIDEO_SPEEDS).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
    expect(VIDEO_SPEEDS[0]).toBe(VIDEO_SPEED_MIN);
    expect(VIDEO_SPEEDS[VIDEO_SPEEDS.length - 1]).toBe(VIDEO_SPEED_MAX);
  });

  it("shows the speed on the button, marks it in the menu and sets another", async () => {
    const user = userEvent.setup();
    const el = clip();
    mount([el]);
    expect(btn("Speed").textContent).toContain("1×");
    await user.click(btn("Speed"));
    expect(items().map((i) => i.textContent)).toEqual(["0.25×", "0.5×", "0.75×", "1×", "1.25×", "1.5×", "2×", "3×", "4×"]);
    expect(checked().map((i) => i.textContent)).toEqual(["1×"]);
    await user.click(item("2×"));
    expect(live<VideoElement>(el).speed).toBe(2);
    expect(btn("Speed").textContent).toContain("2×");
  });

  it("marks no speed for clips that play at different speeds, and sets one for all of them", async () => {
    const user = userEvent.setup();
    const [a, b] = [clip(), clip({ x: 500, speed: 2 })];
    mount([a, b]);
    expect(btn("Speed").textContent).not.toContain("×");
    await user.click(btn("Speed"));
    expect(checked()).toEqual([]);
    await user.click(item("0.5×"));
    expect([live<VideoElement>(a).speed, live<VideoElement>(b).speed]).toEqual([0.5, 0.5]);
  });

  it("shows no speed on the button for a clip that has none recorded", () => {
    mount([clip({ speed: undefined as unknown as number })]);
    expect(btn("Speed").textContent).not.toContain("×");
  });
});

describe("video toolbar: sound", () => {
  it("mutes a clip that plays with its sound, and gives the sound back", async () => {
    const user = userEvent.setup();
    const el = clip();
    mount([el]);
    expect(btn("Sound").getAttribute("aria-pressed")).toBe("true");
    await user.click(btn("Sound"));
    expect(live<VideoElement>(el).muted).toBe(true);
    expect(btn("Sound").getAttribute("aria-pressed")).toBe("false");
    await user.click(btn("Sound"));
    expect("muted" in live<VideoElement>(el)).toBe(false);
    expect(btn("Sound").getAttribute("aria-pressed")).toBe("true");
  });

  it("mutes every clip when only some of them are muted", async () => {
    const user = userEvent.setup();
    const [a, b] = [clip(), clip({ x: 500, muted: true })];
    mount([a, b]);
    expect(btn("Sound").getAttribute("aria-pressed")).toBe("true");
    await user.click(btn("Sound"));
    expect([live<VideoElement>(a).muted, live<VideoElement>(b).muted]).toEqual([true, true]);
  });
});

describe("video toolbar: frame shape", () => {
  it("cuts a clip to a shape and back, and offers the corner radius only for the rectangle", async () => {
    const user = userEvent.setup();
    const el = clip({ maskPath: "M0 0 L1 0 L1 1 Z" });
    mount([el]);
    const before = live<VideoElement>(el);
    expect(has("Corner radius")).toBe(true);
    await user.click(btn("Frame shape"));
    expect(items()[0].textContent).toBe("No frame");
    expect(checked().map((i) => i.textContent)).toEqual(["No frame"]);
    await user.click(item("Circle"));
    const round = live<VideoElement>(el);
    expect(round.mask).toBe("ellipse");
    expect(round.maskPath).toBeUndefined();
    expect([round.x, round.y, round.width, round.height, round.src]).toEqual([before.x, before.y, before.width, before.height, before.src]);
    expect(has("Corner radius")).toBe(false);
    await user.click(btn("Frame shape"));
    expect(checked().map((i) => i.textContent)).toEqual(["Circle"]);
    await user.click(item("No frame"));
    expect(live<VideoElement>(el).mask).toBe("rect");
    expect(has("Corner radius")).toBe(true);
  });

  it("marks no shape for clips cut to different shapes, and leaves out the corner radius", async () => {
    const user = userEvent.setup();
    const [a, b] = [clip(), clip({ x: 500, mask: "ellipse" })];
    mount([a, b]);
    expect(has("Corner radius")).toBe(false);
    await user.click(btn("Frame shape"));
    expect(checked()).toEqual([]);
    await user.click(item("Star"));
    expect([live<VideoElement>(a).mask, live<VideoElement>(b).mask]).toEqual(["star", "star"]);
  });

  it("rounds the corners of a clip that has no mask of its own", async () => {
    const user = userEvent.setup();
    const el = clip({ mask: undefined as unknown as string });
    mount([el]);
    expect(has("Corner radius")).toBe(true);
    await user.click(btn("Frame shape"));
    expect(checked().map((i) => i.textContent)).toEqual(["No frame"]);
  });
});

describe("video toolbar: shared controls", () => {
  it("flips a clip", async () => {
    const user = userEvent.setup();
    const el = clip();
    mount([el]);
    await user.click(btn("Flip"));
    await user.click(screen.getByRole("menuitem", { name: "Flip vertical" }));
    expect(live<VideoElement>(el).flipV).toBe(true);
  });

  it("changes the transparency of a clip", async () => {
    const user = userEvent.setup();
    const el = clip();
    mount([el]);
    await user.click(btn("Transparency"));
    await typeNumber(user, within(screen.getByRole("dialog", { name: "Transparency" })).getByRole("spinbutton", { name: "Transparency value" }), "60");
    expect(live<VideoElement>(el).opacity).toBe(0.6);
  });

  it("opens Animate and Position", async () => {
    const user = userEvent.setup();
    mount([clip()]);
    await user.click(btn("Animate"));
    expect(store().context).toEqual({ kind: "animate", tab: "element" });
    await user.click(btn("Position"));
    expect(store().context).toEqual({ kind: "position", tab: "arrange" });
  });

  it("copies the style of a clip", async () => {
    const user = userEvent.setup();
    mount([clip({ opacity: 0.5 })]);
    await user.click(btn("Copy style"));
    expect(store().styleClipboard).not.toBeNull();
    expect(has("Paste style")).toBe(true);
  });
});
