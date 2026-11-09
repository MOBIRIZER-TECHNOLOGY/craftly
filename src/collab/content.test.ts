/**
 * The check of what arrives must let through everything the editor can make, or live editing would refuse people's work: every
 * template page and every graphic that ships with the app, sent as the operations that add them.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createGraphic, createPage } from "@/core/factory";
import { extractSvgColors } from "@/core/svg";
import { GRAPHICS } from "@/data/graphics";
import { TEMPLATES } from "@/data/templates";
import { qrSvg } from "@/editor/panels/tabs/apps/qrSvg";
import { diffDesign } from "./ops";
import { checkDesign, checkOps } from "./protocol";

const empty = () => createDesign({ width: 1000, height: 600, pages: [createPage({ id: "start" })] });
const overTheWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("what the editor ships", () => {
  it("passes the check of the server: every page of every template", () => {
    expect(TEMPLATES.length).toBeGreaterThan(50);
    for (const template of TEMPLATES) {
      const design = createDesign({ width: template.width, height: template.height, pages: template.pages });
      const result = checkOps(overTheWire(diffDesign(empty(), design)));
      if (typeof result === "string") expect.fail(`template ${template.id}: ${result}`);
    }
  });

  it("passes the check of the server: every graphic of the Elements panel, as it is added to a page", () => {
    expect(GRAPHICS.length).toBeGreaterThan(100);
    const base = empty();
    for (const graphic of GRAPHICS) {
      const el = createGraphic({ svg: graphic.svg });
      const ops = diffDesign(base, { ...base, pages: [{ ...base.pages[0], elements: [el] }] });
      const result = checkOps(overTheWire(ops));
      if (typeof result === "string") expect.fail(`graphic ${graphic.id}: ${result}`);
    }
  });

  it("passes the check of the server: every graphic recoloured the way the editor does it, and a QR code", () => {
    const base = empty();
    const drawings = [...GRAPHICS.map((g) => ({ id: g.id, svg: g.svg })), { id: "qr", svg: qrSvg("https://example.test/a?b=c", "H", "#112233", "#ffffff") }];
    for (const { id, svg } of drawings) {
      const colors = Object.fromEntries(extractSvgColors(svg).map((key, i) => [key, i % 2 ? "rgba(17, 34, 51, 0.5)" : "#123456"]));
      const el = createGraphic({ svg, colors });
      const ops = diffDesign(base, { ...base, pages: [{ ...base.pages[0], elements: [el] }] });
      const result = checkOps(overTheWire(ops));
      if (typeof result === "string") expect.fail(`graphic ${id}: ${result}`);
    }
  });

  it("passes the check of a browser that joins: every template, as one design that arrives whole", () => {
    for (const template of TEMPLATES) {
      const design = createDesign({ width: template.width, height: template.height, pages: template.pages });
      const result = checkDesign(overTheWire(design));
      if (result !== null) expect.fail(`template ${template.id}: ${result}`);
    }
  });
});
