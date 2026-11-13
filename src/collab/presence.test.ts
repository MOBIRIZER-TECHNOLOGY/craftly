/**
 * Presence: where a person's pointer is, what they have selected and which text they type in. It is said many times a second and
 * kept nowhere, and it is read as strictly as everything else that arrives, on both ends.
 */
import { describe, expect, it } from "vitest";
import { checkPresence, cleanName, parsePresence, PRESENCE_COORD_MAX, PRESENCE_ID_MAX, PRESENCE_NAME_MAX, PRESENCE_SELECTION_MAX, type PresenceState } from "./presence";
import { parseServerMsg } from "./protocol";

const state = (over: Partial<PresenceState> = {}): PresenceState => ({ name: "Ana", page: "p", pointer: { x: 10, y: 20.5 }, selection: ["a", "b"], editing: null, ...over });
const said = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ t: "presence", ...state(), ...over });
const without = (key: string): Record<string, unknown> => {
  const { [key]: _gone, ...rest } = said();
  return rest;
};

describe("checkPresence: what a browser says about where it is", () => {
  it("accepts a pointer on a page with a selection, and gives back only the state", () => {
    expect(checkPresence(said())).toEqual(state());
  });

  it("accepts a person with no name yet, no pointer on the canvas, nothing selected and a text they type in", () => {
    const quiet = state({ name: "", page: null, pointer: null, selection: [], editing: "t" });
    expect(checkPresence(said({ ...quiet }))).toEqual(quiet);
  });

  it("accepts a name in any script, and as long as a name may be", () => {
    expect(checkPresence(said({ name: "Ærøskøbing 東京 😀" }))).toMatchObject({ name: "Ærøskøbing 東京 😀" });
    expect(checkPresence(said({ name: "x".repeat(PRESENCE_NAME_MAX) }))).toMatchObject({ name: "x".repeat(PRESENCE_NAME_MAX) });
  });

  it("holds a pointer that is far outside any page at the furthest place a pointer may be", () => {
    expect(checkPresence(said({ pointer: { x: 1e300, y: -1e300 } }))).toMatchObject({ pointer: { x: PRESENCE_COORD_MAX, y: -PRESENCE_COORD_MAX } });
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["a list", [said()]],
    ["a name that is not text", said({ name: 5 })],
    ["a name that is too long", said({ name: "x".repeat(PRESENCE_NAME_MAX + 1) })],
    ["a name with a line break in it", said({ name: "Ana\nBob" })],
    ["a name with a character that turns the text around", said({ name: "Ana‮gnp.exe" })],
    ["no name", without("name")],
    ["a page that is a number", said({ page: 5 })],
    ["a page with an empty id", said({ page: "" })],
    ["a page with an id that is too long", said({ page: "p".repeat(PRESENCE_ID_MAX + 1) })],
    ["no page", without("page")],
    ["a pointer that is a list", said({ pointer: [1, 2] })],
    ["a pointer with a place that is text", said({ pointer: { x: "1", y: 2 } })],
    ["a pointer with a place that is not a number at all", said({ pointer: { x: NaN, y: 2 } })],
    ["a pointer with a place that is without end", said({ pointer: { x: 1, y: Infinity } })],
    ["a pointer with more than a place", said({ pointer: { x: 1, y: 2, z: 3 } })],
    ["a pointer with half a place", said({ pointer: { x: 1 } })],
    ["no pointer", without("pointer")],
    ["a selection that is text", said({ selection: "a" })],
    ["a selection with something that is not an id", said({ selection: ["a", 5] })],
    ["a selection with an id that is too long", said({ selection: ["a".repeat(PRESENCE_ID_MAX + 1)] })],
    ["a selection of more than may be said", said({ selection: Array.from({ length: PRESENCE_SELECTION_MAX + 1 }, (_, i) => `e${i}`) })],
    ["no selection", without("selection")],
    ["a text being typed in that is not an id", said({ editing: {} })],
    ["no word about a text being typed in", without("editing")],
    ["a field that presence does not have", said({ color: "url(https://evil.test/)" })],
    ["a number of its own, which only the server gives", said({ peer: 1 })],
  ])("refuses %s", (_what, value) => {
    expect(typeof checkPresence(value)).toBe("string");
  });

  it("accepts a selection of exactly as many as may be said", () => {
    const many = Array.from({ length: PRESENCE_SELECTION_MAX }, (_, i) => `e${i}`);
    expect(checkPresence(said({ selection: many }))).toMatchObject({ selection: many });
  });
});

describe("parsePresence: what a server says about the others", () => {
  it("accepts the state of a person with the number the server gave them", () => {
    expect(parsePresence({ ...said(), peer: 3 })).toEqual({ t: "presence", peer: 3, ...state() });
  });

  it("accepts the word that a person has gone", () => {
    expect(parsePresence({ t: "presence", peer: 3, gone: true })).toEqual({ t: "presence", peer: 3, gone: true });
  });

  it.each<[string, unknown]>([
    ["a state with no number", said()],
    ["a number that is text", { ...said(), peer: "3" }],
    ["a number below nothing", { ...said(), peer: -1 }],
    ["a number that is half", { ...said(), peer: 1.5 }],
    ["a state that also says gone", { ...said(), peer: 3, gone: true }],
    ["gone that is not simply true", { t: "presence", peer: 3, gone: "yes" }],
    ["gone with more beside it", { t: "presence", peer: 3, gone: true, name: "Ana" }],
    ["a colour, which is never taken from the wire", { ...said(), peer: 3, color: "red" }],
    ["a name that is markup and far too long", { ...said({ name: "<img src=x onerror=alert(1)>".repeat(3) }), peer: 3 }],
    ["a pointer that is not a place", { ...said({ pointer: { x: null, y: 1 } }), peer: 3 }],
  ])("refuses %s", (_what, value) => {
    expect(typeof parsePresence(value as Record<string, unknown>)).toBe("string");
  });

  it("is what parseServerMsg reads a presence with: a good one comes back, a bad one is a sentence", () => {
    expect(parseServerMsg({ ...said(), peer: 3 })).toEqual({ t: "presence", peer: 3, ...state() });
    expect(parseServerMsg({ t: "presence", peer: 3, gone: true })).toEqual({ t: "presence", peer: 3, gone: true });
    expect(parseServerMsg({ ...said(), peer: 3, href: "javascript:alert(1)" })).toMatch(/^presence: /);
    expect(parseServerMsg({ t: "presence", who: [] })).toMatch(/^presence: /);
  });
});

describe("cleanName: a name as a person typed it, made into one that may be said", () => {
  it("keeps an ordinary name as it is", () => {
    expect(cleanName("Ana María")).toBe("Ana María");
  });

  it("takes away what is around it, line breaks, and characters that turn text around", () => {
    expect(cleanName("  Ana\n\tBob  ")).toBe("Ana Bob");
    expect(cleanName("Ana‮⁦!")).toBe("Ana!");
  });

  it("cuts a long name to the length a name may have, and never through the middle of a character", () => {
    expect(cleanName("x".repeat(100))).toBe("x".repeat(PRESENCE_NAME_MAX));
    const faces = cleanName("😀".repeat(30));
    expect(faces).toBe("😀".repeat(PRESENCE_NAME_MAX / 2));
    expect(checkPresence(said({ name: faces }))).toMatchObject({ name: faces });
  });

  it("gives a name that passes the check whatever was typed", () => {
    for (const typed of ["", "   ", "\u0000\u0001", "a".repeat(500), "<b>bold</b>", "‏‎"]) expect(checkPresence(said({ name: cleanName(typed) }))).not.toBeTypeOf("string");
  });
});
