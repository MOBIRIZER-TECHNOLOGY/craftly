import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createGraphic, createGroup, createImage, createLine, createShape, createText } from "@/core/factory";
import type { GroupElement, ImageElement, LineElement, TextElement } from "@/core/types";
import { live, openElements, paintOrder, selectElements, showPanel, store, typeNumber } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";

beforeEach(() => resetEditor());

const box = (x: number, y: number, width: number, height: number) => createShape("rect", { x, y, width, height });
const field = (name: string) => screen.getByRole("spinbutton", { name }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const openArrange = () => showPanel({ kind: "position", tab: "arrange" });

describe("Position panel: Arrange", () => {
  it("asks for a selection when nothing is selected", () => {
    openElements([box(0, 0, 50, 50)]);
    openArrange();
    expect(screen.getByRole("region", { name: "Position" })).toBeTruthy();
    expect(screen.getByText("Nothing selected")).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: "Width" })).toBeNull();
  });

  it("moves the selected element through the stacking order and disables moves that change nothing", async () => {
    const user = userEvent.setup();
    const [a, b, c] = [box(0, 0, 50, 50), box(100, 0, 50, 50), box(200, 0, 50, 50)];
    openElements([a, b, c], { selected: [b] });
    openArrange();

    await user.click(button("To front"));
    expect(paintOrder()).toEqual([a.id, c.id, b.id]);
    // now on top: nothing further forward
    expect(button("To front").disabled).toBe(true);
    expect(button("Forward").disabled).toBe(true);
    expect(button("Backward").disabled).toBe(false);

    await user.click(button("Backward"));
    expect(paintOrder()).toEqual([a.id, b.id, c.id]);
    await user.click(button("To back"));
    expect(paintOrder()).toEqual([b.id, a.id, c.id]);
    expect(button("To back").disabled).toBe(true);
    expect(button("Backward").disabled).toBe(true);
    await user.click(button("Forward"));
    expect(paintOrder()).toEqual([a.id, b.id, c.id]);
  });

  it("aligns the selection to the page on every side", async () => {
    const user = userEvent.setup();
    const el = box(100, 100, 200, 100);
    openElements([el], { selected: [el], width: 1000, height: 600 });
    openArrange();
    const at = () => ({ x: live(el).x, y: live(el).y });

    await user.click(button("Left"));
    expect(at().x).toBe(0);
    await user.click(button("Center"));
    expect(at().x).toBe(400);
    await user.click(button("Right"));
    expect(at().x).toBe(800);
    await user.click(button("Top"));
    expect(at().y).toBe(0);
    await user.click(button("Middle"));
    expect(at().y).toBe(250);
    await user.click(button("Bottom"));
    expect(at().y).toBe(500);
  });

  it("aligns several elements to each other, and distributes three or more", async () => {
    const user = userEvent.setup();
    const [a, b] = [box(100, 100, 200, 100), box(400, 300, 100, 100)];
    openElements([a, b], { selected: [a, b] });
    openArrange();
    // two elements: align among themselves, but there is nothing to distribute
    expect(screen.queryByRole("button", { name: "Horizontally" })).toBeNull();
    await user.click(button("Align left edges"));
    expect(live(b).x).toBe(100);
    await user.click(button("Align bottom edges"));
    expect(live(a).y + live(a).height).toBe(live(b).y + live(b).height);
  });

  it("spreads three elements evenly", async () => {
    const user = userEvent.setup();
    const [a, b, c] = [box(100, 0, 200, 50), box(350, 0, 100, 50), box(800, 0, 50, 50)];
    openElements([a, b, c], { selected: [a, b, c] });
    openArrange();
    await user.click(button("Horizontally"));
    // 750px between the outer edges, 350px of elements: 200px gaps
    expect(live(b).x).toBeCloseTo(500);
  });

  it("spreads three elements evenly from top to bottom", async () => {
    const user = userEvent.setup();
    const [d, e, f] = [box(0, 100, 50, 100), box(0, 150, 50, 100), box(0, 500, 50, 100)];
    openElements([d, e, f], { selected: [d, e, f] });
    openArrange();
    await user.click(button("Vertically"));
    // 500px between the outer edges, 300px of elements: 100px gaps
    expect(live(e).y).toBeCloseTo(300);
  });

  it("switches between Arrange and Layers and closes with the panel's X", async () => {
    const user = userEvent.setup();
    openElements([box(0, 0, 50, 50)]);
    openArrange();
    expect(screen.getByRole("tab", { name: "Arrange" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Layers" }));
    expect(store().context).toEqual({ kind: "position", tab: "layers" });
    expect(screen.getByRole("list", { name: "Layers, top-most first" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Arrange" }));
    expect(store().context).toEqual({ kind: "position", tab: "arrange" });
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(store().context).toBeNull();
    expect(screen.queryByRole("region", { name: "Position" })).toBeNull();
  });
});

describe("Position panel: Advanced fields", () => {
  it("shows the box of the selected element", () => {
    const el = box(120, 80, 200, 100);
    el.rotation = 30;
    openElements([el], { selected: [el] });
    openArrange();
    expect(field("Width").value).toBe("200");
    expect(field("Height").value).toBe("100");
    expect(field("Rotation").value).toBe("30");
    // a rotated box reports the corner of its bounds
    expect(Number(field("X position").value)).toBeLessThan(120);
  });

  it("resizes a shape freely and keeps the ratio once the lock is on", async () => {
    const user = userEvent.setup();
    const el = box(100, 100, 200, 100);
    openElements([el], { selected: [el] });
    openArrange();
    await typeNumber(user, field("Width"), "300");
    expect(live(el)).toMatchObject({ width: 300, height: 100 });
    await typeNumber(user, field("Height"), "150");
    expect(live(el)).toMatchObject({ width: 300, height: 150 });
    await typeNumber(user, field("Height"), "100");

    await user.click(button("Lock aspect ratio"));
    expect(button("Unlock aspect ratio")).toBeTruthy();
    await typeNumber(user, field("Height"), "200");
    expect(live(el)).toMatchObject({ width: 600, height: 200 });
    await typeNumber(user, field("Width"), "300");
    expect(live(el)).toMatchObject({ width: 300, height: 100 });
    await user.click(button("Unlock aspect ratio"));
    expect(button("Lock aspect ratio")).toBeTruthy();
  });

  it("remembers the lock for a selection when the panel is closed and opened again", async () => {
    const user = userEvent.setup();
    const el = box(0, 0, 100, 100);
    openElements([el], { selected: [el] });
    const view = openArrange();
    await user.click(button("Lock aspect ratio"));
    view.unmount();
    openArrange();
    expect(button("Unlock aspect ratio")).toBeTruthy();
  });

  it("moves the element with X and Y", async () => {
    const user = userEvent.setup();
    const el = box(100, 100, 200, 100);
    openElements([el], { selected: [el] });
    openArrange();
    await typeNumber(user, field("X position"), "250");
    expect(live(el)).toMatchObject({ x: 250, y: 100 });
    await typeNumber(user, field("Y position"), "40");
    expect(live(el)).toMatchObject({ x: 250, y: 40 });
  });

  it("rotates a single element and wraps the angle into 0 to 360", async () => {
    const user = userEvent.setup();
    const el = box(100, 100, 200, 100);
    openElements([el], { selected: [el] });
    openArrange();
    await typeNumber(user, field("Rotation"), "45");
    expect(live(el).rotation).toBe(45);
    await typeNumber(user, field("Rotation"), "-90");
    expect(live(el).rotation).toBe(270);
    // 360 is the largest value the field takes and means no rotation
    await typeNumber(user, field("Rotation"), "999");
    expect(live(el).rotation).toBe(0);
  });

  it("changes the width of text but never its height, which follows the text", async () => {
    const user = userEvent.setup();
    const text = createText({ text: "A fairly long line of text", fontSize: 40, x: 50, y: 50 });
    openElements([text], { selected: [text] });
    openArrange();
    expect(field("Height").disabled).toBe(true);
    expect(field("Height").closest("[title]")?.getAttribute("title")).toBe("Text height follows the text");
    await typeNumber(user, field("Width"), "300");
    expect(live<TextElement>(text)).toMatchObject({ width: 300, autoWidth: false });
  });

  it("gives a line a length but no height", async () => {
    const user = userEvent.setup();
    const line = createLine({ x: 10, y: 10, width: 300 });
    openElements([line], { selected: [line] });
    openArrange();
    expect(field("Height").disabled).toBe(true);
    expect(field("Height").closest("[title]")?.getAttribute("title")).toBe("Lines have no height");
    await typeNumber(user, field("Width"), "150");
    expect(live<LineElement>(line)).toMatchObject({ width: 150, height: 0 });
  });

  it("keeps a photo's proportions by default", async () => {
    const user = userEvent.setup();
    const photo = createImage({ src: "https://example.test/p.jpg", x: 0, y: 0, width: 400, height: 200, naturalWidth: 800, naturalHeight: 400 });
    openElements([photo], { selected: [photo] });
    openArrange();
    expect(button("Unlock aspect ratio")).toBeTruthy();
    await typeNumber(user, field("Width"), "200");
    expect(live<ImageElement>(photo)).toMatchObject({ width: 200, height: 100 });
    await typeNumber(user, field("Height"), "50");
    expect(live<ImageElement>(photo)).toMatchObject({ width: 100, height: 50 });
  });

  it("scales a group together with the elements inside it", async () => {
    const user = userEvent.setup();
    const inner = box(10, 10, 40, 40);
    const group = createGroup([inner], { x: 0, y: 0, width: 100, height: 100 });
    openElements([group], { selected: [group] });
    openArrange();
    await typeNumber(user, field("Width"), "200");
    expect(live<GroupElement>(group)).toMatchObject({ width: 200, height: 200 });
    expect(live(inner)).toMatchObject({ x: 20, y: 20, width: 80, height: 80 });
  });

  it("treats several elements as one box: moves, scales and rotates them together", async () => {
    const user = userEvent.setup();
    const [a, b] = [box(100, 100, 100, 100), box(300, 100, 100, 100)];
    openElements([a, b], { selected: [a, b] });
    openArrange();
    // the union is 300 x 100 at (100, 100)
    expect(field("Width").value).toBe("300");
    expect(field("Height").value).toBe("100");
    expect(field("Rotate selection by").value).toBe("0");

    await typeNumber(user, field("X position"), "200");
    expect(live(a).x).toBe(200);
    expect(live(b).x).toBe(400);
    await typeNumber(user, field("Y position"), "50");
    expect(live(a).y).toBe(50);

    // ratio lock is on for several elements: scaling the width scales the height too
    await typeNumber(user, field("Width"), "150");
    expect(live(a)).toMatchObject({ width: 50, height: 50 });
    expect(live(b).x).toBeCloseTo(300);
    await typeNumber(user, field("Height"), "100");
    expect(live(a).height).toBeCloseTo(100);

    // a turn is relative to the pose before it; two turns of 90 degrees make a half turn
    await typeNumber(user, field("Rotate selection by"), "90");
    expect(live(a).rotation).toBe(90);
    await typeNumber(user, field("Rotate selection by"), "90");
    expect(live(a).rotation).toBe(180);
    expect(live(b).rotation).toBe(180);
  });

  it("scales several elements one axis at a time when the ratio is unlocked", async () => {
    const user = userEvent.setup();
    const [a, b] = [box(100, 100, 100, 100), box(300, 100, 100, 100)];
    openElements([a, b], { selected: [a, b] });
    openArrange();
    await user.click(button("Unlock aspect ratio"));
    await typeNumber(user, field("Width"), "600");
    expect(live(a)).toMatchObject({ width: 200, height: 100 });
    await typeNumber(user, field("Height"), "300");
    expect(live(a).height).toBe(300);
    expect(live(a).width).toBe(200);
  });

  it("locks the fields of a locked element and explains why", () => {
    const el = box(10, 10, 100, 100);
    el.locked = true;
    openElements([el], { selected: [el] });
    openArrange();
    for (const name of ["Width", "Height", "X position", "Y position", "Rotation"]) expect(field(name).disabled).toBe(true);
    expect(button("Lock aspect ratio").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/This element is locked/)).toBeTruthy();
  });

  it("only changes the unlocked elements of a mixed selection", async () => {
    const user = userEvent.setup();
    const [free, fixed] = [box(100, 100, 100, 100), box(300, 100, 100, 100)];
    fixed.locked = true;
    openElements([free, fixed], { selected: [free, fixed] });
    openArrange();
    // X is the left edge of the whole selection (100): moving it to 150 shifts the free element only
    await typeNumber(user, field("X position"), "150");
    expect(live(free).x).toBe(150);
    expect(live(fixed).x).toBe(300);
  });

  it("keeps a graphic in proportion, and shows the empty state when the selection is cleared", async () => {
    const user = userEvent.setup();
    const icon = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>', x: 10, y: 10, width: 100, height: 100 });
    openElements([icon], { selected: [icon] });
    openArrange();
    expect(button("Unlock aspect ratio")).toBeTruthy();
    await typeNumber(user, field("Width"), "50");
    expect(live(icon)).toMatchObject({ width: 50, height: 50 });
    // selecting something that is no longer there shows the empty state again
    selectElements();
    expect(screen.getByText("Nothing selected")).toBeTruthy();
  });
});

describe("Position panel: values that arrive late", () => {
  /** types a value into a field, then lets something happen to the document in the same moment the field commits */
  function commitDuring(name: string, value: string, change: () => void) {
    const input = field(name);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    act(() => {
      change();
      fireEvent.blur(input);
    });
  }

  it.each([
    ["Width", "300"],
    ["Height", "300"],
    ["X position", "300"],
    ["Y position", "300"],
    ["Rotation", "45"],
  ])("ignores a new %s when the selection went away in the meantime", (name, value) => {
    const el = box(100, 100, 200, 100);
    openElements([el], { selected: [el] });
    openArrange();
    commitDuring(name, value, () => store().actions.select([]));
    expect(live(el)).toMatchObject({ x: 100, y: 100, width: 200, height: 100, rotation: 0 });
  });

  it("ignores a new value when the design was closed in the meantime", () => {
    const el = box(100, 100, 200, 100);
    openElements([el], { selected: [el] });
    openArrange();
    const snapshot = store().design;
    commitDuring("Width", "300", () => store().actions.closeDesign());
    expect(snapshot!.pages[0].elements[0]).toMatchObject({ width: 200 });
    expect(store().design).toBeNull();
  });

  it.each(["Width", "Height"])("does not resize an element that was locked in the meantime (%s)", (name) => {
    const el = box(100, 100, 200, 100);
    openElements([el], { selected: [el] });
    openArrange();
    commitDuring(name, "300", () => store().actions.setLocked([el.id], true));
    expect(live(el)).toMatchObject({ width: 200, height: 100 });
  });

  it("forgets old lock choices after very many selections, and starts again from the default", () => {
    const shapes = Array.from({ length: 205 }, () => box(0, 0, 10, 10));
    openElements(shapes, { selected: [shapes[0]] });
    openArrange();
    fireEvent.click(button("Lock aspect ratio"));
    expect(button("Unlock aspect ratio")).toBeTruthy();
    for (let i = 1; i < shapes.length; i++) {
      selectElements(shapes[i]);
      fireEvent.click(screen.getByRole("button", { name: /aspect ratio$/ }));
    }
    selectElements(shapes[0]);
    expect(button("Lock aspect ratio")).toBeTruthy();
    // 205 selections, each drawing the panel again: over the usual 30 s on a CI machine that also measures coverage
  }, 120_000);
});
