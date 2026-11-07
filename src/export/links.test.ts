import { describe, expect, it } from "vitest";
import { createGroup, createLine, createPage, createShape, createText } from "@/core/factory";
import { applyMatrix, collectPageLinks, elementMatrix, IDENTITY, inverseLinear, multiply, safeLinkUrl } from "./links";

const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe("affine helpers", () => {
  it("multiplies in 'apply the right one first' order", () => {
    const translate: [number, number, number, number, number, number] = [1, 0, 0, 1, 10, 20];
    const scale: [number, number, number, number, number, number] = [2, 0, 0, 3, 0, 0];
    expect(applyMatrix(multiply(translate, scale), 1, 1)).toEqual({ x: 12, y: 23 });
    expect(applyMatrix(multiply(scale, translate), 1, 1)).toEqual({ x: 22, y: 63 });
    expect(multiply(IDENTITY, translate)).toEqual(translate);
  });

  it("places an unrotated element by its top-left corner", () => {
    const m = elementMatrix({ x: 40, y: 30, width: 100, height: 50, rotation: 0 });
    expect(applyMatrix(m, 0, 0)).toEqual({ x: 40, y: 30 });
    expect(applyMatrix(m, 100, 50)).toEqual({ x: 140, y: 80 });
  });

  it("rotates clockwise about the centre like the canvas renderer", () => {
    const m = elementMatrix({ x: 0, y: 0, width: 100, height: 100, rotation: 90 });
    // the top-left corner of a square turned 90 degrees clockwise lands on the top-right corner
    const p = applyMatrix(m, 0, 0);
    near(p.x, 100);
    near(p.y, 0);
    const c = applyMatrix(m, 50, 50);
    near(c.x, 50);
    near(c.y, 50);
  });

  it("flips about the centre", () => {
    const m = elementMatrix({ x: 0, y: 0, width: 100, height: 40, rotation: 0, flipH: true });
    expect(applyMatrix(m, 0, 0)).toEqual({ x: 100, y: 0 });
    const v = elementMatrix({ x: 0, y: 0, width: 100, height: 40, rotation: 0, flipV: true });
    expect(applyMatrix(v, 0, 0)).toEqual({ x: 0, y: 40 });
  });

  it("inverts the rotation for screen-space offsets", () => {
    const m = elementMatrix({ x: 5, y: 5, width: 10, height: 10, rotation: 90 });
    const local = inverseLinear(m, 0, 10); // screen "down" ...
    near(local.x, 10); // ... is local "right" after a 90 degree clockwise turn
    near(local.y, 0);
    const flip = inverseLinear(elementMatrix({ x: 0, y: 0, width: 4, height: 4, rotation: 0, flipH: true }), 3, 2);
    near(flip.x, -3);
    near(flip.y, 2);
  });
});

describe("safeLinkUrl", () => {
  it("keeps web, mail and phone links", () => {
    expect(safeLinkUrl("https://craftly.test/a?b=c")).toBe("https://craftly.test/a?b=c");
    expect(safeLinkUrl("  http://x.org ")).toBe("http://x.org");
    expect(safeLinkUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeLinkUrl("tel:+15551234")).toBe("tel:+15551234");
  });

  it("completes bare domains with https", () => {
    expect(safeLinkUrl("example.com")).toBe("https://example.com");
    expect(safeLinkUrl("www.example.com/path?x=1")).toBe("https://www.example.com/path?x=1");
  });

  it("rejects scripts, data URLs, junk and empty input", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "vbscript:x",
      "",
      "   ",
      "hello world",
      "nodots",
      "https://a\nb",
      undefined,
      null,
    ]) {
      expect(safeLinkUrl(bad as string), String(bad)).toBeNull();
    }
  });
});

describe("collectPageLinks", () => {
  it("returns the bounds of linked, visible elements only", () => {
    const page = createPage();
    page.elements.push(
      createShape("rect", { x: 100, y: 200, width: 300, height: 80, link: "https://a.test" }),
      createShape("rect", { x: 0, y: 0, width: 10, height: 10 }),
      createText({ text: "hidden", x: 0, y: 0, width: 50, link: "https://hidden.test", hidden: true }),
      createText({ text: "bad", x: 0, y: 0, width: 50, link: "javascript:alert(1)" }),
    );
    expect(collectPageLinks(page)).toEqual([{ url: "https://a.test", x: 100, y: 200, w: 300, h: 80 }]);
  });

  it("uses the axis-aligned bounds of rotated elements", () => {
    const page = createPage();
    page.elements.push(createShape("rect", { x: 0, y: 0, width: 100, height: 100, rotation: 45, link: "https://r.test" }));
    const [link] = collectPageLinks(page);
    near(link.w, 141.421356, 4);
    near(link.h, 141.421356, 4);
    near(link.x, -20.710678, 4);
  });

  it("composes group transforms for children", () => {
    const child = createShape("rect", { x: 10, y: 20, width: 30, height: 40, link: "https://child.test" });
    const group = createGroup([child], { x: 100, y: 100, width: 200, height: 200, rotation: 0 });
    const page = createPage({ elements: [group] });
    expect(collectPageLinks(page)).toEqual([{ url: "https://child.test", x: 110, y: 120, w: 30, h: 40 }]);

    const flipped = createGroup([{ ...child }], { x: 100, y: 100, width: 200, height: 200, rotation: 0, flipH: true });
    const [mirror] = collectPageLinks(createPage({ elements: [flipped] }));
    expect(mirror).toMatchObject({ x: 100 + 200 - 40, y: 120, w: 30, h: 40 });
  });

  it("gives straight lines a clickable thickness", () => {
    const page = createPage({ elements: [createLine({ x: 50, y: 60, width: 200, link: "https://l.test", stroke: { color: "#000", width: 2, style: "solid" } })] });
    const [link] = collectPageLinks(page);
    expect(link.w).toBeCloseTo(208);
    expect(link.h).toBeCloseTo(8);
    expect(link.y).toBeCloseTo(56);
  });
});
