import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShape } from "@/core/factory";
import { nodeKindOf } from "@/core/pen";
import { elementPath } from "@/core/penShape";
import type { ShapeElement } from "@/core/types";
import { selectNodes } from "@/editor/canvas/pathEditActions";
import { startPathEdit, stopPathEdit, usePathEdit } from "@/editor/canvas/pathEditStore";
import { live, openElements } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";
import { FloatingToolbar } from "../FloatingToolbar";
import { PathBar } from "./PathBar";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
});
afterEach(() => {
  act(() => stopPathEdit());
  restoreLayout();
});

const path = (extra: Partial<ShapeElement> = {}) => createShape("path", { id: "p", x: 100, y: 100, width: 200, height: 100, fill: null, path: "M0 0 L100 0 L100 100", ...extra });
const mount = (el: ShapeElement = path()) => {
  openElements([el], { selected: [el] });
  return render(<FloatingToolbar />);
};
const shapeBar = () => screen.getByRole("toolbar", { name: "Selected element common controls" });
const pointBar = () => screen.getByRole("toolbar", { name: "Point editing controls" });
const inBar = (bar: HTMLElement, name: string | RegExp) => within(bar).getByRole("button", { name }) as HTMLButtonElement;
const maybe = (bar: HTMLElement, name: string | RegExp) => within(bar).queryByRole("button", { name });

describe("the shape toolbar", () => {
  it("offers Edit points for a path", () => {
    mount();
    expect(maybe(shapeBar(), "Edit points")).toBeTruthy();
  });

  it("does not offer it for another shape, or for a path that cannot be edited point by point", () => {
    mount(createShape("rect", { id: "p", x: 0, y: 0, width: 100, height: 100 }));
    expect(maybe(shapeBar(), "Edit points")).toBeNull();
  });

  it("does not offer it for a path that cannot be read into points", () => {
    mount(path({ path: "M0 0 A50 50 0 0 1 100 100" }));
    expect(maybe(shapeBar(), "Edit points")).toBeNull();
  });

  it("opens the points of the path, and the toolbar for them takes its place", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(inBar(shapeBar(), "Edit points"));
    expect(usePathEdit.getState().id).toBe("p");
    expect(pointBar()).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Selected element common controls" })).toBeNull();
  });
});

describe("the toolbar for editing points", () => {
  const open = async (el?: ShapeElement) => {
    mount(el);
    act(() => startPathEdit("p"));
    await waitFor(() => expect(pointBar()).toBeTruthy());
  };

  it("says what is selected", async () => {
    await open();
    expect(within(pointBar()).getByText("Select a point to edit it")).toBeTruthy();
    // a screen reader hears the caption change as the keys walk through the points
    expect(within(pointBar()).getByText("Select a point to edit it").getAttribute("aria-live")).toBe("polite");
    act(() => selectNodes([1]));
    expect(within(pointBar()).getByText("Point 2 of 3, corner")).toBeTruthy();
    act(() => selectNodes([0, 2]));
    expect(within(pointBar()).getByText("2 points selected")).toBeTruthy();
  });

  it("can do nothing to points until some are selected", async () => {
    await open();
    for (const name of ["Corner", "Smooth", "Delete point"]) expect(inBar(pointBar(), name).disabled).toBe(true);
    act(() => selectNodes([1]));
    for (const name of ["Corner", "Smooth", "Delete point"]) expect(inBar(pointBar(), name).disabled).toBe(false);
  });

  it("makes the selected points smooth, or corners again", async () => {
    const user = userEvent.setup();
    await open();
    act(() => selectNodes([1]));
    await user.click(inBar(pointBar(), "Smooth"));
    expect(nodeKindOf(elementPath(live<ShapeElement>("p"))!, 1)).toBe("smooth");
    expect(within(pointBar()).getByText("Point 2 of 3, smooth")).toBeTruthy();
    await user.click(inBar(pointBar(), "Corner"));
    expect(nodeKindOf(elementPath(live<ShapeElement>("p"))!, 1)).toBe("corner");
  });

  it("deletes the selected points", async () => {
    const user = userEvent.setup();
    await open();
    act(() => selectNodes([1]));
    await user.click(inBar(pointBar(), "Delete point"));
    expect(elementPath(live<ShapeElement>("p"))!.nodes).toHaveLength(2);
  });

  it("closes an open path of three points or more, and only then offers it", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(inBar(pointBar(), "Close path"));
    expect(elementPath(live<ShapeElement>("p"))!.closed).toBe(true);
    await waitFor(() => expect(maybe(pointBar(), "Close path")).toBeNull());
  });

  it("does not offer to close a path of two points", async () => {
    await open(path({ path: "M0 0 L100 100" }));
    expect(maybe(pointBar(), "Close path")).toBeNull();
  });

  it("shows nothing for a shape that cannot be read into points", () => {
    const { container } = render(<PathBar el={path({ path: "M0 0 A50 50 0 0 1 100 100" })} />);
    expect(container.textContent).toBe("");
  });

  it("is left with Done, and the shape toolbar comes back", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(inBar(pointBar(), "Done"));
    expect(usePathEdit.getState().id).toBeNull();
    expect(shapeBar()).toBeTruthy();
  });
});
