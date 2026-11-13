import { afterEach, describe, expect, it, vi } from "vitest";
import { installFontFaces, sfntBytes, type FontFaces } from "@/test/fontFixtures";
import type { CustomFace } from "./fonts";

const data = (seed = 1) => sfntBytes({ weight: seed * 100 }).buffer as ArrayBuffer;

function face(over: Partial<CustomFace> = {}): CustomFace {
  return { id: "f_1", family: "Acme Sans", minWeight: 400, maxWeight: 400, italic: false, format: "ttf", data: data(), ...over };
}

/** A fresh copy of the module (its caches are module state); with `dom` it runs against a stand-in FontFace. */
async function load(dom = true): Promise<{ fonts: typeof import("./fonts"); faces: FontFaces | null }> {
  vi.resetModules();
  const faces = dom ? installFontFaces() : null;
  return { fonts: await import("./fonts"), faces };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uploaded families in the catalogue", () => {
  it("are found by the name the person gave them, with the weights and styles of their files", async () => {
    const { fonts } = await load(false);
    fonts.setCustomFaces([face(), face({ id: "f_2", minWeight: 700, maxWeight: 700 }), face({ id: "f_3", italic: true })]);
    const def = fonts.getFontDef("Acme Sans");
    expect(def).toMatchObject({ family: "Acme Sans", category: "sans", weights: [400, 700], variable: false, italic: true });
    expect(fonts.customFontDefs().map((d) => d.family)).toEqual(["Acme Sans"]);
    expect(fonts.isCustomFamily("Acme Sans")).toBe(true);
    expect(fonts.isCustomFamily("Inter")).toBe(false);
    expect(fonts.snapWeight(def!, 600)).toBe(700);
  });

  it("are registered under a name made of safe characters only, never the text a person typed", async () => {
    const { fonts } = await load(false);
    const odd = 'Odd"; } body { display: none\\';
    fonts.setCustomFaces([face(), face({ id: "f_2", family: odd })]);
    for (const family of ["Acme Sans", odd]) expect(fonts.getFontDef(family)?.css).toMatch(/^Craftly Upload [0-9a-f]{8,}$/);
    expect(fonts.getFontDef(odd)?.css).not.toBe(fonts.getFontDef("Acme Sans")?.css);
    // the same name gives the same registered name on every device and after every reload
    expect(fonts.customFontCss("Acme Sans")).toBe(fonts.getFontDef("Acme Sans")?.css);
  });

  it("write the registered name first and the given name, escaped, as a fallback", async () => {
    const { fonts } = await load(false);
    const odd = 'Odd"; } body { display: none\\';
    fonts.setCustomFaces([face(), face({ id: "f_2", family: odd })]);
    expect(fonts.cssFontFamily("Acme Sans")).toBe(`"${fonts.customFontCss("Acme Sans")}", "Acme Sans", sans-serif`);
    expect(fonts.cssFontFamily(odd)).toBe(`"${fonts.customFontCss(odd)}", "Odd\\"; } body { display: none\\\\", sans-serif`);
  });

  it("cannot take the place of a bundled family, whatever the case of the name", async () => {
    const { fonts } = await load(false);
    const before = fonts.getFontDef("Inter");
    fonts.setCustomFaces([face({ family: "Inter" }), face({ id: "f_2", family: "inter" }), face({ id: "f_3", family: "Inter Variable" }), face({ id: "f_4", family: "  " })]);
    expect(fonts.getFontDef("Inter")).toBe(before);
    expect(fonts.customFontDefs()).toEqual([]);
    expect(fonts.isBundledFamily("POPPINS")).toBe(true);
    expect(fonts.isBundledFamily("Plus Jakarta Sans Variable")).toBe(true);
    expect(fonts.isBundledFamily("Acme Sans")).toBe(false);
  });

  it("list the families by name, and a family of one bold file has that one weight", async () => {
    const { fonts } = await load(false);
    fonts.setCustomFaces([face({ family: "Zeta", minWeight: 700, maxWeight: 700 }), face({ id: "f_2", family: "alpha" })]);
    expect(fonts.customFontDefs().map((d) => d.family)).toEqual(["alpha", "Zeta"]);
    expect(fonts.getFontDef("Zeta")?.weights).toEqual([700]);
    expect(fonts.snapWeight(fonts.getFontDef("Zeta")!, 400)).toBe(700);
  });

  it("describe a variable font by every step of its range", async () => {
    const { fonts } = await load(false);
    fonts.setCustomFaces([face({ minWeight: 200, maxWeight: 800 })]);
    expect(fonts.getFontDef("Acme Sans")).toMatchObject({ variable: true, weights: [200, 300, 400, 500, 600, 700, 800] });
  });

  it("keep the first file when two claim the same weight and style", async () => {
    const { fonts } = await load(false);
    fonts.setCustomFaces([face({ id: "first" }), face({ id: "second" })]);
    expect(fonts.customFaceFor("Acme Sans", 400, false)?.id).toBe("first");
  });

  it("tell every screen when the set of families changes, and forget a family that is taken away", async () => {
    const { fonts } = await load(false);
    const listener = vi.fn();
    fonts.onFontsChange(listener);
    const before = fonts.fontsEpoch();
    fonts.setCustomFaces([face()]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fonts.fontsEpoch()).toBe(before + 1);
    fonts.setCustomFaces([]);
    expect(fonts.getFontDef("Acme Sans")).toBeUndefined();
    expect(fonts.cssFontFamily("Acme Sans")).toBe('"Acme Sans", sans-serif');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("give the file a request resolves to, for the exports that embed fonts", async () => {
    const { fonts } = await load(false);
    fonts.setCustomFaces([face(), face({ id: "f_b", minWeight: 700, maxWeight: 700 }), face({ id: "f_i", italic: true })]);
    expect(fonts.customFaceFor("Acme Sans", 800, false)).toMatchObject({ id: "f_b", css: fonts.customFontCss("Acme Sans") });
    expect(fonts.customFaceFor("Acme Sans", 400, true)?.id).toBe("f_i");
    // there is no bold italic file: the upright bold one is used and the browser slants it
    expect(fonts.customFaceFor("Acme Sans", 700, true)?.id).toBe("f_b");
    expect(fonts.customFaceFor("Inter", 400, false)).toBeNull();
    expect(fonts.customFaceFor("Nothing", 400, false)).toBeNull();
  });
});

describe("a family name inside a CSS font list", () => {
  it("cannot end the quoted name or start a new line", async () => {
    const { fonts } = await load(false);
    expect(fonts.cssFontFamily('a"b')).toBe('"a\\"b", sans-serif');
    expect(fonts.cssFontFamily("a\nb\u0000c")).toBe('"a b c", sans-serif');
    expect(fonts.cssFontFamily("a\\")).toBe('"a\\\\", sans-serif');
  });
});

describe("loading the faces of an uploaded family", () => {
  it("hands the bytes to FontFace under the registered name, with the weight and style of the file", async () => {
    const { fonts, faces } = await load();
    const bold = face({ id: "f_2", minWeight: 700, maxWeight: 700, italic: true, data: data(7) });
    fonts.setCustomFaces([face(), face({ id: "f_3", minWeight: 700, maxWeight: 700 }), bold]);
    await fonts.ensureFont("Acme Sans", 700, true);
    expect(faces!.made).toHaveLength(1);
    expect(faces!.made[0].family).toBe(fonts.customFontCss("Acme Sans"));
    expect(faces!.made[0].source).toBe(bold.data);
    expect(faces!.made[0].descriptors).toEqual({ weight: "700", style: "italic" });
    expect(faces!.registered.has(faces!.made[0])).toBe(true);
    expect(fonts.isFontReady("Acme Sans", 700, true)).toBe(true);
    expect(fonts.isFontReady("Acme Sans", 400)).toBe(false);
  });

  it("registers a variable font with its range", async () => {
    const { fonts, faces } = await load();
    fonts.setCustomFaces([face({ minWeight: 200, maxWeight: 800 })]);
    await fonts.ensureFont("Acme Sans", 500);
    expect(faces!.made[0].descriptors).toEqual({ weight: "200 800", style: "normal" });
  });

  it("loads every face of a family for the font list", async () => {
    const { fonts, faces } = await load();
    fonts.setCustomFaces([face(), face({ id: "f_2", minWeight: 700, maxWeight: 700 })]);
    await fonts.preloadFonts(["Acme Sans"]);
    expect(faces!.made.map((f) => f.descriptors.weight)).toEqual(["400", "700"]);
  });

  it("does not load a file again when the list is set again with the same files", async () => {
    const { fonts, faces } = await load();
    fonts.setCustomFaces([face()]);
    await fonts.ensureFont("Acme Sans");
    fonts.setCustomFaces([face(), face({ id: "f_2", family: "Other" })]);
    await fonts.ensureFont("Acme Sans");
    expect(faces!.made).toHaveLength(1);
    expect(faces!.registered.size).toBe(1);
  });

  it("takes the face of a deleted file out of the document", async () => {
    const { fonts, faces } = await load();
    fonts.setCustomFaces([face()]);
    await fonts.ensureFont("Acme Sans");
    expect(faces!.registered.size).toBe(1);
    fonts.setCustomFaces([]);
    expect(faces!.registered.size).toBe(0);
    expect(fonts.isFontReady("Acme Sans")).toBe(true);
  });

  it("takes the face out as well when the file is deleted while it loads", async () => {
    const { fonts, faces } = await load();
    fonts.setCustomFaces([face()]);
    const loading = fonts.ensureFont("Acme Sans");
    fonts.setCustomFaces([]);
    await loading;
    expect(faces!.registered.size).toBe(0);
  });

  it("uses the fallback, with a note in the console, when a stored file does not load", async () => {
    const { fonts, faces } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fonts.setCustomFaces([face()]);
    faces!.failing.add(fonts.customFontCss("Acme Sans"));
    await expect(fonts.ensureFont("Acme Sans")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fonts.isFontReady("Acme Sans")).toBe(true);
    expect(faces!.registered.size).toBe(0);
  });
});

describe("while the uploaded fonts are still being read from storage", () => {
  it("a family that is not bundled is not ready, and waiting for it waits for the read", async () => {
    const { fonts, faces } = await load();
    let finish: () => void = () => undefined;
    fonts.trackCustomFonts(
      new Promise<void>((resolve) => {
        finish = () => {
          fonts.setCustomFaces([face()]);
          resolve();
        };
      }),
    );
    expect(fonts.isFontReady("Acme Sans")).toBe(false);
    expect(fonts.isFontReady("Inter")).toBe(false); // bundled, and simply not loaded yet
    let done = false;
    const waiting = fonts.ensureFont("Acme Sans", 400).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await waiting;
    expect(faces!.made.map((f) => f.family)).toEqual([fonts.customFontCss("Acme Sans")]);
    expect(fonts.isFontReady("Acme Sans")).toBe(true);
  });

  it("a family that turns out not to be there is ready afterwards: nothing waits for it for ever", async () => {
    const { fonts, faces } = await load();
    fonts.trackCustomFonts(Promise.reject(new Error("storage is closed")));
    expect(fonts.isFontReady("Gone")).toBe(false);
    await fonts.ensureFont("Gone");
    expect(fonts.isFontReady("Gone")).toBe(true);
    expect(faces!.made).toHaveLength(0);
  });

  it("nothing waits where fonts cannot be loaded at all", async () => {
    const { fonts } = await load(false);
    fonts.trackCustomFonts(new Promise(() => undefined));
    expect(fonts.isFontReady("Acme Sans")).toBe(true);
    await expect(fonts.ensureFont("Acme Sans")).resolves.toBeUndefined();
  });
});
