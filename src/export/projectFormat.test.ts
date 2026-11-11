import { describe, expect, it } from "vitest";
import { createChart, createDesign, createGraphic, createGroup, createImage, createLine, createPage, createShape, createTable, createText, solid } from "@/core/factory";
import type { Design, ImageElement, ShapeElement } from "@/core/types";
import {
  MAX_GROUP_DEPTH,
  MAX_TITLE_LENGTH,
  NOT_A_PROJECT_MESSAGE,
  NEWER_PROJECT_MESSAGE,
  ProjectFileError,
  buildProjectFile,
  collectAssetIds,
  dataUrlToBytes,
  extensionForMime,
  isUsableElement,
  mimeOfDataUrl,
  parseProjectFile,
  prepareImportedDesign,
  projectFileName,
  remapAssetSources,
  serializeProjectFile,
  usableElements,
  type ProjectAsset,
} from "./projectFormat";

/** A design touching every place an uploaded image can hide. */
function fakeDesign(): Design {
  const page1 = createPage({ background: { type: "image", src: "asset:bgA", fit: "cover", dim: 0.2 } });
  const photo = createImage({ src: "asset:photo1", x: 0, y: 0, width: 400, height: 300, naturalWidth: 800, naturalHeight: 600 });
  const builtin = createImage({ src: "builtin:sunset-hills", x: 0, y: 0, width: 200, height: 100 });
  const remote = createImage({ src: "https://example.com/pic.png", x: 0, y: 0, width: 200, height: 100 });
  const frame = createImage({ src: null, x: 0, y: 0, width: 100, height: 100 });
  const patterned = createShape("rect", { fill: { type: "image", src: "asset:fillB", fit: "tile" } });
  const nested = createGroup([createImage({ src: "asset:nested", x: 5, y: 5, width: 50, height: 50 }), createGroup([createImage({ src: "asset:photo1", width: 10, height: 10 })])]);
  page1.elements.push(photo, builtin, remote, frame, patterned, nested, createText({ text: "Hello" }));
  const page2 = createPage({ background: solid("#112233") });
  page2.elements.push(createImage({ src: "asset:photo1", width: 50, height: 50 }), createShape("ellipse", { fill: solid("#f00") }));
  const design = createDesign({ title: "Round trip", width: 1200, height: 800, pages: [page1, page2] });
  design.folderId = "folder-1";
  design.starred = true;
  design.trashedAt = 12345;
  return design;
}

const asset = (id: string): ProjectAsset => ({ name: `Image ${id}`, mime: "image/png", width: 10, height: 20, dataUrl: `data:image/png;base64,${btoa(id)}` });

describe("collectAssetIds", () => {
  it("finds uploaded images in backgrounds, elements, groups and fills - once each, in first-use order", () => {
    expect(collectAssetIds(fakeDesign())).toEqual(["bgA", "photo1", "fillB", "nested"]);
  });

  it("ignores builtin, remote, data and empty sources", () => {
    const d = createDesign({ width: 10, height: 10 });
    d.pages[0].elements.push(
      createImage({ src: "builtin:x", width: 5, height: 5 }),
      createImage({ src: "data:image/png;base64,AAAA", width: 5, height: 5 }),
      createImage({ src: null, width: 5, height: 5 }),
    );
    expect(collectAssetIds(d)).toEqual([]);
  });

  it("also finds the original of a cut-out photo, so 'Restore original' survives a saved file", () => {
    const d = createDesign({ width: 10, height: 10 });
    d.pages[0].elements.push(createImage({ src: "asset:cutout", originalSrc: "asset:original", width: 5, height: 5 }), createImage({ src: "asset:other", width: 5, height: 5 }));
    expect(collectAssetIds(d)).toEqual(["cutout", "original", "other"]);
  });

  it("ignores an original that is not an uploaded file", () => {
    const d = createDesign({ width: 10, height: 10 });
    d.pages[0].elements.push(createImage({ src: "asset:cutout", originalSrc: "builtin:sunset-hills", width: 5, height: 5 }));
    expect(collectAssetIds(d)).toEqual(["cutout"]);
  });
});

describe("remapAssetSources", () => {
  it("points a remembered original at its new id as well", () => {
    const d = createDesign({ width: 10, height: 10 });
    d.pages[0].elements.push(createImage({ src: "asset:cutout", originalSrc: "asset:original", width: 5, height: 5 }));
    const out = remapAssetSources(d, { cutout: "NEW1", original: "NEW2" });
    const photo = out.pages[0].elements[0] as ImageElement;
    expect(photo.src).toBe("asset:NEW1");
    expect(photo.originalSrc).toBe("asset:NEW2");
  });

  it("rewrites every reference without touching the input", () => {
    const d = fakeDesign();
    const before = JSON.stringify(d);
    const out = remapAssetSources(d, { bgA: "NEW1", photo1: "NEW2", fillB: "NEW3", nested: "NEW4" });
    expect(JSON.stringify(d)).toBe(before);
    expect(collectAssetIds(out)).toEqual(["NEW1", "NEW2", "NEW3", "NEW4"]);
    const bg = out.pages[0].background;
    expect(bg.type === "image" && bg.src).toBe("asset:NEW1");
    expect(bg.type === "image" && bg.dim).toBe(0.2); // other fill fields survive
    const shape = out.pages[0].elements.find((e) => e.type === "shape") as ShapeElement;
    expect(shape.fill?.type === "image" && shape.fill.src).toBe("asset:NEW3");
    const builtin = out.pages[0].elements.find((e) => e.type === "image" && e.src?.startsWith("builtin:")) as ImageElement;
    expect(builtin.src).toBe("builtin:sunset-hills");
    const remote = out.pages[0].elements.find((e) => e.type === "image" && e.src?.startsWith("https:")) as ImageElement;
    expect(remote.src).toBe("https://example.com/pic.png");
  });

  it("leaves references that are not in the map alone", () => {
    const out = remapAssetSources(fakeDesign(), { photo1: "ONLY" });
    expect(collectAssetIds(out)).toEqual(["bgA", "ONLY", "fillB", "nested"]);
  });
});

describe("build -> serialize -> parse", () => {
  it("round-trips the design and its assets", () => {
    const design = fakeDesign();
    const assets = Object.fromEntries(collectAssetIds(design).map((id) => [id, asset(id)]));
    const file = buildProjectFile(design, assets, new Date("2026-11-04T10:00:00Z"));
    expect(file.craftly).toBe(1);
    expect(file.exportedAt).toBe("2026-11-04T10:00:00.000Z");
    const report = { skipped: 0, remote: 0 };
    const parsed = parseProjectFile(serializeProjectFile(file), report);
    expect(report).toEqual({ skipped: 0, remote: 1 });
    expect(parsed.assets).toEqual(assets);
    expect(parsed.design.title).toBe("Round trip");
    expect(parsed.design.pages).toHaveLength(2);
    // everything comes back as it was, except the one picture that pointed to the web: that is an empty frame, and counted
    expect(parsed.design.pages[0].elements).toEqual(
      design.pages[0].elements.map((el) => (el.type === "image" && el.src === "https://example.com/pic.png" ? { ...el, src: null } : el)),
    );
    expect(parsed.design.pages[0].background).toEqual(design.pages[0].background);
    expect(parsed.design.width).toBe(1200);
  });

  it("does not export library metadata", () => {
    const file = buildProjectFile(fakeDesign(), {});
    expect(file.design).toMatchObject({ folderId: null, starred: false, trashedAt: null });
  });

  it("keeps every element type", () => {
    const d = createDesign({ width: 500, height: 500 });
    d.pages[0].elements.push(
      createText({ text: "t" }),
      createShape("star"),
      createLine({}),
      createImage({ src: "asset:q", width: 1, height: 1 }),
      createGraphic({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></svg>' }),
      createGroup([createShape("rect")]),
      createTable(),
      createChart(),
    );
    const parsed = parseProjectFile(serializeProjectFile(buildProjectFile(d, {})));
    expect(parsed.design.pages[0].elements.map((e) => e.type)).toEqual(["text", "shape", "line", "image", "graphic", "group", "table", "chart"]);
  });

  it("drops assets whose data is not a data URL", () => {
    const file = buildProjectFile(fakeDesign(), { good: asset("good") });
    const text = serializeProjectFile({ ...file, assets: { ...file.assets, bad: { ...asset("bad"), dataUrl: "https://evil.example/x.png" } } });
    expect(Object.keys(parseProjectFile(text).assets)).toEqual(["good"]);
  });
});

describe("validation", () => {
  const msg = (text: string) => {
    try {
      parseProjectFile(text);
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectFileError);
      return (e as Error).message;
    }
    return "no error";
  };

  it("rejects things that are not project files with the documented sentence", () => {
    expect(NOT_A_PROJECT_MESSAGE).toBe("That does not look like a Craftly project file");
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      "42",
      "{}",
      '{"craftly":1}',
      '{"craftly":"1","design":{}}',
      '{"design":{"pages":[]}}',
      '{"craftly":0,"design":{"width":1,"height":1,"pages":[{"elements":[]}]}}',
    ]) {
      expect(msg(bad), bad).toBe(NOT_A_PROJECT_MESSAGE);
    }
  });

  it("rejects designs with impossible sizes or no pages", () => {
    const wrap = (design: unknown) => JSON.stringify({ craftly: 1, design });
    expect(msg(wrap({ width: 0, height: 100, pages: [{ elements: [] }] }))).toBe(NOT_A_PROJECT_MESSAGE);
    expect(msg(wrap({ width: 100, height: "x", pages: [{ elements: [] }] }))).toBe(NOT_A_PROJECT_MESSAGE);
    expect(msg(wrap({ width: 100, height: 100, pages: [] }))).toBe(NOT_A_PROJECT_MESSAGE);
    expect(msg(wrap({ width: 100, height: 100, pages: [{ elements: "no" }] }))).toBe(NOT_A_PROJECT_MESSAGE);
    expect(msg(wrap({ width: 999999, height: 100, pages: [{ elements: [] }] }))).toBe(NOT_A_PROJECT_MESSAGE);
  });

  it("explains files from a newer version", () => {
    expect(msg(JSON.stringify({ craftly: 2, design: { width: 1, height: 1, pages: [{ elements: [] }] } }))).toBe(NEWER_PROJECT_MESSAGE);
  });

  it("repairs a missing page background and fills in defaults", () => {
    const parsed = parseProjectFile(JSON.stringify({ craftly: 1, design: { width: 300, height: 200, pages: [{ elements: [] }] } }));
    expect(parsed.design.pages[0].background).toEqual({ type: "solid", color: "#ffffff" });
    expect(parsed.design.title).toBe("Untitled design");
    expect(parsed.design.typeId).toBe("custom");
    expect(parsed.design.unit).toBe("px");
    expect(parsed.design.pages[0].id).toBeTruthy();
    expect(parsed.assets).toEqual({});
  });

  it("drops elements the renderer could not draw, including inside groups", () => {
    const good = createText({ text: "ok" });
    const brokenText = { ...createText({ text: "x" }), paragraphs: undefined };
    const unknown = { ...createShape("rect"), type: "hologram" };
    const nan = { ...createShape("rect"), width: null };
    const group = createGroup([createShape("rect"), { ...createImage({ src: "asset:z", width: 5, height: 5 }), crop: undefined } as unknown as ImageElement]);
    const d = createDesign({ width: 100, height: 100 });
    d.pages[0].elements.push(good);
    const raw = JSON.parse(serializeProjectFile(buildProjectFile(d, {})));
    raw.design.pages[0].elements.push(brokenText, unknown, nan, group, "string", null);
    const parsed = parseProjectFile(JSON.stringify(raw));
    const els = parsed.design.pages[0].elements;
    expect(els.map((e) => e.type)).toEqual(["text", "group"]);
    expect((els[1] as { children: unknown[] }).children).toHaveLength(1);
  });

  it("isUsableElement checks the fields each type needs", () => {
    expect(isUsableElement(createTable())).toBe(true);
    expect(isUsableElement({ ...createTable(), cells: null })).toBe(false);
    expect(isUsableElement({ ...createChart(), palette: [] })).toBe(false);
    expect(isUsableElement({ ...createLine({}), stroke: null })).toBe(false);
    expect(isUsableElement(undefined)).toBe(false);
  });
});

describe("animation data in project files", () => {
  const rise = {
    in: { kind: "rise", duration: 0.8, delay: 0.2, direction: "up" as const },
    out: { kind: "fade", duration: 0.5, delay: 0 },
    loop: { kind: "breathe", duration: 2.4, delay: 0 },
  };

  const animatedDesign = () => {
    const first = createPage({ duration: 8 });
    first.elements.push(createShape("rect", { x: 10, y: 10, width: 100, height: 100, animation: rise }), createText({ text: "static" }));
    const second = createPage({ duration: 3.5, transition: { kind: "push", duration: 0.6, direction: "left" } });
    second.elements.push(createGroup([createShape("ellipse", { width: 20, height: 20 })], { animation: { in: { kind: "pop", duration: 0.6, delay: 0 } } }));
    const third = createPage({ transition: { kind: "dissolve", duration: 0.7 } });
    return createDesign({ title: "Animated", width: 1280, height: 720, pages: [first, second, third] });
  };

  it("keeps page durations, page transitions and element animations through export -> parse", () => {
    const design = animatedDesign();
    const parsed = parseProjectFile(serializeProjectFile(buildProjectFile(design, {}))).design;
    expect(parsed.pages.map((p) => p.duration)).toEqual([8, 3.5, undefined]);
    expect(parsed.pages[0].transition).toBeUndefined();
    expect(parsed.pages[1].transition).toEqual({ kind: "push", duration: 0.6, direction: "left" });
    expect(parsed.pages[2].transition).toEqual({ kind: "dissolve", duration: 0.7 });
    expect(parsed.pages[0].elements[0].animation).toEqual(rise);
    expect(parsed.pages[1].elements[0].animation).toEqual({ in: { kind: "pop", duration: 0.6, delay: 0 } });
    // nothing else about the pages changed
    parsed.pages.forEach((page, i) => expect(page).toEqual(design.pages[i]));
  });

  const withPages = (pages: Array<Record<string, unknown>>) => {
    const raw = JSON.parse(serializeProjectFile(buildProjectFile(createDesign({ width: 100, height: 100 }), {})));
    raw.design.pages = pages.map((p) => ({ id: `p${Math.random()}`, background: { type: "solid", color: "#fff" }, elements: [], ...p }));
    return parseProjectFile(JSON.stringify(raw)).design.pages;
  };

  it("clamps the duration like pageDuration and the transition length to 0..3 s", () => {
    const pages = withPages([
      { duration: 900 },
      { duration: 0.2 },
      { duration: -4 },
      { duration: 12.5, transition: { kind: "wipe", duration: 99, direction: "down" } },
      { transition: { kind: "slide", duration: -2, direction: "up" } },
    ]);
    expect(pages.map((p) => p.duration)).toEqual([60, 1, 1, 12.5, undefined]);
    expect(pages[3].transition).toEqual({ kind: "wipe", duration: 3, direction: "down" });
    expect(pages[4].transition).toEqual({ kind: "slide", duration: 0, direction: "up" });
  });

  it("drops malformed values without throwing", () => {
    const pages = withPages([
      { duration: "5", transition: "dissolve" },
      { duration: null, transition: null },
      { duration: [5], transition: [] },
      { duration: {}, transition: { kind: 7, duration: 1 } },
      { transition: { kind: "push", duration: "1" } },
      { transition: { duration: 1 } },
      { transition: { kind: "push", duration: 1, direction: "sideways" } },
      { transition: { kind: "push", duration: 1, direction: 3 } },
    ]);
    for (const page of pages.slice(0, 6)) {
      expect(page.duration).toBeUndefined();
      expect("duration" in page).toBe(false);
      expect("transition" in page).toBe(false);
    }
    // an unknown direction only loses the direction; the transition itself is fine
    expect(pages[6].transition).toEqual({ kind: "push", duration: 1 });
    expect(pages[7].transition).toEqual({ kind: "push", duration: 1 });
    expect(pages[6].transition && "direction" in pages[6].transition).toBe(false);
  });

  it("does not let extra fields of a transition through", () => {
    const [page] = withPages([{ transition: { kind: "zoom", duration: 0.7, direction: "right", evil: "x" } }]);
    expect(page.transition).toEqual({ kind: "zoom", duration: 0.7, direction: "right" });
  });
});

describe("what a file may not do to the app", () => {
  const fileOf = (design: Design) => serializeProjectFile(buildProjectFile(design, {}));
  /** a shape inside this many groups, one inside the other */
  const nested = (levels: number) => {
    let el: ReturnType<typeof createGroup> | ShapeElement = createShape("rect", { id: "leaf" });
    for (let i = 0; i < levels; i++) el = createGroup([el], { id: `g${i}` });
    return el;
  };
  const depthOf = (el: { type: string; children?: unknown[] }): number =>
    el.type === "group" ? 1 + (el.children?.length ? depthOf(el.children[0] as { type: string; children?: unknown[] }) : 0) : 0;

  it("cuts a title to the length the title field allows", () => {
    const design = createDesign({ width: 800, height: 600, title: "T".repeat(20000), pages: [createPage()] });
    expect(parseProjectFile(fileOf(design)).design.title).toBe("T".repeat(MAX_TITLE_LENGTH));
    expect(parseProjectFile(fileOf(createDesign({ width: 800, height: 600, title: "Short", pages: [createPage()] }))).design.title).toBe("Short");
  });

  it("keeps groups inside groups as deep as the limit, and leaves out what is deeper", () => {
    const fits = parseProjectFile(fileOf(createDesign({ width: 800, height: 600, pages: [createPage({ elements: [nested(MAX_GROUP_DEPTH)] })] })));
    expect(depthOf(fits.design.pages[0].elements[0])).toBe(MAX_GROUP_DEPTH);
    expect(JSON.stringify(fits.design)).toContain('"leaf"');

    const report = { skipped: 0 };
    const deep = parseProjectFile(fileOf(createDesign({ width: 800, height: 600, pages: [createPage({ elements: [nested(200)] })] })), report);
    expect(depthOf(deep.design.pages[0].elements[0])).toBe(MAX_GROUP_DEPTH);
    expect(JSON.stringify(deep.design)).not.toContain('"leaf"');
    expect(report.skipped).toBe(1);
  });

  it("says how many elements it left out, on every page and inside groups", () => {
    const good = createShape("rect");
    const design = createDesign({
      width: 800,
      height: 600,
      pages: [createPage({ elements: [good, createGroup([createShape("ellipse"), createShape("star")])] }), createPage({ elements: [createText({ text: "kept" })] })],
    });
    const raw = JSON.parse(fileOf(design));
    raw.design.pages[0].elements.push({ id: "bad1", type: "hologram" }, { ...good, id: "bad2", width: "wide" });
    raw.design.pages[0].elements[1].children.push({ id: "bad3", type: "shape" });
    raw.design.pages[1].elements.push(null);
    const report = { skipped: 0 };
    const parsed = parseProjectFile(JSON.stringify(raw), report);
    expect(report.skipped).toBe(4);
    expect(parsed.design.pages.map((p) => p.elements.length)).toEqual([2, 1]);

    const clean = { skipped: 0 };
    parseProjectFile(fileOf(design), clean);
    expect(clean.skipped).toBe(0);
  });
});

describe("pictures that point to the web", () => {
  const web = "https://tracker.example/pixel.png";
  const fileOf = (design: Design) => serializeProjectFile(buildProjectFile(design, {}));

  it("are taken out of a file wherever they hide, and counted: photos, fills, backgrounds, inside groups", () => {
    const design = createDesign({
      width: 800,
      height: 600,
      pages: [
        createPage({
          background: { type: "image", src: web, fit: "cover", dim: 0 },
          elements: [
            createImage({ id: "photo", src: web, width: 10, height: 10 }),
            createImage({ id: "cut", src: "asset:kept", originalSrc: "//tracker.example/original.png", width: 10, height: 10 }),
            createShape("rect", { id: "filled", fill: { type: "image", src: "HTTP://tracker.example/fill.png", fit: "tile" } }),
            createGroup([createImage({ id: "inner", src: web, width: 10, height: 10 })], { id: "group" }),
            createImage({ id: "stock", src: "builtin:sunset-hills", width: 10, height: 10 }),
            createImage({ id: "own", src: "data:image/png;base64,AAAA", width: 10, height: 10 }),
          ],
        }),
      ],
    });
    const report = { skipped: 0, remote: 0 };
    const parsed = parseProjectFile(fileOf(design), report);
    const text = JSON.stringify(parsed.design);
    expect(text).not.toContain("tracker.example");
    const [page] = parsed.design.pages;
    expect(page.background).toEqual({ type: "solid", color: "#ffffff" });
    const byId = (id: string) => page.elements.find((e) => e.id === id) as unknown as { src: string | null; fill: unknown };
    expect(byId("photo").src).toBeNull();
    expect(byId("cut").src).toBe("asset:kept");
    expect("originalSrc" in byId("cut")).toBe(false);
    expect(byId("filled").fill).toEqual({ type: "solid", color: "#e5e7eb" });
    expect(text).toContain("builtin:sunset-hills");
    expect(text).toContain("data:image/png;base64,AAAA");
    // the photo, the fill, the picture in the group and the background (an original that is dropped is not counted on its own)
    expect(report).toEqual({ skipped: 0, remote: 4 });
  });

  it("are taken out of what is pasted, which is checked like the elements of a file", () => {
    const good = createShape("rect", { id: "ok" });
    const pasted = usableElements([good, createImage({ id: "photo", src: web, width: 10, height: 10 }), { id: "junk", type: "hologram" }, "not an element"]);
    expect(pasted.map((e) => e.id)).toEqual(["ok", "photo"]);
    expect((pasted[1] as ImageElement).src).toBeNull();
    expect(pasted[0]).toBe(good);
    for (const nothing of [null, "text", 5, { elements: [] }, undefined]) expect(usableElements(nothing)).toEqual([]);
  });
});

describe("prepareImportedDesign", () => {
  it("gives the design a new identity and resets library state", () => {
    const original = fakeDesign();
    const out = prepareImportedDesign(original, "d_new", 777);
    expect(out.id).toBe("d_new");
    expect(out).toMatchObject({ createdAt: 777, updatedAt: 777, folderId: null, starred: false, trashedAt: null, title: "Round trip" });
    expect(original.id).not.toBe("d_new");
    expect(out.pages).toBe(original.pages);
  });
});

describe("data URLs and names", () => {
  it("decodes base64 and percent-encoded data URLs", () => {
    const png = dataUrlToBytes("data:image/png;base64,iVBORw0KGgo=");
    expect(png?.mime).toBe("image/png");
    expect(Array.from(png!.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const svg = dataUrlToBytes("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E");
    expect(svg?.mime).toBe("image/svg+xml");
    expect(new TextDecoder().decode(svg!.bytes)).toBe('<svg a="1"/>');
    expect(dataUrlToBytes("data:text/plain,hello")?.mime).toBe("text/plain");
  });

  it("returns null for malformed input", () => {
    expect(dataUrlToBytes("http://x/y")).toBeNull();
    expect(dataUrlToBytes("data:image/png;base64")).toBeNull();
    expect(dataUrlToBytes("data:image/png;base64,@@@@")).toBeNull();
  });

  it("reads the mime type and maps it to an extension", () => {
    expect(mimeOfDataUrl("data:image/jpeg;base64,xx")).toBe("image/jpeg");
    expect(mimeOfDataUrl("nope")).toBeNull();
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("IMAGE/SVG+XML")).toBe("svg");
    expect(extensionForMime("image/x-icon")).toBe("xicon");
  });

  it("names project files after the design", () => {
    expect(projectFileName("My: design / v2")).toBe("My design v2.craftly");
    expect(projectFileName("")).toBe("Untitled design.craftly");
  });
});
