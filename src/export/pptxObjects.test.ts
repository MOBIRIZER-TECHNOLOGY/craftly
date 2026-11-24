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

  it("rasterizes a shape whose outline is dashed but keeps one with a solid outline or none", () => {
    const dashed = createShape("rect", { id: "dashed", stroke: { color: "#000000", width: 2, style: "dashed" } });
    const outlined = createShape("ellipse", { id: "outlined", stroke: { color: "#000000", width: 2, style: "solid" } });
    const unfilled = createShape("rect", { id: "unfilled", fill: null, stroke: null });
    expect(pptxObjects(createPage({ elements: [dashed, outlined, unfilled] })).map((el) => el.id)).toEqual(["outlined", "unfilled"]);
  });

  it("writes underline and strikethrough from a run or from the text box, and faded text with an alpha", () => {
    const text = createText({
      underline: true,
      strike: true,
      opacity: 0.5,
      paragraphs: [{ runs: [{ text: "Both" }, { text: "Neither", underline: false, strike: false }] }],
    });
    const [both, neither] = pptxObjectXml(text, 10, EMU_PER_PX).split("</a:r>");
    expect(both).toContain('u="sng"');
    expect(both).toContain('strike="sngStrike"');
    expect(both).toContain('<a:alpha val="50000"/>');
    expect(neither).not.toContain("u=");
    expect(neither).not.toContain("strike=");
    // a fully opaque run has no alpha at all
    expect(pptxObjectXml(createText({ text: "Solid" }), 10, EMU_PER_PX)).not.toContain("<a:alpha");
  });

  it("writes a colour it cannot read as black rather than leaving the run without one", () => {
    const text = createText({ paragraphs: [{ runs: [{ text: "Odd", color: "not a colour" }] }] });
    expect(pptxObjectXml(text, 10, EMU_PER_PX)).toContain('<a:solidFill><a:srgbClr val="000000"></a:srgbClr></a:solidFill>');
  });

  it("aligns each paragraph on its own, falling back to the text box, and marks an empty paragraph", () => {
    const text = createText({
      align: "justify",
      paragraphs: [
        { runs: [{ text: "Middle" }], align: "center" },
        { runs: [{ text: "End" }], align: "right" },
        { runs: [{ text: "Start" }], align: "left" },
        { runs: [{ text: "Even" }] },
        { runs: [] },
      ],
    });
    const xml = pptxObjectXml(text, 10, EMU_PER_PX);
    expect([...xml.matchAll(/<a:pPr algn="(\w+)"\/>/g)].map((hit) => hit[1])).toEqual(["ctr", "r", "l", "just", "just"]);
    expect(xml).toContain('<a:p><a:pPr algn="just"/><a:endParaRPr lang="en-US"/></a:p>');
  });

  it("writes names and alternative text of text boxes and shapes escaped, with a numbered name when there is none", () => {
    const text = createText({ name: "Title & more", alt: 'Says "hi"', text: "Hi" });
    expect(pptxObjectXml(text, 10, EMU_PER_PX)).toContain('<p:cNvPr id="10" name="Title &amp; more" descr="Says &quot;hi&quot;">');
    const shape = createShape("ellipse", { name: "", alt: "A <dot>" });
    expect(pptxObjectXml(shape, 11, EMU_PER_PX)).toContain('<p:cNvPr id="11" name="Shape 11" descr="A &lt;dot&gt;">');
    expect(pptxObjectXml(createText({ name: "", text: "Hi" }), 12, EMU_PER_PX)).toContain('<p:cNvPr id="12" name="Text 12">');
  });

  it("writes a shape without fill as unfilled and leaves out an outline with no width", () => {
    const xml = pptxObjectXml(createShape("rect", { fill: null, stroke: { color: "#000000", width: 0, style: "solid" } }), 10, EMU_PER_PX);
    expect(xml).toContain("<a:noFill/>");
    expect(xml).not.toContain("<a:ln");
  });

  it("falls back to a rectangle for a shape PowerPoint has no preset for", () => {
    expect(pptxObjectXml(createShape("path", { path: "M0 0L10 10Z" }), 10, EMU_PER_PX)).toContain('<a:prstGeom prst="rect"><a:avLst></a:avLst>');
  });

  it("writes the inner size of a star as its adjustment, and none when the star has no inner size", () => {
    expect(pptxObjectXml(createShape("star", { params: { inner: 0.4 } }), 10, EMU_PER_PX)).toContain(
      '<a:prstGeom prst="star5"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst>',
    );
    expect(pptxObjectXml(createShape("star-6", {}), 10, EMU_PER_PX)).toContain('<a:prstGeom prst="star6"><a:avLst></a:avLst>');
  });

  it("links only objects whose link is safe, and only when the slide gives them a relationship", () => {
    const unsafe = createShape("rect", { link: "javascript:alert(1)" });
    const safe = createShape("rect", { link: "https://example.com" });
    expect(pptxObjectXml(unsafe, 10, EMU_PER_PX, "rId100")).not.toContain("hlinkClick");
    expect(pptxObjectXml(safe, 11, EMU_PER_PX)).not.toContain("hlinkClick");
    expect(pptxObjectXml(safe, 11, EMU_PER_PX, "rId101")).toContain('<a:hlinkClick r:id="rId101"/>');
    // the id of a link follows the place of its object on the slide, so it matches the id the slide gives that object
    expect(pptxObjectLinks([unsafe, safe])).toEqual([{ id: "rId101", url: "https://example.com" }]);
  });
});
