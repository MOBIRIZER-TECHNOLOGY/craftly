import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCustomFont, deleteCustomFamily, missingFontsOf, startCustomFonts } from "@/core/customFonts";
import { createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { setCustomFaces } from "@/render/fonts";
import { openElements } from "@/test/ctxUtils";
import { fontFileOf, installFontFaces, removeFontFaces, sfntBytes } from "@/test/fontFixtures";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { toast } from "@/ui";
import { installMissingFontNotice, missingFontMessage } from "./missingFontNotice";

let stop: () => void = () => undefined;
let said: string[];

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  installFontFaces();
  setCustomFaces([]);
  said = [];
  vi.spyOn(toast, "info").mockImplementation((message) => {
    said.push(String(message));
    return 0 as unknown as ReturnType<typeof toast.info>;
  });
});

afterEach(() => {
  stop();
  setCustomFaces([]);
  removeFontFaces();
});

const text = (fontFamily: string) => createText({ text: "x", fontFamily });
const upload = (family: string) => addCustomFont(fontFileOf(`${family}.ttf`, sfntBytes({ family })));
/** Long enough for the notice, which waits a moment (5 ms here) after the last change. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const start = () => (stop = installMissingFontNotice({ delay: 5 }));

describe("the fonts a design names that are not on this device", () => {
  it("are the ones that are neither bundled nor uploaded", async () => {
    await upload("Acme Sans");
    const design = openElements([text("Inter"), text("Acme Sans"), text("Ghost Grotesk"), text("Ghost Grotesk"), text("Other")]);
    expect(missingFontsOf(design)).toEqual(["Ghost Grotesk", "Other"]);
  });
});

describe("the words of the notice", () => {
  it("name one font", () => {
    expect(missingFontMessage(["Ghost Grotesk"])).toBe(
      "The font “Ghost Grotesk” is not on this device, so its text is shown in a substitute font. The design is not changed. If you have the font, upload it under Brand > Your fonts.",
    );
  });

  it("name up to three fonts and count the rest", () => {
    expect(missingFontMessage(["A", "B"])).toContain("The fonts “A” and “B” are not on this device, so their text is shown in a substitute font.");
    expect(missingFontMessage(["A", "B", "C"])).toContain("The fonts “A”, “B” and “C” are not on this device");
    expect(missingFontMessage(["A", "B", "C", "D", "E"])).toContain("The fonts “A”, “B”, “C” and 2 more are not on this device");
  });
});

describe("telling the person about them in the editor", () => {
  it("says once which font of the open design is missing", async () => {
    openElements([text("Inter"), text("Ghost Grotesk")]);
    start();
    await settle();
    expect(said).toEqual([missingFontMessage(["Ghost Grotesk"])]);
    // an edit that brings no new missing font says nothing more
    useEditor.getState().actions.addElement(text("Ghost Grotesk"));
    await settle();
    expect(said).toHaveLength(1);
  });

  it("says nothing about bundled fonts and uploaded ones, which it waits to have read", async () => {
    await upload("Acme Sans");
    // a new page: the uploaded fonts are in the library and not known yet
    setCustomFaces([]);
    openElements([text("Inter"), text("Acme Sans")]);
    let read: () => void = () => undefined;
    stop = installMissingFontNotice({ delay: 5, ready: new Promise<void>((resolve) => (read = resolve)) });
    await settle();
    expect(said).toEqual([]);
    await startCustomFonts(true);
    read();
    await settle();
    expect(said).toEqual([]);
  });

  it("does speak once the fonts were read and one is not among them", async () => {
    openElements([text("Ghost Grotesk")]);
    let read: () => void = () => undefined;
    stop = installMissingFontNotice({ delay: 5, ready: new Promise<void>((resolve) => (read = resolve)) });
    await settle();
    expect(said).toEqual([]);
    read();
    await settle();
    expect(said).toEqual([missingFontMessage(["Ghost Grotesk"])]);
  });

  it("says so when somebody else in a shared design uses a font this device does not have", async () => {
    openElements([text("Inter")]);
    start();
    await settle();
    expect(said).toEqual([]);
    // what arrives from the other person is an edit of the open design like any other
    useEditor.getState().actions.addElement(text("Their Font"));
    await settle();
    expect(said).toEqual([missingFontMessage(["Their Font"])]);
    useEditor.getState().actions.addElement(text("Another"));
    await settle();
    expect(said).toEqual([missingFontMessage(["Their Font"]), missingFontMessage(["Another"])]);
  });

  it("says so when a font the open design uses is deleted", async () => {
    await upload("Acme Sans");
    openElements([text("Acme Sans")]);
    start();
    await settle();
    expect(said).toEqual([]);
    await deleteCustomFamily("Acme Sans");
    await settle();
    expect(said).toEqual([missingFontMessage(["Acme Sans"])]);
  });

  it("starts over for another design", async () => {
    openElements([text("Ghost Grotesk")]);
    start();
    await settle();
    openElements([text("Ghost Grotesk")]);
    await settle();
    expect(said).toHaveLength(2);
  });

  it("looks once after a burst of edits, not after each", async () => {
    openElements([text("Inter")]);
    start();
    await settle();
    for (const family of ["A", "B", "C"]) useEditor.getState().actions.addElement(text(family));
    await settle();
    expect(said).toEqual([missingFontMessage(["A", "B", "C"])]);
  });

  it("adds no error of its own to a design that is damaged", async () => {
    start();
    useEditor.setState({ design: { id: "d_bad", pages: [{ id: "p" }] } as unknown as Design });
    await settle();
    expect(said).toEqual([]);
  });

  it("says nothing more once it was stopped", async () => {
    openElements([text("Inter")]);
    start();
    await settle();
    stop();
    useEditor.getState().actions.addElement(text("Late"));
    await settle();
    expect(said).toEqual([]);
  });
});
