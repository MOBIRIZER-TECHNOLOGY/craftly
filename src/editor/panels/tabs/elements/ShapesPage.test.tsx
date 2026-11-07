import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { ShapeElement, LineElement } from "@/core/types";
import { LINE_PRESETS, type LinePreset } from "@/data/shapes";
import { DRAG_MIME } from "@/editor/insert";
import { resetEditor } from "@/test/helpers";
import { fakeDataTransfer, lastElement, mountPanels, pageElements, resetElementsNav } from "@/test/tabsHarness";
import { LinePreview } from "./ShapesPage";
import { useEditor } from "@/core/store";

beforeEach(() => resetEditor());

async function openPage(page: "shapes" | "lines") {
  resetElementsNav(page);
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByRole("searchbox", { name: page === "shapes" ? "Search shapes" : "Search lines and arrows" });
  return user;
}

describe("Elements > Shapes", () => {
  it("groups the shapes under their headings, with the lines at the end", async () => {
    await openPage("shapes");
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Basic shapes", "Polygons", "Stars & badges", "Arrows", "Symbols", "Speech bubbles", "Blobs", "Lines"]);
    // the rounded square sits right after the plain one, and the ellipse right after the circle
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names.indexOf("Rounded square")).toBe(names.indexOf("Square") + 1);
    expect(names.indexOf("Ellipse")).toBe(names.indexOf("Circle") + 1);
    expect(screen.getByRole("heading", { name: "Shapes" })).toBeTruthy();
  });

  it("puts a shape in the middle of the page and selects it", async () => {
    const user = await openPage("shapes");
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: "Circle" }));
    const el = lastElement() as ShapeElement;
    expect(el.type).toBe("shape");
    expect(el.shape).toBe("ellipse");
    expect(pageElements()).toHaveLength(before + 1);
    expect(el.x + el.width / 2).toBeCloseTo(640, 0);
    expect(el.y + el.height / 2).toBeCloseTo(360, 0);
    // sized from the page: the shorter side is 720 high
    expect(el.width).toBe(Math.round(720 * 0.22));
    expect(useEditor.getState().selection).toEqual([el.id]);
  });

  it("puts an ellipse, wider than tall, in the middle of the page", async () => {
    const user = await openPage("shapes");
    await user.click(screen.getByRole("button", { name: "Ellipse" }));
    const el = lastElement() as ShapeElement;
    expect(el.shape).toBe("ellipse");
    expect(el.width / el.height).toBeCloseTo(1.5, 1);
    expect(el.x + el.width / 2).toBeCloseTo(640, 0);
    expect(el.y + el.height / 2).toBeCloseTo(360, 0);
    expect(useEditor.getState().selection).toEqual([el.id]);
  });

  it("draws the ellipse thumbnail wider than tall and the circle thumbnail round", async () => {
    await openPage("shapes");
    const radii = (name: string) => {
      const d = screen.getByRole("button", { name }).querySelector("path")!.getAttribute("d")!;
      const [, rx, ry] = d.match(/A([\d.]+) ([\d.]+)/)!;
      return [Number(rx), Number(ry)];
    };
    const [circleX, circleY] = radii("Circle");
    const [ellipseX, ellipseY] = radii("Ellipse");
    expect(circleX).toBe(circleY);
    expect(ellipseX / ellipseY).toBeCloseTo(1.5, 1);
  });

  it("makes the rounded square with rounded corners", async () => {
    const user = await openPage("shapes");
    await user.click(screen.getByRole("button", { name: "Rounded square" }));
    const el = lastElement() as ShapeElement;
    expect(el.shape).toBe("rect");
    expect(el.radius).toBeGreaterThan(0);
  });

  it("inserts from the keyboard", async () => {
    const user = await openPage("shapes");
    screen.getByRole("button", { name: "Heart" }).focus();
    await user.keyboard("{Enter}");
    expect((lastElement() as ShapeElement).shape).toBe("heart");
  });

  it("hands a new shape to the canvas when dragged", async () => {
    await openPage("shapes");
    const before = pageElements().length;
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Star" }), { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    expect(payload.type).toBe("elements");
    expect(payload.elements).toHaveLength(1);
    expect(payload.elements[0].shape).toBe("star");
    // dragging only builds the shape: nothing is on the page until it is dropped
    expect(pageElements()).toHaveLength(before);
  });

  it("narrows the list by name, group or id", async () => {
    const user = await openPage("shapes");
    await user.type(screen.getByRole("searchbox"), "heart");
    expect(screen.getByRole("button", { name: "Heart" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Circle" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Basic shapes" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Symbols" })).toBeTruthy();

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "blobs");
    expect(screen.getAllByRole("button").filter((b) => /^Blob \d$/.test(b.getAttribute("aria-label") ?? ""))).toHaveLength(6);
  });

  it("finds the ellipse by 'oval' and the square by 'rectangle', words their names do not contain", async () => {
    const user = await openPage("shapes");
    const box = screen.getByRole("searchbox");
    await user.type(box, "oval");
    expect(screen.getByRole("button", { name: "Ellipse" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Circle" })).toBeNull();
    await user.clear(box);
    await user.type(box, "rectangle");
    expect(screen.getByRole("button", { name: "Square" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rounded square" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Circle" })).toBeNull();
  });

  it("lists the circle and the ellipse for 'ellipse' (they are one drawing) and only the circle for 'round'", async () => {
    const user = await openPage("shapes");
    const box = screen.getByRole("searchbox");
    await user.type(box, "ellipse");
    expect(screen.getByRole("button", { name: "Circle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ellipse" })).toBeTruthy();
    await user.clear(box);
    await user.type(box, "round");
    expect(screen.getByRole("button", { name: "Circle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rounded square" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ellipse" })).toBeNull();
  });

  it("lists the lines too when the search is part of the words 'line arrow'", async () => {
    const user = await openPage("shapes");
    await user.type(screen.getByRole("searchbox"), "arrow");
    expect(screen.getByRole("button", { name: "Arrow left" })).toBeTruthy();
    const lines = screen.getByRole("heading", { name: "Lines" }).closest("section") as HTMLElement;
    expect(
      within(lines)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(LINE_PRESETS.map((l) => l.name));
  });

  it("leaves the lines out when the search is about something else", async () => {
    const user = await openPage("shapes");
    await user.type(screen.getByRole("searchbox"), "heart");
    expect(screen.queryByRole("heading", { name: "Lines" })).toBeNull();
  });

  it("says when nothing matches", async () => {
    const user = await openPage("shapes");
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("No shapes found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzz". Try "circle", "arrow" or "star".')).toBeTruthy();
  });

  it("goes back to all elements", async () => {
    const user = await openPage("shapes");
    await user.click(screen.getByRole("button", { name: "Back to all elements" }));
    expect(await screen.findByText("Browse categories")).toBeTruthy();
  });
});

describe("Elements > Lines", () => {
  it("lists every line and arrow style", async () => {
    await openPage("lines");
    expect(
      screen
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
        .filter((l) => LINE_PRESETS.some((p) => p.name === l)),
    ).toEqual(LINE_PRESETS.map((p) => p.name));
  });

  it("adds a plain line, sized from the page", async () => {
    const user = await openPage("lines");
    await user.click(screen.getByRole("button", { name: "Line" }));
    const el = lastElement() as LineElement;
    expect(el.type).toBe("line");
    expect(el.startArrow).toBe("none");
    expect(el.endArrow).toBe("none");
    expect(el.stroke.style).toBe("solid");
    expect(el.width).toBe(Math.round(720 * 0.3));
  });

  it("adds a dashed arrow with its head at the end", async () => {
    const user = await openPage("lines");
    await user.click(screen.getByRole("button", { name: "Dashed arrow" }));
    const el = lastElement() as LineElement;
    expect(el.stroke.style).toBe("dashed");
    expect(el.startArrow).toBe("none");
    expect(el.endArrow).toBe("arrow");
  });

  it("adds a line with a dot at both ends", async () => {
    const user = await openPage("lines");
    await user.click(screen.getByRole("button", { name: "Dot end" }));
    const el = lastElement() as LineElement;
    expect([el.startArrow, el.endArrow]).toEqual(["circle", "circle"]);
  });

  it("hands a new line to the canvas when dragged", async () => {
    await openPage("lines");
    const dt = fakeDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Double arrow" }), { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    expect(payload.elements[0].type).toBe("line");
    expect([payload.elements[0].startArrow, payload.elements[0].endArrow]).toEqual(["arrow", "arrow"]);
  });

  it("finds a line by a word of its name and says when there is none", async () => {
    const user = await openPage("lines");
    await user.type(screen.getByRole("searchbox"), "dotted");
    expect(
      screen
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
        .filter((l) => LINE_PRESETS.some((p) => p.name === l)),
    ).toEqual(["Dotted line"]);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("No lines found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzz". Try "arrow" or "dashed".')).toBeTruthy();
  });
});

describe("<LinePreview>", () => {
  const preset = (over: Partial<LinePreset>): LinePreset => ({ id: "x", name: "X", stroke: { style: "solid", cap: "round" }, start: "none", end: "none", ...over });
  const draw = (over: Partial<LinePreset>) => render(<LinePreview preset={preset(over)} />).container.querySelector("svg") as SVGElement;

  it("draws a plain line with no heads", () => {
    const svg = draw({});
    expect(svg.querySelectorAll("line")).toHaveLength(1);
    expect(svg.querySelector("path, circle, rect")).toBeNull();
    const line = svg.querySelector("line") as SVGLineElement;
    expect(line.getAttribute("x1")).toBe("12");
    expect(line.getAttribute("x2")).toBe("108");
    expect(line.getAttribute("stroke-dasharray")).toBeNull();
    expect(line.getAttribute("stroke-linecap")).toBe("round");
  });

  it("dashes and dots the stroke, and keeps butt caps", () => {
    expect(
      draw({ stroke: { style: "dashed", cap: "butt" } })
        .querySelector("line")
        ?.getAttribute("stroke-dasharray"),
    ).toBe("7 6");
    expect(
      draw({ stroke: { style: "dashed", cap: "butt" } })
        .querySelector("line")
        ?.getAttribute("stroke-linecap"),
    ).toBe("butt");
    expect(
      draw({ stroke: { style: "dotted", cap: "round" } })
        .querySelector("line")
        ?.getAttribute("stroke-dasharray"),
    ).toBe("0.1 6");
  });

  it("shortens the line so each kind of head sits at its end", () => {
    const inset = (end: LinePreset["end"]) => Number(draw({ end }).querySelector("line")?.getAttribute("x2"));
    expect(inset("none")).toBe(108);
    expect(inset("arrow")).toBe(99);
    expect(inset("open-arrow")).toBe(106);
    expect(inset("bar")).toBe(106);
    expect(inset("circle")).toBe(99);
  });

  it("draws filled arrow heads for arrow and triangle", () => {
    for (const kind of ["arrow", "triangle"] as const) {
      const head = draw({ end: kind }).querySelector("path") as SVGPathElement;
      expect(head.getAttribute("fill")).toBe("currentColor");
      expect(head.getAttribute("d")).toContain("l-10 -6");
    }
  });

  it("draws an open arrow as two strokes", () => {
    const head = draw({ end: "open-arrow" }).querySelector("path") as SVGPathElement;
    expect(head.getAttribute("fill")).toBe("none");
    expect(head.getAttribute("stroke")).toBe("currentColor");
  });

  it("draws a dot, a square, a diamond and a bar", () => {
    expect(draw({ end: "circle" }).querySelector("circle")).toBeTruthy();
    expect(draw({ end: "square" }).querySelector("rect")).toBeTruthy();
    expect(draw({ end: "diamond" }).querySelector("path")?.getAttribute("d")).toContain("l-6 -5");
    const bar = draw({ end: "bar" }).querySelectorAll("line");
    expect(bar).toHaveLength(2);
  });

  it("mirrors the head at the start of the line", () => {
    const svg = draw({ start: "arrow", end: "arrow" });
    const [first, second] = Array.from(svg.querySelectorAll("path")).map((p) => p.getAttribute("d"));
    expect(first).toBe("M12 12 l10 -6 l0 12 z");
    expect(second).toBe("M108 12 l-10 -6 l0 12 z");
  });
});
