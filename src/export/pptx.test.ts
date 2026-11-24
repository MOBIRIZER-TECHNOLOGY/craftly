import { describe, expect, it } from "vitest";
import { EMU_PER_PX, MAX_SLIDE_EMU, MIN_SLIDE_EMU, buildPptxParts, slideSize, xmlText, type PptxInput, type PptxSlide } from "./pptx";

const jpeg = (byte: number): PptxSlide => ({ image: new Uint8Array([0xff, 0xd8, byte]), type: "image/jpeg" });
const input = (over: Partial<PptxInput> = {}): PptxInput => ({ title: "Deck", width: 1920, height: 1080, slides: [jpeg(1), jpeg(2)], ...over });

/** The parts of a package by name, the text ones as text. */
function open(over: Partial<PptxInput> = {}) {
  const parts = buildPptxParts(input(over));
  const decoder = new TextDecoder();
  const text = new Map(parts.filter((p) => /\.(xml|rels)$/.test(p.name)).map((p) => [p.name, decoder.decode(p.data)]));
  return { parts, names: parts.map((p) => p.name), text, get: (name: string) => text.get(name) ?? "" };
}

/** True when every tag that opens is closed, in order. */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  if (/<\?|<!/.test(body)) return false;
  for (const tag of body.match(/<[^>]+>/g) ?? []) {
    if (tag.endsWith("/>")) continue;
    const name = /^<\/?([\w:]+)/.exec(tag)?.[1] ?? "";
    if (tag.startsWith("</")) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0 && !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(body);
}

/** The folder of a part and the part that lists its relationships. */
const folder = (name: string) => name.slice(0, name.lastIndexOf("/") + 1);
const relsName = (name: string) => `${folder(name)}_rels/${name.slice(folder(name).length)}.rels`;
/** A target as a path in the package: "../media/x" from "ppt/slides/" is "ppt/media/x". */
function resolve(from: string, target: string): string {
  const out = from.split("/").filter(Boolean);
  for (const step of target.split("/")) {
    if (step === "..") out.pop();
    else out.push(step);
  }
  return out.join("/");
}
const relationships = (xml: string) =>
  [...xml.matchAll(/<Relationship Id="([^"]+)" Type="([^"]+)" Target="([^"]+)"\/>/g)].map(([, id, type, target]) => ({ id, kind: type.split("/").pop(), target }));

describe("xmlText", () => {
  it("escapes markup and leaves out what XML does not allow", () => {
    expect(xmlText(`Fish & <chips> "to" go's`)).toBe("Fish &amp; &lt;chips&gt; &quot;to&quot; go&apos;s");
    expect(xmlText("a\u0000b\u0008c\u000bd\u001fe￾f\tg\nh")).toBe("abcdef\tg\nh");
    expect(xmlText("ok 😀 half \ud83d and \ude00 end")).toBe("ok 😀 half  and  end");
  });
});

describe("slideSize", () => {
  it("gives a page its own size, 9,525 units to the pixel", () => {
    expect(slideSize(1920, 1080)).toEqual({ cx: 1920 * EMU_PER_PX, cy: 1080 * EMU_PER_PX });
  });

  it("scales a page that is too large or too small for PowerPoint, both sides alike", () => {
    const large = slideSize(8000, 4000);
    expect(large).toEqual({ cx: MAX_SLIDE_EMU, cy: MAX_SLIDE_EMU / 2 });
    const small = slideSize(48, 96);
    expect(small).toEqual({ cx: MIN_SLIDE_EMU, cy: MIN_SLIDE_EMU * 2 });
  });

  it("holds a very long and thin page at the limits", () => {
    expect(slideSize(8000, 40)).toEqual({ cx: MAX_SLIDE_EMU, cy: MIN_SLIDE_EMU });
    expect(slideSize(10, 4000)).toEqual({ cx: MIN_SLIDE_EMU, cy: MAX_SLIDE_EMU });
    expect(slideSize(0, 0)).toEqual({ cx: MIN_SLIDE_EMU, cy: MIN_SLIDE_EMU });
  });
});

describe("buildPptxParts", () => {
  it("refuses a presentation without a slide", () => {
    expect(() => buildPptxParts(input({ slides: [] }))).toThrow(RangeError);
  });

  it("writes the list of content types first, and every text part as well-formed XML", () => {
    const { names, text } = open({ notes: true, slides: [{ ...jpeg(1), notes: "Say hello" }, jpeg(2)] });
    expect(names[0]).toBe("[Content_Types].xml");
    expect(new Set(names).size).toBe(names.length);
    for (const [name, xml] of text) expect([name, wellFormed(xml)]).toEqual([name, true]);
  });

  it("has a slide, its relationships and its picture for every page, in order", () => {
    const { parts, names, get } = open();
    expect(names.filter((n) => n.startsWith("ppt/slides/slide"))).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
    expect(parts.find((p) => p.name === "ppt/media/image1.jpeg")?.data).toEqual(new Uint8Array([0xff, 0xd8, 1]));
    expect(parts.find((p) => p.name === "ppt/media/image2.jpeg")?.data).toEqual(new Uint8Array([0xff, 0xd8, 2]));
    expect(get("ppt/presentation.xml")).toContain('<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>');
    expect(get("ppt/presentation.xml")).toContain(`<p:sldSz cx="${1920 * EMU_PER_PX}" cy="${1080 * EMU_PER_PX}"/>`);
    // the picture fills the slide
    expect(get("ppt/slides/slide1.xml")).toContain(`<a:off x="0" y="0"/><a:ext cx="${1920 * EMU_PER_PX}" cy="${1080 * EMU_PER_PX}"/>`);
    expect(get("ppt/slides/slide2.xml")).toContain('name="Page 2"');
    expect(get("docProps/app.xml")).toContain("<Slides>2</Slides>");
  });

  it("points every relationship at a part that is in the package, and every r:id at a relationship", () => {
    const { names, text } = open({ notes: true, slides: [{ ...jpeg(1), notes: "One" }, jpeg(2), { ...jpeg(3), notes: "Three" }] });
    const all = new Set(names);
    for (const [name, xml] of text) {
      if (!name.endsWith(".rels")) {
        const ids = [...xml.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map((hit) => hit[1]);
        const known = new Set(relationships(text.get(relsName(name)) ?? "").map((r) => r.id));
        for (const id of ids) expect([name, id, known.has(id)]).toEqual([name, id, true]);
        continue;
      }
      // "ppt/slides/_rels/slide1.xml.rels" lists what "ppt/slides/slide1.xml" points at, from "ppt/slides/"
      const from = name.replace(/_rels\/[^/]+$/, "");
      const list = relationships(xml);
      expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
      for (const rel of list) expect([name, rel.target, all.has(resolve(from, rel.target))]).toEqual([name, rel.target, true]);
    }
  });

  it("names the kind of every part: an override for each XML part, a default for pictures and relationships", () => {
    const { names, get } = open({
      notes: true,
      slides: [
        { ...jpeg(1), notes: "One" },
        { image: new Uint8Array([0x89]), type: "image/png" },
      ],
    });
    const types = get("[Content_Types].xml");
    const overrides = [...types.matchAll(/<Override PartName="\/([^"]+)"/g)].map((hit) => hit[1]);
    const xmlParts = names.filter((n) => n.endsWith(".xml") && n !== "[Content_Types].xml");
    expect([...overrides].sort()).toEqual([...xmlParts].sort());
    expect(types).toContain('<Default Extension="jpeg" ContentType="image/jpeg"/>');
    expect(types).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(types).toContain('<Default Extension="rels"');
    expect(names).toContain("ppt/media/image2.png");
    // a package of JPEG pictures only says nothing about PNG
    expect(open().get("[Content_Types].xml")).not.toContain("image/png");
    expect(open({ slides: [{ image: new Uint8Array([0x89]), type: "image/png" }] }).get("[Content_Types].xml")).not.toContain("image/jpeg");
  });

  it("writes the title, the names of pages and alternative text escaped", () => {
    const { get } = open({
      title: 'Q&A <"2026">',
      slides: [
        { ...jpeg(1), name: " Intro & more ", alt: 'A "red" <box>' },
        { ...jpeg(2), name: "  ", alt: "" },
      ],
    });
    expect(get("docProps/core.xml")).toContain("<dc:title>Q&amp;A &lt;&quot;2026&quot;&gt;</dc:title>");
    expect(get("ppt/slides/slide1.xml")).toContain('<p:cSld name="Intro &amp; more">');
    expect(get("ppt/slides/slide1.xml")).toContain('descr="A &quot;red&quot; &lt;box&gt;"');
    expect(get("ppt/slides/slide2.xml")).toContain("<p:cSld><p:spTree>");
    expect(get("ppt/slides/slide2.xml")).not.toContain("descr=");
  });

  it("writes the day it was made only when told", () => {
    expect(open().get("docProps/core.xml")).not.toContain("dcterms:created");
    expect(open({ created: new Date("2026-11-23T10:20:30.456Z") }).get("docProps/core.xml")).toContain(
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-23T10:20:30Z</dcterms:created>',
    );
  });

  it("leaves presenter notes out unless they are asked for", () => {
    const slides = [{ ...jpeg(1), notes: "Secret" }, jpeg(2)];
    const without = open({ slides });
    expect(without.names.some((n) => n.includes("notes"))).toBe(false);
    expect([...without.text.values()].join("")).not.toContain("Secret");
    expect(without.get("ppt/presentation.xml")).not.toContain("notesMasterIdLst");
    // asked for, but no page has any: still no notes master
    expect(open({ notes: true, slides: [jpeg(1), { ...jpeg(2), notes: "   " }] }).names.some((n) => n.includes("notes"))).toBe(false);
  });

  it("gives a slide with notes a notes page, and the package a notes master with a theme of its own", () => {
    const { names, get } = open({ notes: true, slides: [jpeg(1), { ...jpeg(2), notes: "First line\r\n\r\nA <b> & c" }] });
    expect(names.filter((n) => n.includes("notes"))).toEqual([
      "ppt/notesSlides/notesSlide2.xml",
      "ppt/notesSlides/_rels/notesSlide2.xml.rels",
      "ppt/notesMasters/notesMaster1.xml",
      "ppt/notesMasters/_rels/notesMaster1.xml.rels",
    ]);
    expect(names).toContain("ppt/theme/theme2.xml");
    const notes = get("ppt/notesSlides/notesSlide2.xml");
    expect(notes).toContain("<a:t>First line</a:t>");
    expect(notes).toContain('<a:p><a:endParaRPr lang="en-US"/></a:p>');
    expect(notes).toContain("<a:t>A &lt;b&gt; &amp; c</a:t>");
    expect(relationships(get("ppt/slides/_rels/slide2.xml.rels")).map((r) => r.kind)).toEqual(["slideLayout", "image", "notesSlide"]);
    expect(relationships(get("ppt/slides/_rels/slide1.xml.rels")).map((r) => r.kind)).toEqual(["slideLayout", "image"]);
    expect(relationships(get("ppt/notesSlides/_rels/notesSlide2.xml.rels")).map((r) => r.target)).toEqual(["../notesMasters/notesMaster1.xml", "../slides/slide2.xml"]);
    // the presentation names the notes master before the slides, as the format orders it
    const presentation = get("ppt/presentation.xml");
    expect(presentation.indexOf("notesMasterIdLst")).toBeGreaterThan(presentation.indexOf("sldMasterIdLst"));
    expect(presentation.indexOf("notesMasterIdLst")).toBeLessThan(presentation.indexOf("sldIdLst"));
    expect(presentation).toContain('<p:notesMasterId r:id="rId4"/>');
  });

  it("ties master, layout and theme together", () => {
    const { get } = open();
    expect(relationships(get("_rels/.rels")).map((r) => r.target)).toEqual(["ppt/presentation.xml", "docProps/core.xml", "docProps/app.xml"]);
    expect(relationships(get("ppt/_rels/presentation.xml.rels")).map((r) => r.kind)).toEqual(["slideMaster", "slide", "slide", "theme"]);
    expect(relationships(get("ppt/slideMasters/_rels/slideMaster1.xml.rels")).map((r) => r.kind)).toEqual(["slideLayout", "theme"]);
    expect(relationships(get("ppt/slideLayouts/_rels/slideLayout1.xml.rels")).map((r) => r.kind)).toEqual(["slideMaster"]);
    expect(get("ppt/slideLayouts/slideLayout1.xml")).toContain('type="blank"');
    // a theme has three of every style, which is the fewest the format takes
    expect(get("ppt/theme/theme1.xml").match(/<a:effectStyle>/g)).toHaveLength(3);
    expect(get("ppt/theme/theme1.xml").match(/<a:ln /g)).toHaveLength(3);
  });
});
