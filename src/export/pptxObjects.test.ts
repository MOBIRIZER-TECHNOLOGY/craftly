import { describe, expect, it } from "vitest";
import { createPage, createShape, createText, solid } from "@/core/factory";
import { buildPptxParts, EMU_PER_PX } from "./pptx";
import { pptxObjectLinks, pptxObjects, pptxObjectXml } from "./pptxObjects";

const decoder = new TextDecoder();

describe("native PowerPoint objects", () => {
  it("chooses plain text and rectangles, leaving complex or hidden content rasterized", () => {
    const text = createText({ id: "text", text: "Editable" });
    const rect = createShape("rect", { id: "rect", fill: solid("#112233") });
    const gradient = createShape("rect", {
      id: "gradient",
      fill: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    const hidden = createText({ id: "hidden", hidden: true });
    expect(pptxObjects(createPage({ elements: [text, rect, gradient, hidden] })).map((el) => el.id)).toEqual(["text", "rect"]);
  });

  it("writes editable styled text and a linked rectangle in page units", () => {
    const text = createText({ x: 100, y: 50, width: 300, height: 100, rotation: 15, link: "example.com", paragraphs: [{ runs: [{ text: "Hello", bold: true, italic: true }] }] });
    const xml = pptxObjectXml(text, 10, EMU_PER_PX, "rId100");
    expect(xml).toContain('txBox="1"');
    expect(xml).toContain('<a:hlinkClick r:id="rId100"/>');
    expect(xml).toContain('rot="900000"');
    expect(xml).toContain('sz="4800"');
    expect(xml).toContain('b="1"');
    expect(xml).toContain('i="1"');
    expect(xml).toContain("<a:t>Hello</a:t>");
    const shape = createShape("rect", { fill: solid("#112233"), stroke: { color: "#445566", width: 2, style: "solid" } });
    expect(pptxObjectXml(shape, 11, EMU_PER_PX)).toContain('val="112233"');
  });

  it("writes common shapes as native geometry, including corner and star adjustments", () => {
    const cases = [
      ["ellipse", "ellipse"],
      ["triangle", "triangle"],
      ["right-triangle", "rtTriangle"],
      ["diamond", "diamond"],
      ["trapezoid", "trapezoid"],
      ["parallelogram", "parallelogram"],
      ["pentagon", "regularPentagon"],
      ["hexagon", "hexagon"],
      ["octagon", "octagon"],
      ["star-4", "star4"],
      ["star", "star5"],
      ["star-6", "star6"],
      ["arrow-right", "rightArrow"],
      ["arrow-left", "leftArrow"],
      ["arrow-up", "upArrow"],
      ["arrow-down", "downArrow"],
      ["chevron", "chevron"],
      ["double-arrow", "leftRightArrow"],
      ["heart", "heart"],
      ["plus", "mathPlus"],
      ["cross", "mathMultiply"],
      ["lightning", "lightningBolt"],
      ["moon", "moon"],
      ["cloud", "cloud"],
    ] as const;
    const objects = cases.map(([shape]) => createShape(shape, { fill: solid("#112233") }));
    expect(pptxObjects(createPage({ elements: objects }))).toEqual(objects);
    cases.forEach(([, preset], index) => expect(pptxObjectXml(objects[index], index + 1, EMU_PER_PX)).toContain(`<a:prstGeom prst="${preset}">`));
    const rounded = createShape("rect", { width: 200, height: 100, radius: 20 });
    expect(pptxObjectXml(rounded, 30, EMU_PER_PX)).toContain('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst>');
    const customPath = createShape("path", { path: "M0 0L100 100Z" });
    expect(pptxObjects(createPage({ elements: [customPath] }))).toEqual([]);
  });

  it("packages objects, transitions and external hyperlink relationships", () => {
    const object = createText({ text: "Linked", link: "https://example.com" });
    const parts = buildPptxParts({
      title: "Deck",
      width: 1280,
      height: 720,
      slides: [{ image: new Uint8Array([1]), type: "image/jpeg", objects: [object], transition: { kind: "push", direction: "right", duration: 0.6 } }],
    });
    const slide = decoder.decode(parts.find((part) => part.name === "ppt/slides/slide1.xml")!.data);
    const rels = decoder.decode(parts.find((part) => part.name === "ppt/slides/_rels/slide1.xml.rels")!.data);
    expect(slide).toContain("<a:t>Linked</a:t>");
    expect(slide).toContain('<p:transition spd="fast"><p:push dir="r"/></p:transition>');
    expect(rels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"');
    expect(pptxObjectLinks([object])).toEqual([{ id: "rId100", url: "https://example.com" }]);
  });
});
