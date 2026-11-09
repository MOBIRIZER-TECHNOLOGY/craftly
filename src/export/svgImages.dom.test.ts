import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphic, createGroup, createImage, createLine, createPage, createShape, createText } from "@/core/factory";
import type { Asset, DesignElement, Fill, Page } from "@/core/types";
import { captureContexts } from "@/test/logicPaint";
import { isCancelled } from "./errors";
import { designPageToSvg, type SvgExportOptions } from "./svg";

const held = vi.hoisted(() => ({ assets: new Map<string, import("@/core/types").Asset>(), ghosts: new Set<string>() }));

vi.mock("@/core/assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/assets")>();
  return {
    ...actual,
    // the fake database cannot keep a real Blob: the library is simulated here
    getAsset: vi.fn(async (id: string) => held.assets.get(id) ?? null),
    getAssetUrl: vi.fn(async (id: string) => (held.assets.has(id) || held.ghosts.has(id) ? `blob:held/${id}` : null)),
  };
});

// painting a whole built-in photo on a recording canvas is slow and says nothing about how it is exported
vi.mock("@/data/photos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/photos")>();
  return {
    ...actual,
    getPhotoImage: vi.fn(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      return canvas;
    }),
  };
});

const SIZE = { width: 200, height: 100 };
let serial = 0;
const url = (name = "pic") => `https://example.test/${name}-${++serial}.png`;
const photo = (src: string, init: Partial<ReturnType<typeof createImage>> = {}) => createImage({ src, width: 50, height: 40, naturalWidth: 64, naturalHeight: 48, ...init });
const pageOf = (elements: DesignElement[], background?: Fill): Page => createPage({ elements, ...(background ? { background } : {}) });
const toSvg = (page: Page, options: Partial<SvgExportOptions> = {}, size = SIZE) => designPageToSvg(size, page, { embedFonts: false, ...options });
const count = (text: string, part: string) => text.split(part).length - 1;
const defsOf = (svg: string) => svg.match(/<defs>([\s\S]*)<\/defs>/)?.[1] ?? "";
const dataUrl = (mime: string, content: string) => `data:${mime};base64,${btoa(content)}`;
const imageId = (svg: string) => defsOf(svg).match(/<image id="(cf-img\d+)"/)?.[1];
/** What `fetch` answers: jsdom's Blob is not one `Response` understands, so the answer is built by hand. */
const reply = (blob: Blob) => ({ ok: true, status: 200, blob: async () => blob, arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer });
const refusal = (status = 404) => ({ ok: false, status, blob: async () => new Blob([]), arrayBuffer: async () => new ArrayBuffer(0) });

function hold(id: string, mime: string, content: string, over: Partial<Asset> = {}): Asset {
  const asset: Asset = { id, name: id, kind: "image", mime, size: content.length, width: 30, height: 20, createdAt: 1, blob: new Blob([content], { type: mime }), ...over };
  held.assets.set(id, asset);
  return asset;
}

beforeEach(() => {
  held.assets.clear();
  held.ghosts.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe("pictures", () => {
  it("defines each picture once, however often it is placed, and places it with <use>", async () => {
    const src = "data:image/png;base64,AAAA";
    const { svg, warnings } = await toSvg(pageOf([photo(src), photo(src, { x: 60 }), photo(src, { x: 120 })]));
    expect(warnings).toEqual([]);
    expect(count(defsOf(svg), "<image")).toBe(1);
    expect(defsOf(svg)).toMatch(/<image id="cf-img\d+" width="64" height="48" preserveAspectRatio="none" xlink:href="data:image\/png;base64,AAAA"\/>/);
    expect(count(svg, `<use xlink:href="#${imageId(svg)}"`)).toBe(3);
  });

  it("places the picture where the element's crop puts it, inside a clip the shape of the mask", async () => {
    const { svg } = await toSvg(
      pageOf([photo("data:image/png;base64,AAAA", { width: 100, height: 40, naturalWidth: 100, naturalHeight: 80, crop: { x: 0, y: -0.5, w: 1, h: 2 } })]),
    );
    // the crop is the picture's place in the box, as fractions of it: 100 x 80 starting 20 px above the top of the 100 x 40 box
    expect(svg).toContain('transform="translate(0 -20) scale(1.563 1.667)"');
    expect(svg).toMatch(/<g clip-path="url\(#cf-cp\d+\)"><use /);
  });

  it("embeds the original bytes of an upload, and takes the size of a vector upload from the file", async () => {
    hold("logo", "image/svg+xml", "<svg/>", { kind: "svg", width: 30, height: 20 });
    const { svg } = await toSvg(pageOf([photo("asset:logo")]));
    expect(defsOf(svg)).toContain(`width="30" height="20" preserveAspectRatio="none" xlink:href="${dataUrl("image/svg+xml", "<svg/>")}"/>`);
  });

  it("measures an upload that is a bitmap by the decoded picture, whatever size is on record", async () => {
    hold("photo", "image/png", "PNGDATA", { width: 999, height: 999 });
    const { svg } = await toSvg(pageOf([photo("asset:photo")]));
    expect(defsOf(svg)).toMatch(/<image id="cf-img\d+" width="64" height="48"/);
    expect(defsOf(svg)).toContain(dataUrl("image/png", "PNGDATA"));
  });

  it("draws an upload that has gone from the library from what the canvas shows", async () => {
    held.ghosts.add("gone");
    const { svg, warnings } = await toSvg(pageOf([photo("asset:gone")]));
    expect(warnings).toEqual([]);
    expect(defsOf(svg)).toContain('xlink:href="data:image/png;base64,AAAA"');
  });

  it("fetches a picture from the web so that the file does not depend on the site", async () => {
    const fetchMock = vi.fn(async () => reply(new Blob(["WEBDATA"], { type: "image/webp" })));
    vi.stubGlobal("fetch", fetchMock);
    const src = url("web");
    const { svg } = await toSvg(pageOf([photo(src)]));
    expect(fetchMock).toHaveBeenCalledWith(src, { mode: "cors" });
    expect(defsOf(svg)).toContain(dataUrl("image/webp", "WEBDATA"));
  });

  it("assumes PNG for a web picture that does not say what it is, and keeps a JPEG a JPEG", async () => {
    // the type decides how a filtered copy of the same picture is saved
    const filtered = (src: string) => photo(src, { x: 60, filter: { ...photo(src).filter, brightness: 30 } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(new Blob(["WEBDATA"]))),
    );
    const untyped = url("untyped");
    const png = await toSvg(pageOf([photo(untyped), filtered(untyped)]));
    expect(png.svg).toContain('<image width="50" height="40" preserveAspectRatio="none" xlink:href="data:image/png;base64,AAAA"');
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(new Blob(["WEBDATA"], { type: "image/jpeg" }))),
    );
    const typed = url("typed");
    const jpeg = await toSvg(pageOf([photo(typed), filtered(typed)]));
    expect(jpeg.svg).toContain('<image width="50" height="40" preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,AAAA"');
  });

  it("falls back on what the canvas shows when the site does not answer, or answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => refusal()),
    );
    const refused = await toSvg(pageOf([photo(url("refused"))]));
    expect(defsOf(refused.svg)).toContain('xlink:href="data:image/png;base64,AAAA"');
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("network down"))),
    );
    const offline = await toSvg(pageOf([photo(url("offline"))]));
    expect(defsOf(offline.svg)).toContain('xlink:href="data:image/png;base64,AAAA"');
    expect(refused.warnings).toEqual([]);
  });

  it("saves a built-in photo as a JPEG made from what the canvas shows", async () => {
    const { svg } = await toSvg(pageOf([photo("builtin:sunset-hills")]));
    expect(defsOf(svg)).toMatch(/<image id="cf-img\d+" width="160" height="90" preserveAspectRatio="none" xlink:href="data:image\/jpeg;base64,AAAA"\/>/);
  });

  it("shows a grey box, and says why, when a picture cannot be turned into data", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new DOMException("tainted", "SecurityError");
    });
    const { svg, warnings } = await toSvg(pageOf([photo(url("tainted"))]));
    expect(warnings).toEqual(["Some images could not be embedded (they come from another website that does not allow it), so they are shown as grey boxes."]);
    expect(svg).toMatch(/<g clip-path="url\(#cf-cp\d+\)"><rect width="50" height="40" fill="#eceef3"\/><\/g>/);
    expect(defsOf(svg)).not.toContain("<image");
  });

  it("draws a grey box where a picture cannot be loaded at all", async () => {
    const { svg, warnings } = await toSvg(pageOf([photo("https://example.test/broken-svg-export.png")]));
    expect(warnings).toEqual([]);
    expect(svg).toContain('<rect width="50" height="40" fill="#eceef3"/>');
    expect(svg).not.toContain("<use");
  });

  it("draws the empty frame an element without a picture shows", async () => {
    const { svg } = await toSvg(pageOf([createImage({ src: null, width: 100, height: 50 })]));
    expect(svg).toContain('<rect width="100" height="50" fill="#e7e9ef"/>');
    expect(svg).toContain('fill="#b3b8c4"');
    expect(svg).not.toContain("<use");
  });

  it("leaves out pictures that are hidden, without even fetching them", async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" })));
    vi.stubGlobal("fetch", fetchMock);
    const { svg } = await toSvg(pageOf([photo(url("hidden"), { hidden: true }), createGroup([photo(url("hidden-in-group"), { hidden: true })])]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(svg).not.toContain("<image");
  });

  it("applies the opacity of the element and of the groups around it", async () => {
    const src = "data:image/png;base64,AAAA";
    const { svg } = await toSvg(
      pageOf([photo(src, { opacity: 0.5 }), createGroup([photo(src, { opacity: 0.5 })], { opacity: 0.5 }), createImage({ src: null, width: 20, height: 20, opacity: 0.5 })]),
    );
    // 0.5 on the element itself; 0.5 x 0.5 for the one in the group
    expect(svg).toMatch(/<use [^>]* opacity="0.5"\/>/);
    expect(svg).toMatch(/<use [^>]* opacity="0.25"\/>/);
    // the empty frame is faded too
    expect(svg).toMatch(/fill="#e7e9ef" opacity="0.5"/);
  });

  it("clips to the shape of the mask, with rounded corners for a rounded rectangle", async () => {
    const src = "data:image/png;base64,AAAA";
    const { svg } = await toSvg(pageOf([photo(src, { mask: "ellipse" }), photo(src, { radius: 8 }), photo(src, { mask: "" as never })]));
    expect(defsOf(svg)).toContain('<clipPath id="cf-cp');
    expect(defsOf(svg)).toContain("<ellipse");
    expect(defsOf(svg)).toContain('rx="8"');
    // an empty mask means the plain rectangle, which shares the clip with the plain one
    expect(count(defsOf(svg), "<clipPath")).toBe(3);
  });

  it("draws nothing for a picture without area", async () => {
    const { svg } = await toSvg(pageOf([photo("data:image/png;base64,AAAA", { width: 0 })]));
    expect(svg).not.toContain("<use");
    expect(svg).not.toContain("clip-path");
  });

  it("gives a picture a shadow, drawn first, and an outline, drawn last", async () => {
    const { svg } = await toSvg(
      pageOf([photo("data:image/png;base64,AAAA", { shadow: { color: "#000000", blur: 6, x: 4, y: 4 }, stroke: { color: "#ff0000", width: 3, style: "solid" } })]),
    );
    const shadow = svg.indexOf('fill="#000000" filter="url(#cf-sh');
    const picture = svg.indexOf("<use ");
    const outline = svg.indexOf('fill="none" stroke="#ff0000"');
    expect(shadow).toBeGreaterThan(-1);
    expect(shadow).toBeLessThan(picture);
    expect(picture).toBeLessThan(outline);
    expect(defsOf(svg)).toMatch(/<filter id="cf-sh\d+"/);
  });

  it("draws no outline for a width of zero", async () => {
    const { svg } = await toSvg(pageOf([photo("data:image/png;base64,AAAA", { stroke: { color: "#ff0000", width: 0, style: "solid" } })]));
    expect(svg).not.toContain('stroke="#ff0000"');
  });
});

describe("pictures with a filter", () => {
  const filtered = (src: string, init = {}) => photo(src, { filter: { ...createImage({ src }).filter, brightness: 30 }, ...init });

  it("embeds the filtered raster itself instead of the picture", async () => {
    const { svg } = await toSvg(pageOf([filtered("data:image/png;base64,AAAA")]));
    expect(svg).toMatch(/<g clip-path="url\(#cf-cp\d+\)"><image width="50" height="40" preserveAspectRatio="none" xlink:href="data:image\/png;base64,AAAA"\/><\/g>/);
    // nothing is defined for the original
    expect(defsOf(svg)).not.toContain("<image");
  });

  it("saves the filtered raster of a JPEG upload as a JPEG, and any other as a PNG", async () => {
    hold("jpg", "image/jpeg", "JPEGDATA");
    hold("png", "image/png", "PNGDATA");
    hold("typeless", "", "DATA", { blob: new Blob(["DATA"]) });
    const { svg } = await toSvg(pageOf([filtered("asset:jpg"), filtered("asset:png"), filtered("asset:typeless")]));
    expect(count(svg, "data:image/jpeg;base64,AAAA")).toBe(1);
    expect(count(svg, "data:image/png;base64,AAAA")).toBe(2);
  });

  it("saves the filtered raster of a built-in photo as a JPEG and of anything else as a PNG", async () => {
    const { svg } = await toSvg(pageOf([filtered("builtin:sunset-hills"), filtered(url("filtered"))]));
    expect(count(svg, "data:image/jpeg;base64,AAAA")).toBe(1);
    expect(count(svg, "data:image/png;base64,AAAA")).toBe(1);
  });

  it("shows a grey box, and says so, when the raster cannot be saved", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new Error("too big");
    });
    const { svg, warnings } = await toSvg(pageOf([filtered(url("too-big"))]));
    expect(warnings).toEqual(["Some filtered images could not be embedded."]);
    expect(svg).toMatch(/<g clip-path="url\(#cf-cp\d+\)"><rect width="50" height="40" fill="#eceef3"\/><\/g>/);
  });

  it("uses the type recorded for a picture that is also placed without a filter", async () => {
    const src = "data:image/jpeg;base64,AAAA";
    const { svg } = await toSvg(pageOf([photo(src), filtered(src)]));
    expect(svg).toContain('xlink:href="data:image/jpeg;base64,AAAA"/></g>');
  });
});

describe("backgrounds", () => {
  const image = (src: string, fit: "cover" | "contain" | "tile", dim?: number): Fill => ({ type: "image", src, fit, ...(dim === undefined ? {} : { dim }) });
  const src = "data:image/png;base64,AAAA";

  it("covers the page with the picture, centred, over a grey base", async () => {
    const { svg } = await toSvg(pageOf([], image(src, "cover")));
    expect(svg).toContain('<rect width="200" height="100" fill="#e9ebf0"/>');
    // 64 x 48 scaled by 3.125 to 200 x 150: 25 px too tall, shared top and bottom
    expect(svg).toContain(`<use xlink:href="#${imageId(svg)}" transform="translate(0 -25) scale(3.125)"/>`);
  });

  it("fits the whole picture inside the page", async () => {
    const { svg } = await toSvg(pageOf([], image(src, "contain")));
    expect(svg).toContain('transform="translate(33.333 0) scale(2.083)"');
  });

  it("repeats the picture at its own size as a pattern", async () => {
    const { svg } = await toSvg(pageOf([], image(src, "tile")));
    expect(defsOf(svg)).toContain(`<pattern id="cf-tile2" patternUnits="userSpaceOnUse" width="64" height="48"><use xlink:href="#${imageId(svg)}"/></pattern>`);
    expect(svg).toContain('<rect width="200" height="100" fill="url(#cf-tile2)"/>');
  });

  it("darkens the picture with a black veil, or lightens it with a white one", async () => {
    expect(await toSvg(pageOf([], image(src, "cover", 0.4)))).toMatchObject({ svg: expect.stringContaining('<rect width="200" height="100" fill="#000000" fill-opacity="0.4"/>') });
    expect((await toSvg(pageOf([], image(src, "cover", -0.3)))).svg).toContain('fill="#ffffff" fill-opacity="0.3"');
    // never fully opaque
    expect((await toSvg(pageOf([], image(src, "cover", 0.99)))).svg).toContain('fill-opacity="0.9"');
    expect((await toSvg(pageOf([], image(src, "cover", 0)))).svg).not.toContain("fill-opacity");
  });

  it("leaves a picture that cannot be loaded as the grey base alone", async () => {
    const { svg } = await toSvg(pageOf([], image("https://example.test/broken-background.png", "cover", 0.5)));
    expect(svg).toContain('<rect width="200" height="100" fill="#e9ebf0"/>');
    expect(svg).not.toContain("<use");
    expect(svg).not.toContain("fill-opacity");
  });

  it("still applies the veil when the picture could not be embedded", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new Error("tainted");
    });
    const { svg, warnings } = await toSvg(pageOf([], image(url("veil"), "cover", 0.5)));
    expect(warnings).toHaveLength(1);
    expect(svg).not.toContain("<use");
    expect(svg).toContain('fill="#000000" fill-opacity="0.5"');
  });

  it("builds the tile of a noise pattern from the pixels the canvas makes", async () => {
    class FakeImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }
    vi.stubGlobal("ImageData", FakeImageData);
    const spies = captureContexts();
    const { svg } = await toSvg(pageOf([], { type: "pattern", pattern: "noise", color: "#000000", background: "#ffffff", scale: 1 }));
    const [tile] = spies;
    const [put] = tile.to("putImageData");
    expect(put.args[1]).toBe(0);
    const data = put.args[0] as FakeImageData;
    expect(data.data.length).toBe(data.width * data.height * 4);
    expect(defsOf(svg)).toMatch(
      new RegExp(
        `<pattern id="cf-pt1" patternUnits="userSpaceOnUse" width="${data.width}" height="${data.height}"><rect [^>]*fill="#ffffff"/><image [^>]*image-rendering="pixelated" xlink:href="data:image/png;base64,AAAA"/></pattern>`,
      ),
    );
  });

  it("falls back on the paper colour alone when there is no canvas for the noise", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { svg } = await toSvg(pageOf([], { type: "pattern", pattern: "noise", color: "#000000", background: "#eeeeee", scale: 2 }));
    expect(defsOf(svg)).toContain('fill="#eeeeee"/></pattern>');
    expect(defsOf(svg)).not.toContain("<image");
  });
});

describe("shapes, lines and groups", () => {
  it("draws nothing for a shape without area, and nothing for one that is neither filled nor outlined", async () => {
    const empty = await toSvg(
      pageOf([
        createShape("rect", { width: 0 }),
        createShape("rect", { fill: null, stroke: null }),
        createShape("rect", { fill: null, stroke: { color: "#000000", width: 0, style: "solid" } }),
      ]),
    );
    expect(empty.svg).not.toMatch(/<rect (?!width="200" height="100")/);
    expect(empty.svg).not.toContain("<path");
  });

  it("draws a shape that is only an outline with no fill", async () => {
    const { svg } = await toSvg(pageOf([createShape("rect", { fill: null, stroke: { color: "#ff0000", width: 4, style: "solid" } })]));
    expect(svg).toContain('fill="none" stroke="#ff0000"');
  });

  it("falls back on a rectangle for a shape it does not know", async () => {
    const { svg } = await toSvg(pageOf([createShape("no-such-shape", { width: 40, height: 30 })]));
    expect(svg).toContain('<rect width="40" height="30"');
  });

  it("draws a custom path scaled to the box", async () => {
    const { svg } = await toSvg(pageOf([createShape("path", { width: 50, height: 50, path: "M0 0L100 0L100 100Z" })]));
    expect(svg).toMatch(/<path d="M0 0L50 0L50 50Z"/);
  });

  it("limits the rounding of corners to half the shorter side", async () => {
    const { svg } = await toSvg(pageOf([createShape("rect", { width: 40, height: 20, radius: 500 })]));
    expect(svg).toContain('rx="10"');
  });

  it("shadows an outline-only shape with an outline-only shadow", async () => {
    const { svg } = await toSvg(
      pageOf([createShape("rect", { fill: null, stroke: { color: "#ff0000", width: 4, style: "solid" }, shadow: { color: "#000000", blur: 4, x: 3, y: 3 }, opacity: 0.5 })]),
    );
    expect(svg).toMatch(/<rect [^>]*fill="none" stroke="#ff0000"[^>]* filter="url\(#cf-sh1\)" opacity="0.5"\/>/);
  });

  it("draws the shadow of a filled shape in black, whatever its colour, under the shape", async () => {
    const { svg } = await toSvg(pageOf([createShape("rect", { fill: { type: "solid", color: "#00ff00" }, shadow: { color: "#223344", blur: 4, x: 3, y: 3 } })]));
    expect(svg.indexOf('fill="#000000" filter=')).toBeLessThan(svg.indexOf('fill="#00ff00"'));
  });

  it("draws nothing for a group with no children, or only hidden ones", async () => {
    const { svg } = await toSvg(pageOf([createGroup([]), createGroup([createShape("rect", { hidden: true })])]));
    expect(svg).not.toContain("<g");
    expect(svg).not.toContain("<path");
  });

  it("draws a line with a head at the start only", async () => {
    const { svg } = await toSvg(pageOf([createLine({ startArrow: "arrow", endArrow: "none", width: 100 })]));
    expect(svg).toContain('<g transform="scale(-1 1)"><path d="M0 0L-19.2');
    expect(svg).not.toContain("translate(100 0)");
  });

  it("draws a plain shaft when both ends are plain, or when a head is of a kind it does not know", async () => {
    const plain = await toSvg(pageOf([createLine({ width: 100 })]));
    expect(count(plain.svg, "<path")).toBe(1);
    const odd = await toSvg(pageOf([createLine({ width: 100, endArrow: "sparkle" as never })]));
    expect(count(odd.svg, "<path")).toBe(1);
    expect(odd.svg).not.toContain("translate(100 0)");
  });

  it("gives a line its shadow as a filter around the whole line", async () => {
    const { svg } = await toSvg(pageOf([createLine({ width: 100, shadow: { color: "#000000", blur: 4, x: 2, y: 2 } })]));
    expect(svg).toMatch(/<g filter="url\(#cf-sh1\)"><path d="M0 0L100 0"/);
  });
});

describe("graphics", () => {
  const graphic = (svg: string, init = {}) => ({ ...createGraphic({ svg: `<svg viewBox="0 0 10 10"><circle r="5"/></svg>`, width: 40, height: 40, ...init }), svg });

  it("says so, and leaves the graphic out, when it is not a vector graphic", async () => {
    const { svg, warnings } = await toSvg(pageOf([graphic("<div>not a picture</div>")]));
    expect(warnings).toEqual(["A graphic could not be read and was left out."]);
    expect(svg).not.toContain("<svg x=");
  });

  it("leaves out a graphic whose closing tag is missing", async () => {
    const { warnings } = await toSvg(pageOf([graphic("<svg viewBox='0 0 1 1'><circle r='1'/>")]));
    expect(warnings).toHaveLength(1);
  });

  it("takes a graphic that is a single self-closing tag as an empty one", async () => {
    const { svg, warnings } = await toSvg(pageOf([graphic("<svg viewBox='0 0 5 5' fill='red'/>")]));
    expect(warnings).toEqual([]);
    expect(svg).toContain('<svg x="0" y="0" width="40" height="40" viewBox="0 0 5 5" fill=\'red\'></svg>');
  });

  it("falls back on the declared size when the graphic has no viewBox, and keeps how it is fitted", async () => {
    const { svg } = await toSvg(pageOf([graphic(`<svg width="10" height="10" preserveAspectRatio="xMinYMin slice"><rect width="4" height="4"/></svg>`, { viewW: 12, viewH: 8 })]));
    expect(svg).toContain('viewBox="0 0 12 8" preserveAspectRatio="xMinYMin slice"');
  });

  it("fades and shadows a graphic from a wrapper, because the shadow would be cut off inside it", async () => {
    const { svg } = await toSvg(pageOf([graphic(`<svg viewBox="0 0 10 10"><circle r="5"/></svg>`, { opacity: 0.5, shadow: { color: "#000000", blur: 4, x: 2, y: 2 } })]));
    expect(svg).toMatch(/<g filter="url\(#cf-sh1\)" opacity="0.5"><svg x="0"/);
    const faded = await toSvg(pageOf([graphic(`<svg viewBox="0 0 10 10"><circle r="5"/></svg>`, { opacity: 0.5 })]));
    expect(faded.svg).toMatch(/<g opacity="0.5"><svg x="0"/);
    const plain = await toSvg(pageOf([graphic(`<svg viewBox="0 0 10 10"><circle r="5"/></svg>`)]));
    expect(plain.svg).toMatch(/<svg x="0" y="0" width="40" height="40"/);
    expect(plain.svg).not.toContain("<g opacity");
  });

  it("removes scripts, event handlers and links that leave the document, in either kind of quote", async () => {
    const dirty = `<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><a href='https://evil.test/x'><circle onclick='y()' r="5" style="fill:url(https://evil.test/f)"/></a><image href="data:image/png;base64,AAAA"/><use xlink:href='#local'/></svg>`;
    const { svg } = await toSvg(pageOf([graphic(dirty)]));
    expect(svg).not.toContain("alert");
    expect(svg).not.toContain("evil.test");
    expect(svg).not.toContain("onclick");
    expect(svg).not.toContain("onload");
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain("xlink:href='#local'");
  });

  it("removes event handlers however they are written: after a slash, with no quotes, in capitals", async () => {
    const dirty = `<svg viewBox="0 0 10 10"/onload="a1()"><g/onclick="a2()"><circle onmouseover=a3() r="5"/><rect ONFOCUS = "a4()" width="1" height="1"/><path d="M0 0" onclick='a5()'/></g></svg>`;
    const { svg } = await toSvg(pageOf([graphic(dirty)]));
    for (const call of ["a1()", "a2()", "a3()", "a4()", "a5()"]) expect(svg).not.toContain(call);
    expect(svg).not.toMatch(/[\s/]on(load|click|mouseover|focus)/i);
    expect(svg).toContain("<circle");
    expect(svg).toContain("<path");
  });

  it("removes what taking one thing out leaves behind: a tag or a handler that was built around another", async () => {
    const dirty = `<svg viewBox="0 0 10 10"><scr<script></script>ipt>alert(1)</scr<script></script>ipt><circle r="5" on onclick="x()"click="alert(2)"/></svg>`;
    const { svg } = await toSvg(pageOf([graphic(dirty)]));
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("alert");
    expect(svg).not.toMatch(/onclick/i);
  });

  it("removes a script that is never closed or that closes itself, and a page inside the drawing the same way", async () => {
    const dirty = `<svg viewBox="0 0 10 10"><script href="#x"/><circle r="5"/><script>unclosed(1)<foreignObject><div onclick="y()"/></svg>`;
    const { svg } = await toSvg(pageOf([graphic(dirty)]));
    expect(svg).not.toMatch(/<\/?script/i);
    expect(svg).not.toMatch(/foreignObject/i);
    expect(svg).toContain("<circle");
  });

  it("leaves out a graphic that keeps growing what it is cleaned of, which is not a drawing", async () => {
    let bomb = "<script></script>";
    for (let i = 0; i < 20; i++) bomb = `<scr${bomb}ipt></script>`;
    const { svg } = await toSvg(pageOf([graphic(`<svg viewBox="0 0 10 10"><circle r="5"/>${bomb}</svg>`)]));
    expect(svg).not.toContain("<circle");
    expect(svg).not.toContain("script");
  });

  it("does not let the replacement colours of a graphic bring markup of their own", async () => {
    const hostile = { "#ff0000": '#111111"/onload="a1()', "#00ff00": 'red" onmouseover="a2()' };
    const { svg } = await toSvg(pageOf([graphic(`<svg viewBox="0 0 10 10"><rect fill="#ff0000" stroke="#00ff00" width="5" height="5"/></svg>`, { colors: hostile })]));
    expect(svg).not.toContain("a1()");
    expect(svg).not.toContain("a2()");
    expect(svg).toContain('fill="#ff0000"');
  });

  it("leaves style rules alone when they name no classes", async () => {
    const { svg } = await toSvg(pageOf([graphic(`<svg viewBox="0 0 10 10"><style>circle{fill:red}</style><circle r="5"/></svg>`)]));
    expect(svg).toContain("<style>circle{fill:red}</style>");
  });

  it("renames ids and the references to them per graphic", async () => {
    const withId = `<svg viewBox="0 0 10 10"><defs><linearGradient id="g1"/></defs><circle r="5" fill="url(#g1)"/></svg>`;
    const { svg } = await toSvg(pageOf([graphic(withId), graphic(withId)]));
    expect(svg).toContain('id="g1-g1"');
    expect(svg).toContain('id="g2-g1"');
    expect(svg).toContain("url(#g2-g1)");
  });
});

describe("the document", () => {
  it("has a title only when it is given one, and says where it comes from unless told otherwise", async () => {
    const plain = await toSvg(pageOf([]));
    expect(plain.svg).not.toContain("<title>");
    expect(plain.svg).toContain("<desc>Exported from Craftly</desc>");
    const named = await toSvg(pageOf([]), { title: "Menu <1>", description: "A & B" });
    expect(named.svg).toContain("<title>Menu &lt;1&gt;</title>");
    expect(named.svg).toContain("<desc>A &amp; B</desc>");
  });

  it("is cancelled by an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(designPageToSvg(SIZE, pageOf([photo(url("abort"))]), { embedFonts: false }, controller.signal)).rejects.toSatisfy(isCancelled);
  });
});

describe("embedding fonts", () => {
  const fontPage = (...faces: Array<{ family: string; weight?: number; italic?: boolean }>) =>
    pageOf(faces.map((f) => createText({ text: "Hello", fontFamily: f.family, fontWeight: f.weight ?? 400, italic: f.italic ?? false })));
  const fontResponse = () => reply(new Blob([]));

  it("writes an @font-face rule with the font file inside, for every face the page uses", async () => {
    const fetchMock = vi.fn(async () => fontResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { svg, warnings } = await toSvg(fontPage({ family: "Lobster" }, { family: "Lobster" }), { embedFonts: true });
    expect(warnings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(defsOf(svg)).toContain('<style>@font-face{font-family:"Lobster";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,AQID) format("woff2");}</style>');
  });

  it("gives a variable font the range of weights it covers, and an italic face its style", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fontResponse()),
    );
    const { svg } = await toSvg(fontPage({ family: "Inter", weight: 600 }, { family: "Poppins", italic: true }), { embedFonts: true });
    expect(svg).toMatch(/font-family:"Inter Variable";font-style:normal;font-weight:100 900;/);
    expect(svg).toMatch(/font-style:italic;font-weight:400;/);
  });

  it("fetches a file once for the whole session", async () => {
    const fetchMock = vi.fn(async () => fontResponse());
    vi.stubGlobal("fetch", fetchMock);
    await toSvg(fontPage({ family: "Cinzel" }), { embedFonts: true });
    await toSvg(fontPage({ family: "Cinzel" }), { embedFonts: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips a font it has no file for", async () => {
    const fetchMock = vi.fn(async () => fontResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { svg, warnings } = await toSvg(fontPage({ family: "Comic Nobody" }), { embedFonts: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(svg).not.toContain("@font-face");
    expect(warnings).toEqual([]);
  });

  it("warns, and carries on, when a font file cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => refusal()),
    );
    const refused = await toSvg(fontPage({ family: "Anton" }), { embedFonts: true });
    expect(refused.warnings).toEqual(["Some fonts could not be embedded; other programs may substitute them."]);
    expect(refused.svg).not.toContain("@font-face");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    const offline = await toSvg(fontPage({ family: "Righteous" }), { embedFonts: true });
    expect(offline.warnings).toHaveLength(1);
  });

  it("embeds the fonts it can when only some of them fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => (String(input).includes("bebas") ? refusal(500) : fontResponse())),
    );
    const { svg, warnings } = await toSvg(fontPage({ family: "Bebas Neue" }, { family: "Satisfy" }), { embedFonts: true });
    expect(warnings).toHaveLength(1);
    expect(svg).toContain('font-family:"Satisfy"');
    expect(svg).not.toContain('font-family:"Bebas Neue"');
  });

  it("leaves fonts out when asked to", async () => {
    const fetchMock = vi.fn(async () => fontResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { svg } = await toSvg(fontPage({ family: "Pacifico" }), { embedFonts: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(svg).not.toContain("@font-face");
  });
});
