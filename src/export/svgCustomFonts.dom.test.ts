import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage, createText } from "@/core/factory";
import type { Page } from "@/core/types";
import { customFontCss, setCustomFaces, type CustomFace } from "@/render/fonts";
import { sfntBytes, woffBytes } from "@/test/fontFixtures";
import { bytesToBase64 } from "./encoding";
import { fontFaceKey, fontFile } from "./fontFiles";
import { designPageToSvg } from "./svg";

const SIZE = { width: 200, height: 100 };
const REGULAR = sfntBytes({ family: "Acme Sans" });
const b64 = (bytes: Uint8Array) => bytesToBase64(bytes);
const buffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

function face(over: Partial<CustomFace> = {}): CustomFace {
  return { id: "f_1", family: "Acme Sans", minWeight: 400, maxWeight: 400, italic: false, format: "ttf", data: buffer(REGULAR), ...over };
}
const textPage = (...texts: Array<{ family: string; weight?: number; italic?: boolean }>): Page =>
  createPage({ elements: texts.map((t) => createText({ text: "Hello", fontFamily: t.family, fontWeight: t.weight ?? 400, italic: t.italic ?? false })) });
const toSvg = (page: Page, embedFonts = true) => designPageToSvg(SIZE, page, { embedFonts });
const rules = (svg: string) => svg.match(/@font-face\{[^}]*\}/g) ?? [];

afterEach(() => {
  setCustomFaces([]);
  vi.unstubAllGlobals();
});

describe("the font files the exports embed", () => {
  it("know the file of an uploaded family, with the name it is registered under", async () => {
    setCustomFaces([face(), face({ id: "f_2", minWeight: 700, maxWeight: 700 })]);
    expect(await fontFile("Acme Sans", 700, false)).toEqual({
      family: "Acme Sans",
      css: customFontCss("Acme Sans"),
      url: "",
      minWeight: 700,
      maxWeight: 700,
      italic: false,
      format: "ttf",
      data: expect.anything(),
    });
    expect(fontFaceKey("Acme Sans", 400)).toBe("uploaded|f_1");
    expect(fontFaceKey("Acme Sans", 900)).toBe("uploaded|f_2");
    // a bundled family is found as before, and an unknown one not at all
    expect(fontFaceKey("Poppins", 400)).toBe("Poppins|400-400|false");
    expect(fontFaceKey("Nothing")).toBeNull();
    expect(await fontFile("Nothing")).toBeNull();
  });
});

describe("an SVG of a design that uses an uploaded font", () => {
  it("embeds the font file under the name the text asks for, without fetching anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setCustomFaces([face()]);
    const { svg, warnings } = await toSvg(textPage({ family: "Acme Sans" }));
    const css = customFontCss("Acme Sans");
    expect(rules(svg)).toEqual([`@font-face{font-family:"${css}";font-style:normal;font-weight:400;src:url(data:font/ttf;base64,${b64(REGULAR)}) format("truetype");}`]);
    expect(svg).toContain(`font-family="'${css}', 'Acme Sans', sans-serif"`);
    expect(warnings).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what kind of file each one is", async () => {
    const otf = sfntBytes({ flavor: "otf" });
    setCustomFaces([
      face({ id: "a", family: "A", format: "otf", data: buffer(otf) }),
      face({ id: "b", family: "B", format: "woff", data: buffer(woffBytes("woff")) }),
      face({ id: "c", family: "C", format: "woff2", data: buffer(woffBytes("woff2")) }),
    ]);
    const { svg } = await toSvg(textPage({ family: "A" }, { family: "B" }, { family: "C" }));
    expect(svg).toContain(`src:url(data:font/otf;base64,${b64(otf)}) format("opentype");`);
    expect(svg).toContain(`src:url(data:font/woff;base64,${b64(woffBytes("woff"))}) format("woff");`);
    expect(svg).toContain(`src:url(data:font/woff2;base64,${b64(woffBytes("woff2"))}) format("woff2");`);
  });

  it("embeds each file once, a variable one with its range and an italic one with its style", async () => {
    setCustomFaces([face({ minWeight: 200, maxWeight: 800 }), face({ id: "f_i", italic: true })]);
    const { svg } = await toSvg(textPage({ family: "Acme Sans", weight: 300 }, { family: "Acme Sans", weight: 700 }, { family: "Acme Sans", italic: true }));
    expect(rules(svg)).toHaveLength(2);
    expect(svg).toMatch(/font-style:normal;font-weight:200 800;/);
    expect(svg).toMatch(/font-style:italic;font-weight:400;/);
  });

  it("embeds nothing when fonts are not to be embedded", async () => {
    setCustomFaces([face()]);
    expect(rules((await toSvg(textPage({ family: "Acme Sans" }), false)).svg)).toEqual([]);
  });

  it("keeps a family name with quotes and angle brackets inside its attribute, and out of the style sheet", async () => {
    const odd = `Odd"</style><script>alert(1)</script>`;
    setCustomFaces([face({ family: odd })]);
    const { svg } = await toSvg(textPage({ family: odd }));
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("</style><script");
    expect(rules(svg)).toHaveLength(1);
    expect(rules(svg)[0]).toContain(`font-family:"${customFontCss(odd)}";`);
    expect(rules(svg)[0]).not.toContain("Odd");
  });
});
