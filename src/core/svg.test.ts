import { describe, expect, it } from "vitest";
import { extractSvgColors, iconNodeToSvg, normalizeSvg, parseViewBox, recolorSvg, setSvgStrokeWidth, svgColorKey, svgToDataUrl } from "./svg";

describe("svgColorKey", () => {
  it("normalises colours to lower case #rrggbb", () => {
    expect(svgColorKey("#FF0000")).toBe("#ff0000");
    expect(svgColorKey("  #0F0 ")).toBe("#00ff00");
    expect(svgColorKey("rgb(0, 0, 255)")).toBe("#0000ff");
    expect(svgColorKey("white")).toBe("#ffffff");
  });

  it("keeps currentColor, whatever its spelling", () => {
    expect(svgColorKey("currentColor")).toBe("currentColor");
    expect(svgColorKey("CURRENTCOLOR")).toBe("currentColor");
  });

  it("is null for what cannot be recoloured", () => {
    for (const raw of ["", "  ", "none", "transparent", "inherit", "context-fill", "context-stroke", "url(#gradient)", "papayawhip"]) {
      expect(svgColorKey(raw), raw).toBeNull();
    }
  });
});

describe("extractSvgColors", () => {
  it("lists the colours of fill, stroke, stop-color, flood-color and color attributes in order", () => {
    const svg = `<svg><rect fill="#FF0000" stroke='#00ff00'/><stop stop-color="#0000ff"/><feFlood flood-color="rgb(1,2,3)"/><g color="#abcdef"/></svg>`;
    expect(extractSvgColors(svg)).toEqual(["#ff0000", "#00ff00", "#0000ff", "#010203", "#abcdef"]);
  });

  it("reads colours from inline styles too, after the attributes", () => {
    const svg = `<svg><path style="fill:#111111;stroke: #222222" fill="#333333"/></svg>`;
    expect(extractSvgColors(svg)).toEqual(["#333333", "#111111", "#222222"]);
  });

  it("lists a colour once however often and however it is spelled", () => {
    const svg = `<svg><rect fill="#ABC"/><rect fill="#aabbcc"/><rect fill="rgb(170,187,204)"/></svg>`;
    expect(extractSvgColors(svg)).toEqual(["#aabbcc"]);
  });

  it("skips none, gradients and unknown names, and keeps currentColor", () => {
    const svg = `<svg fill="none" stroke="currentColor"><rect fill="url(#g)"/><rect fill="tomato"/></svg>`;
    expect(extractSvgColors(svg)).toEqual(["currentColor"]);
  });

  it("stops at twelve colours", () => {
    const svg = `<svg>${Array.from({ length: 15 }, (_, i) => `<rect fill="#${(i + 1).toString(16).padStart(2, "0").repeat(3)}"/>`).join("")}</svg>`;
    expect(extractSvgColors(svg)).toHaveLength(12);
  });

  it("finds nothing in plain markup", () => {
    expect(extractSvgColors("<svg><rect/></svg>")).toEqual([]);
    expect(extractSvgColors("")).toEqual([]);
  });

  it("does not remember where the last search stopped", () => {
    const svg = `<svg><rect fill="#123456"/></svg>`;
    expect(extractSvgColors(svg)).toEqual(extractSvgColors(svg));
  });
});

describe("recolorSvg", () => {
  const svg = `<svg><rect fill="#ff0000" stroke='#00FF00'/><path style="fill:#0000ff;stroke:none"/></svg>`;

  it("returns the markup untouched without a map, or with an empty one", () => {
    expect(recolorSvg(svg, undefined)).toBe(svg);
    expect(recolorSvg(svg, {})).toBe(svg);
  });

  it("swaps the mapped colours in attributes and styles, keeping the quotes", () => {
    const out = recolorSvg(svg, { "#ff0000": "#111111", "#00ff00": "rgb(1,2,3)", "#0000ff": "#999999" });
    expect(out).toBe(`<svg><rect fill="#111111" stroke='rgb(1,2,3)'/><path style="fill:#999999;stroke:none"/></svg>`);
  });

  it("matches colours however the file spells them", () => {
    expect(recolorSvg(`<svg><rect fill="#F00"/></svg>`, { "#ff0000": "#123456" })).toBe(`<svg><rect fill="#123456"/></svg>`);
  });

  it("leaves colours that are not in the map", () => {
    expect(recolorSvg(svg, { "#abcdef": "#000000" })).toBe(svg);
  });

  it("recolours currentColor", () => {
    expect(recolorSvg(`<svg stroke="currentColor"/>`, { currentColor: "#ff00ff" })).toBe(`<svg stroke="#ff00ff"/>`);
  });
});

describe("setSvgStrokeWidth", () => {
  it("adds the width to the root element", () => {
    expect(setSvgStrokeWidth(`<svg viewBox="0 0 24 24"><path/></svg>`, 3)).toBe(`<svg stroke-width="3" viewBox="0 0 24 24"><path/></svg>`);
  });

  it("replaces a width the root already has, with either kind of quote", () => {
    expect(setSvgStrokeWidth(`<svg stroke-width="2" fill="none"><path/></svg>`, 5)).toBe(`<svg stroke-width="5" fill="none"><path/></svg>`);
    expect(setSvgStrokeWidth(`<svg stroke-width='2'><path/></svg>`, 1.5)).toBe(`<svg stroke-width="1.5"><path/></svg>`);
  });

  it("only touches the root element", () => {
    expect(setSvgStrokeWidth(`<svg><path stroke-width="9"/></svg>`, 4)).toBe(`<svg stroke-width="4"><path stroke-width="9"/></svg>`);
  });

  it("leaves markup without an svg element as it is", () => {
    expect(setSvgStrokeWidth("<g/>", 2)).toBe("<g/>");
  });
});

describe("parseViewBox", () => {
  it("reads the viewBox with spaces or commas, signs and decimals", () => {
    expect(parseViewBox(`<svg viewBox="0 0 24 24">`)).toEqual({ x: 0, y: 0, w: 24, h: 24 });
    expect(parseViewBox(`<svg viewBox='-5,2.5 , 100 50e0'>`)).toEqual({ x: -5, y: 2.5, w: 100, h: 50 });
    expect(parseViewBox(`<svg VIEWBOX = " 1 2 3 4 ">`)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("falls back to width and height when the viewBox is empty or has no size", () => {
    expect(parseViewBox(`<svg viewBox="0 0 0 10" width="30" height="20">`)).toEqual({ x: 0, y: 0, w: 30, h: 20 });
    expect(parseViewBox(`<svg width="64.5" height='32'>`)).toEqual({ x: 0, y: 0, w: 64.5, h: 32 });
  });

  it("is null when the size cannot be known", () => {
    expect(parseViewBox(`<svg>`)).toBeNull();
    expect(parseViewBox(`<svg width="10">`)).toBeNull();
    expect(parseViewBox(`<svg width="0" height="10">`)).toBeNull();
    expect(parseViewBox(`<svg viewBox="0 0 10">`)).toBeNull();
    expect(parseViewBox("")).toBeNull();
  });
});

describe("normalizeSvg", () => {
  it("drops the XML declaration and the doctype and adds what a standalone image needs", () => {
    const out = normalizeSvg(`<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "x" "y">\n<svg width="50" height="25"><rect/></svg>`);
    expect(out.svg).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 25"><rect/></svg>`);
    expect([out.viewW, out.viewH]).toEqual([50, 25]);
  });

  it("keeps an existing namespace and viewBox and removes the fixed size", () => {
    const out = normalizeSvg(`  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20" width="100" height='200'><rect/></svg> `);
    expect(out.svg).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><rect/></svg>`);
    expect([out.viewW, out.viewH]).toEqual([10, 20]);
  });

  it("assumes a 100 x 100 picture when it has no size at all", () => {
    const out = normalizeSvg(`<svg><rect/></svg>`);
    expect(out.svg).toContain('viewBox="0 0 100 100"');
    expect([out.viewW, out.viewH]).toEqual([100, 100]);
  });

  it("keeps the origin of the view box when it is not zero", () => {
    const out = normalizeSvg(`<svg viewBox="-5 -5 10 10"/>`);
    expect(out.svg).toContain('viewBox="-5 -5 10 10"');
  });
});

describe("svgToDataUrl and iconNodeToSvg", () => {
  it("encodes markup so it survives in a URL", () => {
    const url = svgToDataUrl(`<svg a="b"/>`);
    expect(url).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22b%22%2F%3E");
    expect(decodeURIComponent(url.split(",")[1])).toBe(`<svg a="b"/>`);
  });

  it("wraps icon nodes in a 24 x 24 stroke icon", () => {
    const svg = iconNodeToSvg([
      ["path", { d: "M0 0L24 24" }],
      ["circle", { cx: 12, cy: 12, r: 3 }],
    ]);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('<path d="M0 0L24 24"/>');
    expect(svg).toContain('<circle cx="12" cy="12" r="3"/>');
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});
