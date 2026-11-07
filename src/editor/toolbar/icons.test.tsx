import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ArrowKind } from "@/core/types";
import { ArrowheadPreview, IconAccessibility, IconBorderBox, IconChecker, IconStrokeStyle, IconStrokeWeight } from "./icons";

const svg = (ui: React.ReactElement) => render(ui).container.querySelector("svg") as SVGSVGElement;

describe("toolbar icons", () => {
  it("are decorative 24px glyphs that follow the text colour", () => {
    for (const icon of [<IconChecker />, <IconBorderBox />, <IconStrokeWeight />, <IconStrokeStyle kind="solid" />, <IconAccessibility />, <ArrowheadPreview kind="arrow" />]) {
      const el = svg(icon);
      expect(el.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("draws the transparency checkerboard with eight squares inside the frame", () => {
    const el = svg(<IconChecker />);
    expect(el.querySelectorAll("g rect")).toHaveLength(8);
    expect(el.querySelectorAll(":scope > rect")).toHaveLength(1);
  });

  it("draws a different glyph for each border style", () => {
    const glyph = (kind: "none" | "solid" | "dashed" | "dotted") => svg(<IconStrokeStyle kind={kind} />);
    expect(glyph("none").querySelector("circle")).toBeTruthy();
    expect(glyph("dashed").querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(3);
    expect(glyph("dotted").querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(4);
    expect(glyph("solid").querySelector("path")?.getAttribute("d")).toBe("M2.5 12h19");
    expect(glyph("solid").querySelector("circle")).toBeNull();
  });

  it("passes extra props such as a size on to the svg", () => {
    expect(svg(<IconStrokeStyle kind="solid" width={30} className="big" />).getAttribute("width")).toBe("30");
    expect(svg(<IconBorderBox className="big" />).classList.contains("big")).toBe(true);
  });

  const kinds: ArrowKind[] = ["none", "arrow", "triangle", "open-arrow", "circle", "square", "diamond", "bar"];

  it("previews every arrowhead with a shaft and, except for 'none', a head", () => {
    for (const kind of kinds) {
      const el = svg(<ArrowheadPreview kind={kind} />);
      const shapes = el.querySelectorAll("g > *").length;
      expect(shapes, kind).toBe(kind === "none" ? 1 : 2);
    }
  });

  it("shortens the shaft where the head covers it", () => {
    const shaft = (kind: ArrowKind) =>
      svg(<ArrowheadPreview kind={kind} />)
        .querySelector("path")
        ?.getAttribute("d");
    expect(shaft("none")).toBe("M2.5 12H21.5");
    expect(shaft("arrow")).toBe("M2.5 12H15.5");
    expect(shaft("circle")).toBe("M2.5 12H16");
    expect(shaft("square")).toBe("M2.5 12H15.4");
    expect(shaft("diamond")).toBe("M2.5 12H15.3");
    expect(shaft("open-arrow")).toBe("M2.5 12H21");
    expect(shaft("bar")).toBe("M2.5 12H21");
  });

  it("mirrors the preview for the start of a line", () => {
    expect(
      svg(<ArrowheadPreview kind="arrow" end="end" />)
        .querySelector("g")
        ?.getAttribute("transform"),
    ).toBeNull();
    expect(
      svg(<ArrowheadPreview kind="arrow" end="start" />)
        .querySelector("g")
        ?.getAttribute("transform"),
    ).toBe("translate(24 0) scale(-1 1)");
  });
});
