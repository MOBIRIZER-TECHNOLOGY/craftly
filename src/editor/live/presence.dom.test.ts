/**
 * The editor's side of presence: the small list of the other people in a shared design (kept while they are heard of), the name
 * this person gave (kept on this device), and what is said about this person: not more often than it is worth, and again every few
 * seconds so that the others know this person is still here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_ID_MAX, PRESENCE_SELECTION_MAX, PRESENCE_STALE_MS, type PresenceHeard, type PresenceState } from "@/collab/presence";
import { contrastRatio, isPlainColor } from "@/core/color";
import { createShape, createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import { chromeDesign } from "@/test/chromeUtils";
import { resetEditor } from "@/test/helpers";
import {
  clearPresence,
  colorOf,
  forgetStale,
  heardPresence,
  PRESENCE_COLORS,
  REPEAT_EVERY_MS,
  SAY_EVERY_MS,
  saveName,
  savedName,
  setPointer,
  shownName,
  startPresence,
  usePresence,
} from "./presence";

const heard = (peer: number, over: Partial<PresenceState> = {}): PresenceHeard => ({
  t: "presence",
  peer,
  name: "Ana",
  page: "p",
  pointer: { x: 1, y: 2 },
  selection: [],
  editing: null,
  ...over,
});
const people = () => usePresence.getState().people;
const actions = () => useEditor.getState().actions;

beforeEach(() => {
  localStorage.clear();
  resetEditor();
  clearPresence();
  usePresence.setState({ name: "" });
  setPointer(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the colours people are shown in", () => {
  it("are a fixed list of plain colours, all different, on each of which white text can be read", () => {
    expect(PRESENCE_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PRESENCE_COLORS).size).toBe(PRESENCE_COLORS.length);
    for (const color of PRESENCE_COLORS) {
      expect(color, color).toMatch(/^#[0-9a-f]{6}$/);
      expect(isPlainColor(color)).toBe(true);
      expect(contrastRatio(color, "#ffffff"), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("are chosen by the number the server gave a connection, round and round, whatever that number is", () => {
    expect(colorOf(0)).toBe(PRESENCE_COLORS[0]);
    expect(colorOf(PRESENCE_COLORS.length + 2)).toBe(PRESENCE_COLORS[2]);
    expect(PRESENCE_COLORS).toContain(colorOf(Number.MAX_SAFE_INTEGER));
  });
});

describe("the people who are here", () => {
  it("are listed as they are heard of, in the order of their numbers, each with a name to show and a colour", () => {
    heardPresence(heard(7, { name: "Bo" }), 1000);
    heardPresence(heard(3, { name: "" }), 1000);
    expect(people().map((p) => [p.peer, p.name, p.color])).toEqual([
      [3, "Guest 3", colorOf(3)],
      [7, "Bo", colorOf(7)],
    ]);
  });

  it("are kept as they were last heard", () => {
    heardPresence(heard(3, { pointer: { x: 1, y: 1 } }), 1000);
    heardPresence(heard(3, { pointer: null, selection: ["a"], editing: "t" }), 2000);
    expect(people()).toEqual([{ peer: 3, name: "Ana", color: colorOf(3), page: "p", pointer: null, selection: ["a"], editing: "t", heard: 2000 }]);
  });

  it("are taken off the list when the server says they have gone", () => {
    heardPresence(heard(3), 1000);
    heardPresence(heard(4), 1000);
    heardPresence({ t: "presence", peer: 3, gone: true }, 1500);
    heardPresence({ t: "presence", peer: 99, gone: true }, 1500); // somebody nobody heard of
    expect(people().map((p) => p.peer)).toEqual([4]);
  });

  it("are taken off the list when they have not been heard of for a while, and only then", () => {
    heardPresence(heard(3), 1000);
    heardPresence(heard(4), 5000);
    const before = people();
    forgetStale(1000 + PRESENCE_STALE_MS);
    expect(people()).toBe(before); // nothing changed, so nothing is drawn again
    forgetStale(1001 + PRESENCE_STALE_MS);
    expect(people().map((p) => p.peer)).toEqual([4]);
  });

  it("are all forgotten when the connection is", () => {
    heardPresence(heard(3), 1000);
    clearPresence();
    expect(people()).toEqual([]);
    expect(usePresence.getState().me).toBeNull();
  });
});

describe("the name this person gave", () => {
  it("is kept on this device as a name that may be said, and read back", () => {
    expect(savedName()).toBe("");
    expect(saveName("  Ana\tMaría  ")).toBe("Ana María");
    expect(savedName()).toBe("Ana María");
    expect(usePresence.getState().name).toBe("Ana María");
    expect(saveName("x".repeat(90))).toHaveLength(40);
  });

  it("read back from a storage that somebody else wrote to is cleaned again", () => {
    localStorage.setItem("craftly.live.name", `Ana‮${"x".repeat(100)}`);
    expect(savedName()).toBe(`Ana${"x".repeat(37)}`);
  });

  it("is still used for this visit when the device cannot keep it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(saveName("Ana")).toBe("Ana");
    expect(usePresence.getState().name).toBe("Ana");
    expect(savedName()).toBe("");
  });

  it("is shown with a word for a person who gave none", () => {
    expect(shownName("", 4)).toBe("Guest 4");
    expect(shownName("Ana", 4)).toBe("Ana");
  });
});

describe("what is said about this person", () => {
  let said: PresenceState[];
  let stop: () => void;
  let accept: boolean;
  const begin = () => {
    vi.useFakeTimers();
    const design = chromeDesign("Shared");
    actions().openDesign(design);
    said = [];
    accept = true;
    stop = startPresence((state) => {
      if (accept) said.push(state);
      return accept;
    }, 5);
    return design;
  };
  afterEach(() => stop?.());

  it("starts with where they are now: their name, the open page, what is selected, and no pointer", () => {
    saveName("Ana");
    const design = begin();
    expect(usePresence.getState().me).toBe(5);
    expect(said).toEqual([{ name: "Ana", page: design.pages[0].id, pointer: null, selection: [], editing: null }]);
  });

  it("follows the pointer, but not more often than a pointer is worth: the place it is at when the time has come is the one said", () => {
    begin();
    for (let i = 1; i <= 20; i++) setPointer({ x: i, y: i });
    expect(said).toHaveLength(1); // the first word was just said
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said).toHaveLength(2);
    expect(said[1].pointer).toEqual({ x: 20, y: 20 });
    setPointer({ x: 21, y: 21 });
    vi.advanceTimersByTime(SAY_EVERY_MS - 1);
    expect(said).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(said[2].pointer).toEqual({ x: 21, y: 21 });
    // a second of steady movement is no more than a second's worth of messages
    for (let ms = 0; ms < 1000; ms += 5) {
      setPointer({ x: ms, y: 0 });
      vi.advanceTimersByTime(5);
    }
    expect(said.length - 3).toBeLessThanOrEqual(Math.ceil(1000 / SAY_EVERY_MS));
    expect(1000 / SAY_EVERY_MS).toBeLessThanOrEqual(15);
  });

  it("says a place to a tenth of a pixel, and says nothing when the pointer has not really moved", () => {
    begin();
    setPointer({ x: 10.04, y: 3.96 });
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said.at(-1)?.pointer).toEqual({ x: 10, y: 4 });
    setPointer({ x: 10.01, y: 4.02 });
    vi.advanceTimersByTime(SAY_EVERY_MS * 3);
    expect(said).toHaveLength(2);
  });

  it("says once that the pointer has left the canvas", () => {
    begin();
    setPointer({ x: 1, y: 1 });
    vi.advanceTimersByTime(SAY_EVERY_MS);
    setPointer(null);
    setPointer(null);
    vi.advanceTimersByTime(SAY_EVERY_MS * 3);
    expect(said.map((s) => s.pointer)).toEqual([null, { x: 1, y: 1 }, null]);
  });

  it("says that the pointer is gone while the tab is hidden, and where it is again when the tab is back", () => {
    begin();
    setPointer({ x: 1, y: 1 });
    vi.advanceTimersByTime(SAY_EVERY_MS);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said.at(-1)?.pointer).toBeNull();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said.at(-1)?.pointer).toEqual({ x: 1, y: 1 });
  });

  it("says what is selected, on which page, and no more of a selection than may be said", () => {
    const design = begin();
    const ids = actions().addElements([createShape("rect"), createShape("ellipse")], { select: false });
    actions().select(ids);
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said.at(-1)).toMatchObject({ page: design.pages[0].id, selection: ids });
    actions().addPage();
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said.at(-1)?.page).toBe(useEditor.getState().activePageId);
    expect(said.at(-1)?.page).not.toBe(design.pages[0].id);
    expect(said.at(-1)?.selection).toEqual([]);
    // far more than may be said, and one with an id that is too long to be said
    const many = Array.from({ length: PRESENCE_SELECTION_MAX + 20 }, (_, i) => `e${i}`);
    useEditor.setState({ selection: ["x".repeat(PRESENCE_ID_MAX + 1), ...many] });
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said.at(-1)?.selection).toEqual(many.slice(0, PRESENCE_SELECTION_MAX));
  });

  it("says at once that this person starts to type in a text box, and at once that they stopped", () => {
    begin();
    const [id] = actions().addElements([createText({ text: "Hello" })], { select: false });
    vi.advanceTimersByTime(SAY_EVERY_MS);
    const before = said.length;
    setPointer({ x: 5, y: 5 }); // (something else is waiting to be said: it goes along)
    actions().startTextEdit(id);
    expect(said).toHaveLength(before + 1);
    expect(said.at(-1)).toMatchObject({ editing: id, selection: [id], pointer: { x: 5, y: 5 } });
    actions().endTextEdit();
    expect(said).toHaveLength(before + 2);
    expect(said.at(-1)?.editing).toBeNull();
    vi.advanceTimersByTime(SAY_EVERY_MS * 2);
    expect(said).toHaveLength(before + 2); // what waited was said with it, and is not said again
  });

  it("says a new name when the person changes it", () => {
    begin();
    saveName("Ana");
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said.at(-1)?.name).toBe("Ana");
  });

  it("repeats itself every few seconds while nothing changes, so that the others know this person is still here", () => {
    begin();
    vi.advanceTimersByTime(REPEAT_EVERY_MS - 1);
    expect(said).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(said).toHaveLength(2);
    expect(said[1]).toEqual(said[0]);
    vi.advanceTimersByTime(REPEAT_EVERY_MS * 3);
    expect(said).toHaveLength(5);
    expect(REPEAT_EVERY_MS * 3).toBeLessThan(PRESENCE_STALE_MS); // two may go missing before anybody is taken for gone
  });

  it("forgets the people it has not heard of for a while as time goes by", () => {
    begin();
    heardPresence(heard(3), Date.now());
    vi.advanceTimersByTime(PRESENCE_STALE_MS + REPEAT_EVERY_MS);
    expect(people()).toEqual([]);
  });

  it("says again, when it can, what could not be said", () => {
    begin();
    accept = false;
    setPointer({ x: 9, y: 9 });
    vi.advanceTimersByTime(SAY_EVERY_MS);
    expect(said).toHaveLength(1);
    accept = true;
    vi.advanceTimersByTime(REPEAT_EVERY_MS);
    expect(said.at(-1)?.pointer).toEqual({ x: 9, y: 9 });
  });

  it("says nothing more once it is stopped, and this person has no number then", () => {
    begin();
    stop();
    setPointer({ x: 1, y: 1 });
    actions().addPage();
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(REPEAT_EVERY_MS * 4);
    expect(said).toHaveLength(1);
    expect(usePresence.getState().me).toBeNull();
  });

  it("says nothing while no design is open", () => {
    vi.useFakeTimers();
    resetEditor();
    said = [];
    stop = startPresence((state) => said.push(state) > 0, 5);
    vi.advanceTimersByTime(REPEAT_EVERY_MS);
    expect(said).toEqual([]);
  });
});
