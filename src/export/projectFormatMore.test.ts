import { CURRENT_DESIGN_VERSION } from "@/core/schema/design";
import { describe, expect, it } from "vitest";
import { createChart, createDesign, createGraphic, createGroup, createImage, createLine, createPage, createShape, createTable, createText, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import {
  buildProjectFile,
  dataUrlToBytes,
  extensionForMime,
  isUsableElement,
  mimeOfDataUrl,
  parseProjectFile,
  parseStoredDesign,
  ProjectFileError,
  projectFileName,
  serializeProjectFile,
  type ProjectAsset,
} from "./projectFormat";

const design = (pages = [createPage({ id: "p1" })]): Design => createDesign({ title: "T", width: 400, height: 300, pages });
const parse = (patch: (raw: Record<string, unknown>) => void, d: Design = design()) => {
  const raw = JSON.parse(serializeProjectFile(buildProjectFile(d, {}))) as Record<string, unknown>;
  patch(raw);
  return parseProjectFile(JSON.stringify(raw));
};

describe("which elements a project file may contain", () => {
  it("accepts every kind of element the editor makes", () => {
    const elements = [
      createText({ text: "x" }),
      createShape("rect"),
      createLine(),
      createImage({ src: "https://example.test/a.png" }),
      createImage({ src: null }),
      // (with a closing tag: the factory adds a namespace to the opening one, which makes no sense of a root that closes itself)
      createGraphic({ svg: `<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>` }),
      createGroup([createShape("rect")]),
      createTable(),
      createChart(),
    ];
    for (const el of elements) expect(isUsableElement(JSON.parse(JSON.stringify(el))), el.type).toBe(true);
  });

  it("refuses what would crash the painter", () => {
    const base = JSON.parse(JSON.stringify(createShape("rect")));
    const bad: unknown[] = [
      null,
      "text",
      [],
      { ...base, id: 5 },
      { ...base, type: "video" },
      { ...base, x: "1" },
      { ...base, opacity: Number.NaN },
      { ...base, shape: 3 },
      { ...JSON.parse(JSON.stringify(createText({ text: "x" }))), paragraphs: "x" },
      { ...JSON.parse(JSON.stringify(createLine())), stroke: null },
      { ...JSON.parse(JSON.stringify(createImage({ src: "a.png" }))), mask: 1 },
      { ...JSON.parse(JSON.stringify(createImage({ src: "a.png" }))), src: 5 },
      { ...JSON.parse(JSON.stringify(createGraphic({ svg: `<svg viewBox="0 0 1 1"/>` }))), colors: null },
      { ...JSON.parse(JSON.stringify(createGroup([]))), children: {} },
      { ...JSON.parse(JSON.stringify(createTable())), cells: null },
      { ...JSON.parse(JSON.stringify(createChart())), palette: [] },
    ];
    for (const el of bad) expect(isUsableElement(el), JSON.stringify(el)?.slice(0, 60)).toBe(false);
  });

  it("drops unusable elements from a page, and from inside groups, instead of failing", () => {
    const group = createGroup([createShape("rect", { id: "ok" }), createShape("rect", { id: "bad" })], { id: "g" });
    const file = parse(
      (raw) => {
        const pages = (raw.design as { pages: Array<{ elements: Array<Record<string, unknown>> }> }).pages;
        pages[0].elements.push({ id: "junk", type: "nope" });
        (pages[0].elements[0].children as Array<Record<string, unknown>>)[1].x = "left";
      },
      design([createPage({ id: "p1", elements: [group] })]),
    );
    const elements = file.design.pages[0].elements;
    expect(elements.map((e) => e.id)).toEqual(["g"]);
    expect((elements[0] as { children: Array<{ id: string }> }).children.map((c) => c.id)).toEqual(["ok"]);
  });
});

describe("reading a project file", () => {
  it("keeps the name and notes of a page, and leaves them out when they are not text", () => {
    const keep = parse((raw) => {
      const page = (raw.design as { pages: Array<Record<string, unknown>> }).pages[0];
      page.name = "Cover";
      page.notes = "Say hi";
    });
    expect(keep.design.pages[0]).toMatchObject({ name: "Cover", notes: "Say hi" });
    const drop = parse((raw) => {
      const page = (raw.design as { pages: Array<Record<string, unknown>> }).pages[0];
      page.name = 5;
      page.notes = { text: "x" };
    });
    expect(drop.design.pages[0]).not.toHaveProperty("name");
    expect(drop.design.pages[0]).not.toHaveProperty("notes");
  });

  it("keeps the unit of the design when it is one of the known ones, and uses pixels otherwise", () => {
    for (const unit of ["in", "mm", "cm", "px"]) expect(parse((raw) => ((raw.design as Record<string, unknown>).unit = unit)).design.unit).toBe(unit);
    expect(parse((raw) => ((raw.design as Record<string, unknown>).unit = "furlongs")).design.unit).toBe("px");
    expect(parse((raw) => delete (raw.design as Record<string, unknown>).unit).design.unit).toBe("px");
  });

  it("replaces a page background it does not know with white", () => {
    const file = parse((raw) => {
      const page = (raw.design as { pages: Array<Record<string, unknown>> }).pages[0];
      page.background = { type: "hologram" };
    });
    expect(file.design.pages[0].background).toEqual(solid("#ffffff"));
  });

  it("describes images that lack a name, a type or a size", () => {
    const file = parseProjectFile(
      JSON.stringify({
        craftly: 1,
        design: JSON.parse(JSON.stringify(design())),
        assets: {
          none: { dataUrl: "data:image/webp;base64,AAAA" },
          odd: { dataUrl: "data:;base64,AAAA", name: "", mime: "", width: "wide", height: null },
          full: { dataUrl: "data:image/png;base64,AAAA", name: "Logo", mime: "image/png", width: 10, height: 20 },
          bad: { dataUrl: "not a data address" },
          notAnObject: 5,
        },
      }),
    );
    expect(Object.keys(file.assets)).toEqual(["none", "odd", "full"]);
    expect(file.assets.none).toEqual({ name: "Image", mime: "image/webp", width: 0, height: 0, dataUrl: "data:image/webp;base64,AAAA" });
    expect(file.assets.odd).toMatchObject({ name: "Image", mime: "image/png", width: 0, height: 0 });
    expect(file.assets.full).toMatchObject({ name: "Logo", width: 10, height: 20 });
  });

  it("copes with a file that has no assets and no export time", () => {
    const file = parseProjectFile(JSON.stringify({ craftly: 1, design: JSON.parse(JSON.stringify(design())) }));
    expect(file.assets).toEqual({});
    expect(file.exportedAt).toBe(new Date(0).toISOString());
  });
});

describe("data addresses", () => {
  const asset: ProjectAsset = { name: "n", mime: "image/png", width: 1, height: 1, dataUrl: "data:image/png;base64,AAAA" };

  it("reads the mime type, lower case, or none", () => {
    expect(mimeOfDataUrl("data:IMAGE/PNG;base64,AAAA")).toBe("image/png");
    expect(mimeOfDataUrl("data:;base64,AAAA")).toBeNull();
    expect(mimeOfDataUrl("data:,hello")).toBeNull();
    expect(mimeOfDataUrl("https://example.test")).toBeNull();
  });

  it("decodes base64 and percent-encoded data, with the default type text/plain", () => {
    expect(dataUrlToBytes("data:image/png;base64,SGk=")).toEqual({ mime: "image/png", bytes: Uint8Array.of(72, 105) });
    expect(dataUrlToBytes("data:text/plain,Hello%20there")).toMatchObject({ mime: "text/plain" });
    expect(Array.from(dataUrlToBytes("data:,a%20b")!.bytes)).toEqual([97, 32, 98]);
    expect(dataUrlToBytes("data:;base64,SGk=")!.mime).toBe("text/plain");
    expect(dataUrlToBytes("data:IMAGE/SVG+XML;base64,SGk=")!.mime).toBe("image/svg+xml");
    expect(Array.from(dataUrlToBytes("data:image/png;base64,SG k=")!.bytes)).toEqual([72, 105]);
  });

  it("gives up on addresses that are not data addresses, or are damaged", () => {
    expect(dataUrlToBytes("https://example.test/a.png")).toBeNull();
    expect(dataUrlToBytes("data:image/png;base64")).toBeNull();
    expect(dataUrlToBytes("data:image/png;base64,***")).toBeNull();
    expect(dataUrlToBytes("data:text/plain,%E0%A4%A")).toBeNull();
  });

  it("chooses a file extension for a mime type, or guesses one", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("IMAGE/JPEG")).toBe("jpg");
    expect(extensionForMime("image/svg+xml")).toBe("svg");
    expect(extensionForMime("image/x-icon")).toBe("xicon");
    expect(extensionForMime("image/tiff")).toBe("tiff");
    expect(extensionForMime("nonsense")).toBe("png");
    expect(asset.mime).toBe("image/png");
  });

  it("names the project file after the design", () => {
    expect(projectFileName("My: design?")).toBe("My design.craftly");
    expect(projectFileName("  ")).toBe("Untitled design.craftly");
    expect(projectFileName("Trailing dots...")).toBe("Trailing dots.craftly");
    expect(projectFileName(undefined as unknown as string)).toBe("Untitled design.craftly");
  });
});

describe("reading a design the way the library stores it", () => {
  const stored = (patch: (raw: Record<string, unknown>) => void = () => undefined): Record<string, unknown> => {
    const raw = JSON.parse(JSON.stringify(design())) as Record<string, unknown>;
    patch(raw);
    return raw;
  };

  it("keeps the id, the dates and the library data that a project file would reset", () => {
    const raw = stored((r) => Object.assign(r, { id: "d_kept", createdAt: 11, updatedAt: 22, folderId: "f_1", starred: true, trashedAt: 33 }));
    expect(parseStoredDesign(raw)).toMatchObject({
      id: "d_kept",
      title: "T",
      createdAt: 11,
      updatedAt: 22,
      folderId: "f_1",
      starred: true,
      trashedAt: 33,
      version: CURRENT_DESIGN_VERSION,
    });
  });

  it("falls back to the plain values for library data that is not usable", () => {
    const raw = stored((r) => Object.assign(r, { folderId: 5, starred: "yes", trashedAt: "yesterday" }));
    expect(parseStoredDesign(raw)).toMatchObject({ folderId: null, starred: false, trashedAt: null });
  });

  it("still drops what would crash the painter and repairs a page without a background", () => {
    const raw = stored((r) => {
      const page = (r.pages as Array<Record<string, unknown>>)[0];
      page.elements = [{ id: "e", type: "text" }, JSON.parse(JSON.stringify(createShape("rect")))];
      page.background = 7;
    });
    const result = parseStoredDesign(raw);
    expect(result.pages[0].elements.map((el) => el.type)).toEqual(["shape"]);
    expect(result.pages[0].background).toEqual({ type: "solid", color: "#ffffff" });
  });

  it("refuses anything that is not a design", () => {
    for (const value of [null, 5, "text", [], {}, stored((r) => (r.pages = [])), stored((r) => (r.width = 0)), stored((r) => (r.height = "tall"))]) {
      expect(() => parseStoredDesign(value), JSON.stringify(value)?.slice(0, 40)).toThrow(ProjectFileError);
    }
  });
});
