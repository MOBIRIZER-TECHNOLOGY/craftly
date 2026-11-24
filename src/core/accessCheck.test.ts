import { describe, expect, it } from "vitest";
import { CONTRAST_LARGE, CONTRAST_NORMAL, checkAccessibility, neededContrast } from "./accessCheck";
import { createChart, createGroup, createImage, createLine, createPage, createShape, createText, solid } from "./factory";
import type { DesignElement, Fill, ImageElement, Page } from "./types";

const page = (elements: DesignElement[], background: Fill = solid("#ffffff")): Page => createPage({ elements, background });
const check = (...pages: Page[]) => checkAccessibility({ pages });
const text = (init: Parameters<typeof createText>[0] = {}) => createText({ text: "Read me", fontSize: 16, x: 100, y: 100, width: 200, color: "#111111", ...init });
const box = (color: string, init: Parameters<typeof createShape>[1] = {}) => createShape("rect", { x: 50, y: 50, width: 400, height: 300, fill: solid(color), ...init });
const photo = (init: Partial<ImageElement> = {}) => createImage({ src: "asset:1", x: 600, y: 100, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200, ...init });

describe("the contrast a text needs", () => {
  it("is 4.5 to 1, and 3 to 1 for large text: 24 px, or 18.66 px in bold", () => {
    expect(neededContrast(16, 400)).toBe(CONTRAST_NORMAL);
    expect(neededContrast(23.9, 400)).toBe(CONTRAST_NORMAL);
    expect(neededContrast(24, 400)).toBe(CONTRAST_LARGE);
    expect(neededContrast(18.66, 700)).toBe(CONTRAST_LARGE);
    expect(neededContrast(18.66, 600)).toBe(CONTRAST_NORMAL);
    expect(neededContrast(18, 700)).toBe(CONTRAST_NORMAL);
  });
});

describe("text that does not stand out", () => {
  it("is found against the colour of the page, with the two colours, the ratio and what is needed", () => {
    const grey = text({ color: "#999999" });
    const [issue] = check(page([grey]));
    expect(issue).toEqual({
      kind: "contrast",
      pageId: expect.any(String),
      pageIndex: 0,
      elementId: grey.id,
      topId: grey.id,
      label: "Read me",
      ratio: 2.85,
      needed: 4.5,
      color: "#999999",
      background: "#ffffff",
    });
  });

  it("is not reported when it stands out enough, and large text needs less", () => {
    expect(check(page([text({ color: "#111111" })]))).toEqual([]);
    // 3.54 to 1: too little for small text, enough for a heading
    expect(check(page([text({ color: "#888888" })])).map((i) => i.ratio)).toEqual([3.54]);
    expect(check(page([text({ color: "#888888", fontSize: 40 })]))).toEqual([]);
    expect(check(page([text({ color: "#888888", fontSize: 20, fontWeight: 700 })]))).toEqual([]);
  });

  it("is judged against the shape that lies under its middle, the one on top when there are several", () => {
    const white = text({ color: "#ffffff" });
    // white on the white page would fail, but it lies on a dark box
    expect(check(page([box("#1f2937"), white]))).toEqual([]);
    // a light box on top of the dark one: now it fails, against the light one
    const [issue] = check(page([box("#1f2937"), box("#f3f4f6"), white]));
    expect(issue.background).toBe("#f3f4f6");
    // a box painted after the text is not behind it
    expect(check(page([white, box("#1f2937")])).map((i) => i.background)).toEqual(["#ffffff"]);
    // a box somewhere else on the page is not behind it either
    expect(check(page([box("#1f2937", { x: 900, y: 600, width: 50, height: 50 }), white])).map((i) => i.background)).toEqual(["#ffffff"]);
  });

  it("knows where a turned shape lies", () => {
    const white = text({ color: "#ffffff", x: 380, y: 190, width: 40, autoWidth: false });
    // a tall dark bar turned a quarter covers the text; standing up it does not reach it
    const bar = (rotation: number) => box("#111111", { x: 190, y: 0, width: 20, height: 400, rotation });
    expect(check(page([bar(0), white]))).toHaveLength(1);
    expect(check(page([bar(90), white]))).toEqual([]);
  });

  it("is not judged over a picture, a gradient, a chart, a see-through or blended shape, or on a page that is not one colour", () => {
    const white = () => text({ color: "#ffffff" });
    expect(check(page([photo({ x: 50, y: 50, width: 400, height: 300, alt: "A hill" }), white()]))).toEqual([]);
    expect(check(page([createShape("rect", { x: 50, y: 50, width: 400, height: 300, fill: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] } }), white()]))).toEqual([]); // prettier-ignore
    expect(check(page([createChart({ x: 50, y: 50, width: 400, height: 300 }), white()]))).toEqual([]);
    expect(check(page([box("#ffffff", { opacity: 0.5 }), white()]))).toEqual([]);
    expect(check(page([box("#ffffff", { blend: "multiply" }), white()]))).toEqual([]);
    expect(check(page([box("#ffffff80"), white()]))).toEqual([]);
    expect(check(page([white()], { type: "linear", angle: 90, stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#eeeeee" }] }))).toEqual([]); // prettier-ignore
  });

  it("looks through a line and a shape without a fill to what is behind them", () => {
    const white = text({ color: "#ffffff" });
    const frame = createShape("rect", { x: 50, y: 50, width: 400, height: 300, fill: null as never });
    const line = createLine({ x: 50, y: 110, width: 400 });
    expect(check(page([box("#1f2937"), frame, line, white]))).toEqual([]);
  });

  it("takes the worst of the colours a text is written in, and only of runs that have words", () => {
    const mixed = text({
      paragraphs: [{ runs: [{ text: "Dark ", color: "#111111" }, { text: "pale", color: "#dddddd" }, { text: "  ", color: "#fefefe" }] }], // prettier-ignore
      color: "#000000",
    });
    const [issue] = check(page([mixed]));
    expect(issue.color).toBe("#dddddd");
    expect(issue.label).toBe("Dark pale");
    // the colour of the box itself counts only where a run takes it
    const own = text({ color: "#eeeeee", paragraphs: [{ runs: [{ text: "All dark", color: "#111111" }] }] });
    expect(check(page([own]))).toEqual([]);
  });

  it("counts a see-through text as the colour it mixes to", () => {
    // black at 30 % over white is a light grey
    const faint = text({ color: "#000000", opacity: 0.3 });
    const [issue] = check(page([faint]));
    expect(issue.color).toBe("#b3b3b3");
    expect(issue.ratio).toBeLessThan(4.5);
    expect(check(page([text({ color: "#000000", opacity: 0.9 })]))).toEqual([]);
  });

  it("is not judged for a gradient text, an empty text or a hidden one", () => {
    expect(check(page([text({ color: "#ffffff", gradient: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#fefefe" }] } })]))).toEqual([]); // prettier-ignore
    expect(check(page([text({ color: "#ffffff", text: "   " })]))).toEqual([]);
    expect(check(page([text({ color: "#ffffff", hidden: true })]))).toEqual([]);
    // a hidden box is not behind anything
    expect(check(page([box("#111111", { hidden: true }), text({ color: "#ffffff" })]))).toHaveLength(1);
  });

  it("finds a text inside a group, against the box of the group or of the page, and names the group to select", () => {
    const label = text({ color: "#ffffff", x: 20, y: 20, width: 100 });
    const badge = createGroup([createShape("rect", { x: 0, y: 0, width: 200, height: 80, fill: solid("#fde68a") }), label], { x: 300, y: 300 });
    const [issue] = check(page([badge]));
    expect(issue).toMatchObject({ elementId: label.id, topId: badge.id, background: "#fde68a" });
    // moved off its own box, the text of the group lies on what the page has there
    const loose = text({ color: "#ffffff", x: 400, y: 0, width: 100 });
    const group = createGroup([createShape("rect", { x: 0, y: 0, width: 200, height: 80, fill: solid("#fde68a") }), loose], { x: 300, y: 300 });
    expect(check(page([box("#111111", { x: 650, y: 250, width: 300, height: 200 }), group]))).toEqual([]);
    // the opacity of the group counts for the text in it
    const dim = createGroup([text({ color: "#000000", x: 0, y: 0 })], { x: 300, y: 300, opacity: 0.3 });
    expect(check(page([dim]))).toHaveLength(1);
  });

  it("cuts a long text short in its label", () => {
    const [issue] = check(page([text({ color: "#eeeeee", text: `${"word ".repeat(40)}` })]));
    expect(issue.label).toHaveLength(60);
    expect(issue.label.endsWith("…")).toBe(true);
  });
});

describe("pictures without alternative text", () => {
  it("are found, with the name of the picture, on every page", () => {
    const named = photo({ name: "Team photo" });
    const described = photo({ alt: "Five people at a table" });
    const blank = photo({ alt: "   " });
    const issues = check(page([named, described]), page([blank]));
    expect(issues).toEqual([
      { kind: "alt", pageId: expect.any(String), pageIndex: 0, elementId: named.id, topId: named.id, label: "Team photo" },
      { kind: "alt", pageId: expect.any(String), pageIndex: 1, elementId: blank.id, topId: blank.id, label: "" },
    ]);
  });

  it("are not asked of an empty frame, a hidden picture, or a shape", () => {
    expect(check(page([photo({ src: null }), photo({ hidden: true }), box("#ffffff")]))).toEqual([]);
  });

  it("are found inside a group, which is what can be selected", () => {
    const inner = photo({ x: 0, y: 0 });
    const group = createGroup([inner], { x: 100, y: 100 });
    expect(check(page([group]))).toMatchObject([{ kind: "alt", elementId: inner.id, topId: group.id }]);
  });
});
