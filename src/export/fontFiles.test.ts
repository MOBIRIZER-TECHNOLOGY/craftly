import { describe, expect, it, vi } from "vitest";
import { FONT_CATALOG, getFontDef } from "@/render/fonts";
import { FONT_FILE_FAMILIES, fontFaceKey, fontFile, fontFileUrl } from "./fontFiles";

// This file loads the renderer and the font table, which takes a few seconds when many test files do the same at once:
// give it more time than the defaults so a busy machine does not fail it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe("font file table", () => {
  it("covers exactly the families of the font catalogue", () => {
    expect([...FONT_FILE_FAMILIES].sort()).toEqual(FONT_CATALOG.map((f) => f.family).sort());
  });

  it("resolves a woff2 url for every family, weight and style the catalogue offers", async () => {
    for (const def of FONT_CATALOG) {
      for (const weight of def.weights) {
        const upright = await fontFile(def.family, weight, false);
        expect(upright?.url, `${def.family} ${weight}`).toMatch(/\.woff2$/);
        expect(upright?.css).toBe(def.css);
        expect(upright?.italic).toBe(false);
        expect(upright!.minWeight).toBeLessThanOrEqual(weight);
        expect(upright!.maxWeight).toBeGreaterThanOrEqual(weight);
        const slanted = await fontFile(def.family, weight, true);
        expect(slanted?.url, `${def.family} ${weight} italic`).toMatch(/\.woff2$/);
        // a real italic face exists exactly when the catalogue says so
        expect(slanted?.italic, `${def.family} italic flag`).toBe(def.italic);
      }
    }
  });

  it("uses one file for a whole variable font and one per weight for static fonts", () => {
    expect(fontFaceKey("Plus Jakarta Sans", 300)).toBe(fontFaceKey("Plus Jakarta Sans", 800));
    expect(fontFaceKey("Plus Jakarta Sans", 400, true)).not.toBe(fontFaceKey("Plus Jakarta Sans", 400, false));
    expect(fontFaceKey("Poppins", 400)).not.toBe(fontFaceKey("Poppins", 700));
    // static fonts snap to the nearest weight (ties go to the bolder file), like the loader does
    expect(fontFaceKey("Poppins", 500)).toBe(fontFaceKey("Poppins", 400));
    expect(fontFaceKey("Poppins", 600)).toBe(fontFaceKey("Poppins", 700));
    expect(fontFaceKey("Anton", 900)).toBe(fontFaceKey("Anton", 400));
  });

  it("falls back to the upright file when a font has no italic", async () => {
    expect(getFontDef("Raleway")?.italic).toBe(false);
    const f = await fontFile("Raleway", 400, true);
    expect(f?.italic).toBe(false);
  });

  it("returns null for families that are not bundled", async () => {
    expect(await fontFileUrl("Comic Sans MS")).toBeNull();
    expect(fontFaceKey("Nope")).toBeNull();
  });

  it("reports the weight range descriptors fonts.ts registers", async () => {
    expect(await fontFile("Plus Jakarta Sans", 700)).toMatchObject({ minWeight: 200, maxWeight: 800, italic: false });
    expect(await fontFile("DM Sans", 400)).toMatchObject({ minWeight: 100, maxWeight: 1000 });
    expect(await fontFile("Poppins", 700, true)).toMatchObject({ minWeight: 700, maxWeight: 700, italic: true });
  });
});
