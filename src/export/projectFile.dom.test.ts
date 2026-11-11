import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAssetFromFile, getAsset, listAssets } from "@/core/assets";
import { createDesign, createGroup, createImage, createPage, createShape } from "@/core/factory";
import { getDesign, listDesigns } from "@/core/library";
import type { Asset, Design, GroupElement, ImageElement, ImageFill, ShapeElement } from "@/core/types";
import { wipeDatabase } from "@/test/logicDb";
import { exportProjectFile, importProjectFile, NOT_A_PROJECT_MESSAGE, PROJECT_FILE_EXTENSION, projectFileName, ProjectFileError } from "./projectFile";
import { buildProjectFile, serializeProjectFile, type ProjectAsset } from "./projectFormat";

const held = vi.hoisted(() => ({ assets: new Map<string, import("@/core/types").Asset>() }));

vi.mock("@/core/assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/assets")>();
  return {
    ...actual,
    // the fake database cannot keep a real Blob, so the export reads its pictures from here instead
    getAsset: vi.fn(async (id: string) => held.assets.get(id) ?? null),
    prepareAssetFromFile: vi.fn(actual.prepareAssetFromFile),
  };
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"/>`;

/** An uploaded picture the export can find. */
function hold(id: string, mime: string, content: string, name = id): Asset {
  const asset: Asset = {
    id,
    name,
    kind: mime === "image/svg+xml" ? "svg" : "image",
    mime,
    size: content.length,
    width: 30,
    height: 20,
    createdAt: 1,
    blob: new Blob([content], { type: mime }),
  };
  held.assets.set(id, asset);
  return asset;
}

const dataUrl = (mime: string, content: string) => `data:${mime};base64,${btoa(content)}`;
const imageFill = (src: string): ImageFill => ({ type: "image", src, fit: "cover" });

function holdPictures() {
  hold("bg", "image/svg+xml", SVG, "Backdrop");
  hold("logo", "image/png", "PNGDATA", "Logo");
  hold("photo", "image/jpeg", "JPEGDATA", "Photo");
}

/** A poster that uses a background, a logo three times, a photo as a fill, and a web picture. */
function poster(): Design {
  return createDesign({
    title: "Poster",
    width: 400,
    height: 300,
    pages: [
      createPage({
        background: imageFill("asset:bg"),
        elements: [
          createImage({ src: "asset:logo", width: 40, height: 40 }),
          createImage({ src: "asset:logo", width: 40, height: 40 }),
          createImage({ src: "https://example.test/remote.png", width: 40, height: 40 }),
          createShape("rect", { fill: imageFill("asset:photo") }),
          createGroup([createImage({ src: "asset:logo", width: 10, height: 10 })]),
        ],
      }),
    ],
  });
}

const fileOf = (text: string, name = "poster.craftly") => new File([text], name, { type: "application/json" });
const projectText = (design: Design, assets: Record<string, ProjectAsset> = {}) => serializeProjectFile(buildProjectFile(design, assets));
const projectAsset = (over: Partial<ProjectAsset> = {}): ProjectAsset => ({
  name: "Pic",
  mime: "image/png",
  width: 30,
  height: 20,
  dataUrl: dataUrl("image/png", "PNGDATA"),
  ...over,
});

beforeEach(async () => {
  await wipeDatabase();
  held.assets.clear();
  vi.mocked(getAsset).mockClear();
  vi.mocked(prepareAssetFromFile).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("exporting a project file", () => {
  it("embeds each uploaded picture the design uses once, in the order it is first used", async () => {
    holdPictures();
    hold("unused", "image/png", "UNUSED");
    const blob = await exportProjectFile(poster());
    expect(blob.type).toBe("application/json");
    const file = JSON.parse(await blob.text());
    expect(file.craftly).toBe(1);
    expect(Object.keys(file.assets)).toEqual(["bg", "logo", "photo"]);
    expect(file.assets.logo).toEqual({ name: "Logo", mime: "image/png", width: 30, height: 20, dataUrl: dataUrl("image/png", "PNGDATA") });
    expect(file.assets.bg.dataUrl).toBe(dataUrl("image/svg+xml", SVG));
    expect(file.assets.photo.dataUrl).toBe(dataUrl("image/jpeg", "JPEGDATA"));
  });

  it("asks for each upload only once, however many times the design uses it", async () => {
    holdPictures();
    await exportProjectFile(poster());
    expect(vi.mocked(getAsset).mock.calls.map((call) => call[0])).toEqual(["bg", "logo", "photo"]);
  });

  it("refuses to export a design that points at a deleted upload", async () => {
    holdPictures();
    held.assets.delete("logo");
    await expect(exportProjectFile(poster())).rejects.toThrow(/uploaded image is missing/);
  });

  it("leaves the library details (folder, star, trash) out of the file", async () => {
    holdPictures();
    const filed: Design = { ...poster(), folderId: "f1", starred: true, trashedAt: 99 };
    const file = JSON.parse(await (await exportProjectFile(filed)).text());
    expect(file.design).toMatchObject({ title: "Poster", width: 400, height: 300, folderId: null, starred: false, trashedAt: null });
  });

  it("writes an empty picture list for a design with no uploads, without opening the library", async () => {
    const plain = createDesign({ title: "Plain", width: 100, height: 100, pages: [createPage({ elements: [createImage({ src: "builtin:sun", width: 10, height: 10 })] })] });
    const file = JSON.parse(await (await exportProjectFile(plain)).text());
    expect(file.assets).toEqual({});
    expect(getAsset).not.toHaveBeenCalled();
  });

  it("stops with an error rather than write a file that silently lacks a picture", async () => {
    held.assets.set("logo", { ...hold("logo", "image/png", "x"), blob: {} as Blob });
    await expect(exportProjectFile(poster())).rejects.toThrow();
  });
});

describe("importing a project file", () => {
  it("brings a design back, storing its pictures as new uploads and pointing the design at them", async () => {
    holdPictures();
    const original = poster();
    const imported = await importProjectFile(new File([await exportProjectFile(original)], "Poster.craftly"));
    expect(imported.id).not.toBe(original.id);
    expect(imported.id).toMatch(/^d_/);
    expect(imported).toMatchObject({ title: "Poster", width: 400, height: 300 });

    const stored = await listAssets();
    expect(stored.map((a) => a.name).sort()).toEqual(["Backdrop", "Logo", "Photo"]);
    const byName = (name: string) => stored.find((a) => a.name === name)!;
    expect(byName("Logo")).toMatchObject({ mime: "image/png", kind: "image", size: 7 });
    expect(byName("Backdrop")).toMatchObject({ mime: "image/svg+xml", kind: "svg", width: 30, height: 20 });
    expect(byName("Photo")).toMatchObject({ mime: "image/jpeg", kind: "image" });
    for (const old of ["bg", "logo", "photo"]) expect(stored.map((a) => a.id)).not.toContain(old);

    const [page] = imported.pages;
    const [logo, logoAgain, remote, shape, group] = page.elements;
    expect(page.background).toEqual(imageFill(`asset:${byName("Backdrop").id}`));
    expect((logo as ImageElement).src).toBe(`asset:${byName("Logo").id}`);
    expect((logoAgain as ImageElement).src).toBe(`asset:${byName("Logo").id}`);
    expect(((shape as ShapeElement).fill as ImageFill).src).toBe(`asset:${byName("Photo").id}`);
    expect(((group as GroupElement).children[0] as ImageElement).src).toBe(`asset:${byName("Logo").id}`);
    // a picture that pointed to the web is an empty frame now: opening the design must not ask a server for it
    expect((remote as ImageElement).src).toBeNull();
  });

  it("saves the design in the library under its new id", async () => {
    holdPictures();
    const imported = await importProjectFile(new File([await exportProjectFile(poster())], "Poster.craftly"));
    expect(await getDesign(imported.id)).toMatchObject({ id: imported.id, title: "Poster" });
    expect((await listDesigns()).map((summary) => summary.id)).toEqual([imported.id]);
  });

  it("starts the copy fresh: not starred, not filed, not in the trash", async () => {
    const filed: Design = { ...poster(), folderId: "f1", starred: true, trashedAt: 99 };
    holdPictures();
    const { assets } = JSON.parse(await (await exportProjectFile(filed)).text());
    const imported = await importProjectFile(fileOf(JSON.stringify({ craftly: 1, design: filed, assets })));
    expect(imported).toMatchObject({ folderId: null, starred: false, trashedAt: null, version: 1 });
    expect(imported.updatedAt).toBe(imported.createdAt);
  });

  it("makes an independent copy each time the same file is imported", async () => {
    holdPictures();
    const blob = await exportProjectFile(poster());
    const first = await importProjectFile(new File([blob], "a.craftly"));
    const second = await importProjectFile(new File([blob], "b.craftly"));
    expect(second.id).not.toBe(first.id);
    expect((await listDesigns()).map((summary) => summary.id).sort()).toEqual([first.id, second.id].sort());
    const sources = (design: Design) => [(design.pages[0].elements[0] as ImageElement).src, ((design.pages[0].elements[3] as ShapeElement).fill as ImageFill).src];
    expect(sources(first).some((src, i) => src === sources(second)[i])).toBe(false);
    expect(await listAssets()).toHaveLength(6);
  });

  it("names the stored upload after the picture, with an extension that matches its real type", async () => {
    const design = createDesign({ title: "T", width: 100, height: 100, pages: [createPage({ elements: [createImage({ src: "asset:pic", width: 10, height: 10 })] })] });
    // recorded as a PNG, but the data in the file is a JPEG: the data wins
    await importProjectFile(fileOf(projectText(design, { pic: projectAsset({ name: "Sunset", mime: "image/png", dataUrl: dataUrl("image/jpeg", "JPEGDATA") }) })));
    const [upload] = vi.mocked(prepareAssetFromFile).mock.calls[0];
    expect(upload.name).toBe("Sunset.jpg");
    expect(upload.type).toBe("image/jpeg");
    expect(await listAssets()).toMatchObject([{ name: "Sunset", mime: "image/jpeg" }]);
  });

  it("falls back on the recorded type when the data in the file does not say what it is", async () => {
    const design = createDesign({ title: "T", width: 100, height: 100, pages: [createPage({ elements: [createImage({ src: "asset:mark", width: 10, height: 10 })] })] });
    const untyped = `data:;base64,${btoa(SVG)}`;
    await importProjectFile(fileOf(projectText(design, { mark: projectAsset({ name: "Mark", mime: "image/svg+xml", dataUrl: untyped }) })));
    const [upload] = vi.mocked(prepareAssetFromFile).mock.calls[0];
    expect(upload.name).toBe("Mark.svg");
    expect(upload.type).toBe("image/svg+xml");
    // it is read as the vector picture it is, not as plain text
    expect(await listAssets()).toMatchObject([{ name: "Mark", kind: "svg", mime: "image/svg+xml", width: 30, height: 20 }]);
  });

  it("restores the exact bytes of the picture", async () => {
    const design = createDesign({ title: "T", width: 100, height: 100, pages: [createPage({ elements: [createImage({ src: "asset:pic", width: 10, height: 10 })] })] });
    await importProjectFile(fileOf(projectText(design, { pic: projectAsset({ dataUrl: dataUrl("image/png", "\u0000\u0001ABCÿ") }) })));
    const [upload] = vi.mocked(prepareAssetFromFile).mock.calls[0];
    expect(new Uint8Array(await upload.arrayBuffer())).toEqual(Uint8Array.of(0, 1, 65, 66, 67, 255));
  });

  it("reports a damaged picture, writes nothing, and accepts a corrected file on retry", async () => {
    const design = createDesign({
      title: "T",
      width: 100,
      height: 100,
      pages: [createPage({ elements: [createImage({ src: "asset:bad", width: 10, height: 10 }), createImage({ src: "asset:good", width: 10, height: 10 })] })],
    });
    const good = projectAsset({ name: "Good" });
    const text = projectText(design, { bad: projectAsset({ name: "Bad", dataUrl: "data:image/png;base64,***" }), good });
    await expect(importProjectFile(fileOf(text))).rejects.toThrow(/Bad.*try again/);
    expect(await listAssets()).toHaveLength(0);
    expect(await listDesigns()).toHaveLength(0);
    await importProjectFile(fileOf(projectText(design, { bad: projectAsset({ name: "Fixed" }), good })));
    expect(await listAssets()).toHaveLength(2);
    expect(await listDesigns()).toHaveLength(1);
  });

  describe("a file that is not a project", () => {
    it("is refused with the message meant for the person, and nothing is stored", async () => {
      const error = await importProjectFile(fileOf("this is not json")).catch((e) => e);
      expect(error).toBeInstanceOf(ProjectFileError);
      expect(error.message).toBe(NOT_A_PROJECT_MESSAGE);
      expect(prepareAssetFromFile).not.toHaveBeenCalled();
      expect(await listDesigns()).toEqual([]);
    });

    it("is refused when the design in it cannot be used", async () => {
      await expect(importProjectFile(fileOf(JSON.stringify({ craftly: 1, design: { width: 100, height: 100, pages: [] } })))).rejects.toBeInstanceOf(ProjectFileError);
      expect(await listDesigns()).toEqual([]);
    });

    it("is refused, with its own message, when it comes from a newer Craftly", async () => {
      const error = await importProjectFile(fileOf(JSON.stringify({ craftly: 2, design: poster(), assets: {} }))).catch((e) => e);
      expect(error).toBeInstanceOf(ProjectFileError);
      expect(error.message).toContain("newer version of Craftly");
    });
  });
});

describe("what the project file module offers besides export and import", () => {
  it("names a file after its design with the .craftly extension", () => {
    expect(PROJECT_FILE_EXTENSION).toBe(".craftly");
    expect(projectFileName("Poster")).toBe(`Poster${PROJECT_FILE_EXTENSION}`);
    expect(new ProjectFileError().message).toBe(NOT_A_PROJECT_MESSAGE);
  });
});
