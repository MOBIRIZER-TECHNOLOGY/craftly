import { beforeAll, describe, expect, it, vi } from "vitest";
import { createChart, createDesign, createGraphic, createGroup, createLine, createPage, createShape, createTable, createText, solid } from "@/core/factory";
import { newPathShape } from "@/core/penShape";
import type { DesignElement, Fill, Page, Point, TextEffect } from "@/core/types";
import { layoutText } from "@/render/textLayout";

// This file loads the renderer and the font table, which takes a few seconds when many test files do the same at once:
// give it more time than the defaults so a busy machine does not fail it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type SvgModule = typeof import("./svg");
let svgModule: SvgModule;

beforeAll(async () => {
  // render/renderPage.ts builds a Path2D at import time; node has none
  vi.stubGlobal("Path2D", class {});
  svgModule = await import("./svg");
});

const render = async (elements: DesignElement[], background: Fill = solid("#ffffff"), opts: { w?: number; h?: number; title?: string } = {}) => {
  const page: Page = createPage({ background, elements });
  const design = createDesign({ width: opts.w ?? 800, height: opts.h ?? 600, pages: [page] });
  const out = await svgModule.designPageToSvg(design, page, { embedFonts: false, title: opts.title ?? "Test design" });
  return { ...out, page, design };
};

/** A deliberately small, strict XML checker: balanced tags, quoted attributes, legal entities, unique ids. */
function checkXml(xml: string): { ids: string[]; refs: string[]; tags: Record<string, number> } {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack: string[] = [];
  const tags: Record<string, number> = {};
  const ids: string[] = [];
  const refs: string[] = [];
  let i = 0;
  let root = 0;
  while (i < body.length) {
    if (body[i] !== "<") {
      const next = body.indexOf("<", i);
      const text = body.slice(i, next < 0 ? body.length : next);
      expect(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text), `bad entity in text "${text.slice(0, 60)}"`).toBe(false);
      if (!stack.length) expect(text.trim(), "text outside the root element").toBe("");
      i = next < 0 ? body.length : next;
      continue;
    }
    if (body.startsWith("<!--", i)) {
      i = body.indexOf("-->", i) + 3;
      continue;
    }
    const end = body.indexOf(">", i);
    expect(end, "unterminated tag").toBeGreaterThan(i);
    const tag = body.slice(i + 1, end);
    i = end + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      expect(stack.pop(), `closing </${name}>`).toBe(name);
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const m = tag.match(/^([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*\/?$/);
    expect(m, `malformed tag <${tag.slice(0, 120)}>`).not.toBeNull();
    const [, name, attrText] = m!;
    tags[name] = (tags[name] ?? 0) + 1;
    for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
      expect(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(a[2]), `bad entity in ${a[1]}="${a[2].slice(0, 40)}"`).toBe(false);
      if (a[1] === "id") ids.push(a[2]);
      for (const u of a[2].matchAll(/url\(#([^)]+)\)/g)) refs.push(u[1]);
      if ((a[1] === "xlink:href" || a[1] === "href") && a[2].startsWith("#")) refs.push(a[2].slice(1));
    }
    if (!stack.length) root++;
    if (!selfClosing) stack.push(name);
  }
  expect(stack, "unclosed elements").toEqual([]);
  expect(root, "exactly one root element").toBe(1);
  expect(new Set(ids).size, "unique ids").toBe(ids.length);
  for (const r of refs) expect(ids, `reference #${r}`).toContain(r);
  return { ids, refs, tags };
}

const sampleGraphic =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" fill="none" stroke="#112233" stroke-width="2"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect id="r" width="20" height="10" fill="url(#g)"/><script>alert(1)</script><circle cx="5" cy="5" r="3" onclick="evil()"/></svg>';

describe("document", () => {
  it("is a standalone, well-formed SVG sized like the design", async () => {
    const { svg } = await render([createShape("rect", { x: 10, y: 20, width: 100, height: 50, fill: solid("#ff0000") })], solid("#112233"), {
      w: 1920,
      h: 1080,
      title: 'Plan "Q4" <draft> & more',
    });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(svg).toContain('width="1920" height="1080" viewBox="0 0 1920 1080"');
    expect(svg).toContain('<title>Plan "Q4" &lt;draft&gt; &amp; more</title>');
    expect(svg).toContain('<rect width="1920" height="1080" fill="#112233"/>');
    checkXml(svg);
  });

  it("omits hidden elements and strips characters XML cannot hold", async () => {
    const { svg } = await render([
      createShape("rect", { x: 0, y: 0, width: 10, height: 10, hidden: true, fill: solid("#abcdef") }),
      createText({ text: "ok\u0000\u0007 <b>&", x: 0, y: 0 }),
    ]);
    expect(svg).not.toContain("#abcdef");
    expect(svg).toContain("ok");
    expect(svg).toContain("&lt;b&gt;&amp;");
    // eslint-disable-next-line no-control-regex -- XML has no control characters
    expect(svg).not.toMatch(/[\u0000-\u0008]/);
    checkXml(svg);
  });
});

describe("backgrounds and fills", () => {
  it("writes gradients as userSpaceOnUse defs that match the canvas geometry", async () => {
    const { svg } = await render(
      [],
      {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 1, color: "#0000ff" },
          { offset: 0, color: "#ff0000" },
        ],
      },
      { w: 400, h: 200 },
    );
    // 90deg = towards the right: a horizontal vector across the box, stops sorted by offset
    expect(svg).toMatch(
      /<linearGradient id="cf-lg1" gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="400" y2="100"><stop offset="0" stop-color="#ff0000"\/><stop offset="1" stop-color="#0000ff"\/><\/linearGradient>/,
    );
    expect(svg).toContain('fill="url(#cf-lg1)"');
    checkXml(svg);
  });

  it("splits rgba() colours into colour + opacity (SVG 1.1 has no rgba)", async () => {
    const { svg } = await render([createShape("rect", { x: 0, y: 0, width: 10, height: 10, fill: solid("rgba(255, 0, 0, 0.5)") })]);
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.5"');
    expect(svg).not.toContain("rgba(");
  });

  it("never lets a colour string smuggle in references or markup", async () => {
    const { svg } = await render([
      createShape("rect", { x: 0, y: 0, width: 10, height: 10, fill: solid("url(https://tracker.example/x.png)") }),
      createShape("rect", { x: 0, y: 0, width: 10, height: 10, fill: solid('red" onload="evil()') }),
      createShape("rect", { x: 0, y: 0, width: 10, height: 10, fill: solid("red") }),
    ]);
    expect(svg).not.toContain("tracker.example");
    expect(svg).not.toContain("onload");
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('fill="red"');
    checkXml(svg);
  });

  it("builds radial gradients from the canvas formula", async () => {
    const { svg } = await render(
      [],
      {
        type: "radial",
        cx: 0.25,
        cy: 0.5,
        stops: [
          { offset: 0, color: "#fff" },
          { offset: 1, color: "#000" },
        ],
      },
      { w: 400, h: 200 },
    );
    // r = distance from the centre to the farthest corner
    expect(svg).toMatch(/<radialGradient id="cf-rg1" gradientUnits="userSpaceOnUse" cx="100" cy="100" r="316\.228" fx="100" fy="100">/);
  });

  it("reproduces procedural patterns as <pattern> tiles", async () => {
    const kinds = ["dots", "grid", "lines", "diagonal", "checker", "waves", "zigzag", "plus", "bubbles"] as const;
    for (const pattern of kinds) {
      const { svg } = await render([], { type: "pattern", pattern, color: "#123456", background: "#fedcba", scale: 1.5 });
      const m = svg.match(/<pattern id="(cf-pt\d+)" patternUnits="userSpaceOnUse" width="(\d+)" height="(\d+)">/);
      expect(m, pattern).not.toBeNull();
      expect(svg).toContain('fill="#fedcba"');
      expect(svg).toContain("#123456");
      expect(svg).toContain(`fill="url(#${m![1]})"`);
      checkXml(svg);
    }
  });

  it("de-duplicates identical gradients", async () => {
    const g: Fill = {
      type: "linear",
      angle: 0,
      stops: [
        { offset: 0, color: "#000" },
        { offset: 1, color: "#fff" },
      ],
    };
    const { svg } = await render([createShape("rect", { x: 0, y: 0, width: 50, height: 50, fill: g }), createShape("rect", { x: 100, y: 0, width: 50, height: 50, fill: g })]);
    expect((svg.match(/<linearGradient /g) ?? []).length).toBe(1);
    expect((svg.match(/fill="url\(#cf-lg1\)"/g) ?? []).length).toBe(2);
  });
});

describe("shapes and lines", () => {
  it("uses <rect> / <ellipse> where it can and <path> otherwise", async () => {
    const { svg } = await render([
      createShape("rect", { x: 0, y: 0, width: 100, height: 60, radius: 12 }),
      createShape("ellipse", { x: 0, y: 0, width: 80, height: 40 }),
      createShape("star", { x: 0, y: 0, width: 80, height: 80 }),
      createShape("ring", { x: 0, y: 0, width: 80, height: 80 }),
    ]);
    expect(svg).toContain('<rect width="100" height="60" rx="12" fill="#0e1318"/>');
    expect(svg).toContain('<ellipse cx="40" cy="20" rx="40" ry="20" fill="#0e1318"/>');
    expect(svg).toMatch(/<path d="M[^"]+Z" fill="#0e1318"\/>/);
    expect(svg).toContain('fill-rule="evenodd"');
    checkXml(svg);
  });

  it("writes a path made with the Pen as a <path> with its curves, in the pixels of its box", async () => {
    const node = (x: number, y: number, handleIn: Point | null, handleOut: Point | null) => ({ x, y, handleIn, handleOut });
    const made = newPathShape({ closed: false, nodes: [node(10, 20, null, { x: 40, y: 0 }), node(110, 80, { x: -40, y: 0 }, null)] }, { color: "#ff0066", strokeWidth: 6 });
    const { svg } = await render([createShape("path", made)]);
    expect(made).toMatchObject({ x: 10, y: 20, width: 100, height: 60 });
    expect(svg).toContain('<g transform="translate(10 20)">');
    expect(svg).toContain('<path d="M0 0C40 0 60 60 100 60" fill="none" stroke="#ff0066" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>');
    checkXml(svg);
  });

  it("fills a closed path made with the Pen and gives it no outline", async () => {
    const corner = (x: number, y: number) => ({ x, y, handleIn: null, handleOut: null });
    const made = newPathShape({ closed: true, nodes: [corner(0, 0), corner(100, 0), corner(50, 80)] }, { color: "#0e1318", strokeWidth: 6 });
    const { svg } = await render([createShape("path", made)]);
    expect(svg).toContain('<path d="M0 0L100 0L50 80L0 0Z" fill="#0e1318"/>');
    expect(svg).not.toContain("stroke");
  });

  it("keeps dashed outlines on the path the canvas draws (not <ellipse>'s start point)", async () => {
    const { svg } = await render([createShape("ellipse", { x: 0, y: 0, width: 80, height: 40, stroke: { color: "#f00", width: 4, style: "dashed", cap: "round" } })]);
    expect(svg).not.toContain("<ellipse");
    expect(svg).toContain('stroke-dasharray="12 8"');
    expect(svg).toContain('stroke-linecap="round"');
  });

  it("writes stroke styles like applyStroke does", async () => {
    const { svg } = await render([
      createShape("rect", { x: 0, y: 0, width: 50, height: 50, fill: null, stroke: { color: "#112233", width: 5, style: "dotted" } }),
      createShape("rect", { x: 0, y: 0, width: 50, height: 50, fill: null, stroke: { color: "#112233", width: 3, style: "solid", join: "miter", cap: "square" } }),
    ]);
    expect(svg).toContain('stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.01 10"');
    expect(svg).toContain('stroke-width="3" stroke-linecap="square" stroke-miterlimit="10"');
    expect(svg).toContain('fill="none"');
  });

  it("applies rotation and flips about the element centre, nested for groups", async () => {
    const child = createShape("rect", { x: 10, y: 20, width: 30, height: 40, rotation: 90 });
    const group = createGroup([child], { x: 100, y: 100, width: 200, height: 100, rotation: 30, flipH: true });
    const { svg } = await render([group]);
    expect(svg).toContain('<g transform="translate(200 150) rotate(30) scale(-1 1) translate(-100 -50)">');
    expect(svg).toContain('<g transform="translate(25 40) rotate(90) translate(-15 -20)">');
    checkXml(svg);
  });

  it("multiplies opacity down the tree into per-primitive alpha", async () => {
    const child = createShape("rect", { x: 0, y: 0, width: 10, height: 10, opacity: 0.5, fill: solid("#00ff00") });
    const { svg } = await render([createGroup([child], { x: 0, y: 0, width: 10, height: 10, opacity: 0.5 })]);
    expect(svg).toContain('fill="#00ff00" fill-opacity="0.25"');
  });

  it("draws shadows with a userSpaceOnUse filter and keeps screen-space offsets under rotation", async () => {
    const { svg } = await render([createShape("rect", { x: 0, y: 0, width: 100, height: 100, rotation: 90, shadow: { color: "rgba(0,0,0,.5)", blur: 20, x: 0, y: 10 } })]);
    const f = svg.match(/<filter id="(cf-sh\d+)" filterUnits="userSpaceOnUse"[^>]*color-interpolation-filters="sRGB">(.*?)<\/filter>/);
    expect(f).not.toBeNull();
    // the canvas shadow points straight down on screen; inside an element turned 90deg that is local +x
    expect(f![2]).toContain('stdDeviation="10"');
    expect(f![2]).toMatch(/dx="10" dy="0"/);
    expect(f![2]).toContain('flood-opacity="0.5"');
    expect(svg).toContain(`filter="url(#${f![1]})"`);
    checkXml(svg);
  });

  it("blurs elements with a gaussian filter", async () => {
    const { svg } = await render([createShape("ellipse", { x: 0, y: 0, width: 60, height: 60, blur: 4 })]);
    expect(svg).toMatch(/<filter id="cf-bl1" filterUnits="userSpaceOnUse"[^>]*><feGaussianBlur stdDeviation="4"\/><\/filter>/);
    expect(svg).toContain('filter="url(#cf-bl1)"');
  });

  it("reproduces line shafts and every arrow head", async () => {
    const kinds = ["arrow", "triangle", "open-arrow", "circle", "square", "diamond", "bar"] as const;
    for (const kind of kinds) {
      const { svg } = await render([
        createLine({
          x: 10,
          y: 50,
          width: 200,
          endArrow: kind,
          startArrow: kind === "bar" ? "arrow" : "none",
          stroke: { color: "#7c3aed", width: 6, style: "solid", cap: "round" },
        }),
      ]);
      expect(svg, kind).toContain('<g transform="translate(200 0)">');
      checkXml(svg);
    }
    const { svg } = await render([createLine({ x: 0, y: 0, width: 100, endArrow: "arrow", stroke: { color: "#000", width: 4, style: "solid" } })]);
    // head = max(4 * 3.2, 14) = 14; the shaft stops 0.9 heads short of the tip
    expect(svg).toContain('<path d="M0 0L100 0"'.replace("100", "87.4"));
    expect(svg).toContain('<path d="M0 0L-14 -7.7L-14 7.7Z"');
  });
});

describe("text", () => {
  const textEl = (extra: Record<string, unknown> = {}) =>
    createText({ text: "Hello brave world", x: 40, y: 30, width: 300, autoWidth: false, fontSize: 32, fontFamily: "Poppins", fontWeight: 600, color: "#222222", ...extra });

  it("places every word at the layout engine's coordinates", async () => {
    const el = textEl({ text: "Hello brave new world of wrapped text", align: "center" });
    const { svg } = await render([el]);
    const layout = layoutText(el);
    expect(layout.lines.length).toBeGreaterThan(1);
    const round = (n: number) => String(Math.round(n * 1000) / 1000);
    for (const line of layout.lines) {
      for (const seg of line.segments.filter((s) => !s.isSpace)) {
        expect(svg, seg.text).toContain(`<tspan x="${round(line.x + seg.x)}" y="${round(line.y + line.baseline)}">${seg.text}</tspan>`);
      }
    }
    expect(svg).toContain('font-family="\'Poppins\', sans-serif" font-size="32" font-weight="600" fill="#222222"');
    checkXml(svg);
  });

  it("only repeats style attributes on runs that differ", async () => {
    const el = textEl({
      paragraphs: [{ runs: [{ text: "plain " }, { text: "bold", bold: true }, { text: " red", color: "#ff0000" }, { text: " big", size: 64 }, { text: " ital", italic: true }] }],
    });
    const { svg } = await render([el]);
    expect(svg).toMatch(/>plain<\/tspan>/);
    expect(svg).toMatch(/font-weight="700"[^>]*>bold<\/tspan>/);
    expect(svg).toMatch(/fill="#ff0000"[^>]*>red<\/tspan>/);
    expect(svg).toMatch(/font-size="64"[^>]*>big<\/tspan>/);
    expect(svg).toMatch(/font-style="italic"[^>]*>ital<\/tspan>/);
    checkXml(svg);
  });

  it("draws underline and strike-through as canvas-geometry rectangles", async () => {
    const el = textEl({ text: "under", underline: true, strike: true, fontSize: 40, width: 400 });
    const { svg } = await render([el]);
    const line = layoutText(el).lines[0];
    const y = line.y + line.baseline;
    expect(svg).toContain(`<rect x="${line.x}" y="${Math.round((y + 4) * 1000) / 1000}" width="${Math.round(line.segments[0].width * 1000) / 1000}" height="2.4" fill="#222222"/>`);
    expect(svg).toContain(`y="${Math.round((y - 12) * 1000) / 1000}"`);
  });

  it("paints gradient text through a gradient sized to the layout box", async () => {
    const el = textEl({
      gradient: {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    });
    const { svg } = await render([el]);
    expect(svg).toContain('<text font-family="\'Poppins\', sans-serif" font-size="32" font-weight="600" fill="url(#cf-lg1)">');
    expect(svg).toMatch(/<linearGradient id="cf-lg1" gradientUnits="userSpaceOnUse" x1="0" y1="[\d.]+" x2="300" y2="[\d.]+">/);
  });

  it("renders list markers", async () => {
    const { svg } = await render([textEl({ text: "first\nsecond", list: "number" }), textEl({ y: 200, text: "dot", list: "bullet" })]);
    expect(svg).toContain(">1.</tspan>");
    expect(svg).toContain(">2.</tspan>");
    expect(svg).toContain(">•</tspan>");
  });

  const effectKinds: TextEffect["kind"][] = ["none", "shadow", "lift", "hollow", "splice", "outline", "echo", "glitch", "neon", "background"];
  it.each(effectKinds)("renders the %s effect as valid markup", async (kind) => {
    const { svg } = await render([textEl({ effect: { kind, color: "#ff00aa", offset: 50, blur: 40, intensity: 60, thickness: 50, roundness: 50, spread: 50 } })]);
    checkXml(svg);
    const texts = (svg.match(/<text[ >]/g) ?? []).length;
    const filters = (svg.match(/<filter /g) ?? []).length;
    const expected: Record<string, { texts: number; filters: number }> = {
      none: { texts: 1, filters: 0 },
      shadow: { texts: 1, filters: 1 },
      lift: { texts: 1, filters: 1 },
      hollow: { texts: 1, filters: 0 },
      splice: { texts: 2, filters: 0 },
      outline: { texts: 2, filters: 0 },
      echo: { texts: 3, filters: 0 },
      glitch: { texts: 3, filters: 0 },
      neon: { texts: 4, filters: 3 },
      background: { texts: 1, filters: 0 },
    };
    expect({ texts, filters }, kind).toEqual(expected[kind]);
    if (kind === "hollow" || kind === "outline" || kind === "splice") expect(svg).toContain('fill="none" stroke-width=');
    if (kind === "background") expect(svg).toMatch(/<rect x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+" fill="#ff00aa"\/>/);
  });

  it("puts curved text on an arc with <textPath>", async () => {
    const { svg } = await render([textEl({ text: "ROUND WORDS", curve: 60, autoWidth: true, width: undefined })]);
    expect(svg).toMatch(/<path id="cf-arc1" d="M[-\d.]+ [-\d.]+A[\d.]+ [\d.]+ 0 [01] 1 [-\d.]+ [-\d.]+"\/>/);
    expect(svg).toMatch(/<textPath xlink:href="#cf-arc1" startOffset="0">ROUND<\/textPath>/);
    expect(svg).toContain("font-kerning:none");
    checkXml(svg);
    const bow = await render([textEl({ text: "BOWED", curve: -50, autoWidth: true, width: undefined })]);
    expect(bow.svg).toMatch(/A[\d.]+ [\d.]+ 0 [01] 0 /); // the other way round the circle
  });
});

describe("tables, charts and graphics", () => {
  it("draws tables as rects, wrapped text and borders", async () => {
    const { svg } = await render([
      createTable({
        x: 10,
        y: 10,
        width: 300,
        height: 120,
        cells: [
          ["A", "B"],
          ["one", "a very long cell that has to wrap"],
        ],
        colWidths: [100, 200],
        rowHeights: [40, 80],
      }),
    ]);
    expect(svg).toContain('fill="#7c3aed"'); // header
    expect(svg).toContain(">A</text>");
    expect(svg).toContain(">one</text>");
    expect(svg).toMatch(/stroke-width="2"/); // borders
    checkXml(svg);
  });

  it("draws every chart kind", async () => {
    for (const chart of ["column", "bar", "line", "area", "pie", "donut"] as const) {
      const { svg } = await render([
        createChart({ x: 0, y: 0, width: 400, height: 260, chart, showLegend: true, series: [{ name: "S", values: [4, 8, 6] }], labels: ["a", "b", "c"] }),
      ]);
      checkXml(svg);
      expect(svg, chart).toContain(">a</text>");
    }
    const donut = await render([createChart({ x: 0, y: 0, width: 300, height: 300, chart: "donut", series: [{ name: "S", values: [5] }], labels: ["only"] })]);
    // a single slice is a full ring made of two half arcs per circle, the inner one running the other way
    expect(donut.svg).toMatch(
      /A[\d.]+ [\d.]+ 0 1 1 [\d.]+ [\d.]+A[\d.]+ [\d.]+ 0 1 1 [\d.]+ [\d.]+ZM[\d.]+ [\d.]+A[\d.]+ [\d.]+ 0 1 0 [\d.]+ [\d.]+A[\d.]+ [\d.]+ 0 1 0 [\d.]+ [\d.]+Z/,
    );
  });

  it("inlines graphics as nested svg with scoped ids and without scripts", async () => {
    const g = createGraphic({ svg: sampleGraphic, x: 20, y: 30, width: 200, height: 100, colors: { "#112233": "#aa00ff" } });
    const { svg } = await render([g, createGraphic({ svg: sampleGraphic, x: 300, y: 30, width: 100, height: 50 })]);
    expect(svg).toContain('<svg x="0" y="0" width="200" height="100" viewBox="0 0 20 10"');
    expect(svg).toContain('stroke="#aa00ff"'); // recoloured copy
    expect(svg).toContain('id="g1-g"');
    expect(svg).toContain('id="g2-g"');
    expect(svg).toContain('fill="url(#g1-g)"');
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("onclick");
    checkXml(svg);
  });
});

describe("inlined graphics stay isolated", () => {
  const styled =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@import url(https://evil.example/x.css); .cls-1{fill:#ff0000;background:url(https://evil.example/t.png)}.cls-2{stroke:#00ff00}</style><rect class="cls-1" width="5" height="5"/><rect class="cls-1 other cls-2" x="5" width="5" height="5"/><image href="https://evil.example/pixel.png" width="1" height="1"/><use href="#a"/><g id="a"/></svg>';

  it("prefixes class names per graphic and removes anything that leaves the document", async () => {
    const { svg } = await render([createGraphic({ svg: styled, x: 0, y: 0, width: 50, height: 50 }), createGraphic({ svg: styled, x: 60, y: 0, width: 50, height: 50 })]);
    expect(svg).toContain(".g1-cls-1{fill:#ff0000");
    expect(svg).toContain(".g2-cls-2{stroke:#00ff00}");
    expect(svg).toContain('class="g1-cls-1 other g1-cls-2"');
    expect(svg).toContain('class="g2-cls-1"');
    expect(svg).not.toContain("evil.example");
    expect(svg).not.toContain("@import");
    expect(svg).toContain('<use xlink:href="#g1-a"'.replace("xlink:", "")); // internal references survive, renamed
    checkXml(svg);
  });
});

describe("links and accessibility", () => {
  it("wraps linked elements in anchors and drops unsafe schemes", async () => {
    const { svg } = await render([
      createShape("rect", { x: 0, y: 0, width: 50, height: 50, link: "https://example.com/a?b=1&c=2" }),
      createShape("rect", { x: 60, y: 0, width: 50, height: 50, link: "javascript:alert(1)" }),
      createShape("rect", { x: 120, y: 0, width: 50, height: 50, link: "example.org" }),
    ]);
    expect(svg).toContain('<a xlink:href="https://example.com/a?b=1&amp;c=2">');
    expect(svg).toContain('<a xlink:href="https://example.org">');
    expect(svg).not.toContain("javascript:");
    expect((svg.match(/<a /g) ?? []).length).toBe(2);
    checkXml(svg);
  });

  it("labels elements that have alternative text", async () => {
    const { svg } = await render([createShape("rect", { x: 5, y: 5, width: 50, height: 50, alt: 'A "quoted" <logo>' })]);
    expect(svg).toContain('role="img" aria-label="A &quot;quoted&quot; &lt;logo&gt;"');
    checkXml(svg);
  });
});
