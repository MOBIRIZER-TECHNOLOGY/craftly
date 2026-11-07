import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import { useGesture } from "@/editor/canvas/gestureStore";
import { initialMetrics, useView } from "@/editor/canvas/viewStore";
import { live, openElements, paintOrder, store } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";
import { MiniToolbar } from "./MiniToolbar";

beforeEach(() => {
  resetEditor();
  useView.setState({ ...initialMetrics });
  useGesture.setState({ active: false });
  // the pill is 150 x 40 px
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(150);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
});
afterEach(() => {
  useView.setState({ ...initialMetrics });
  useGesture.setState({ active: false });
});

const at = (x: number, y: number, w = 200, h = 100) => createShape("rect", { x, y, width: w, height: h });
const pill = () => screen.getByRole("toolbar", { name: "Selected element quick actions" });
const position = () => ({ left: Number.parseInt(pill().style.left, 10), top: Number.parseInt(pill().style.top, 10), side: pill().getAttribute("data-cf-minitoolbar") });
const show = (elements = [at(400, 400)], selected = elements) => {
  openElements(elements, { selected });
  return render(<MiniToolbar />);
};

describe("<MiniToolbar> placement", () => {
  it("sits centred above the selection", () => {
    // the view shows the design at half size: the box is at 200,200 and 100 x 50 on screen
    show();
    expect(position()).toEqual({ left: 250 - 75, top: 200 - 18 - 40, side: "above" });
  });

  it("flips below the selection when there is no room above it", () => {
    show([at(400, 20)]);
    // box bottom on screen: 10 + 50
    expect(position()).toEqual({ left: 250 - 75, top: 60 + 60, side: "below" });
  });

  it("stays inside the workspace on the right", () => {
    show([at(1900, 400, 100, 100)]);
    // would be centred on x = 975, so 75px of it would stick out: held 8px inside
    expect(position().left).toBe(1000 - 150 - 8);
  });

  it("stays inside the workspace on the left", () => {
    show([at(-80, 400, 100, 100)]);
    expect(position().left).toBe(8);
  });

  it("keeps the pill inside at the bottom of the view", () => {
    openElements([at(400, 1500, 200, 100)], { selected: [] });
    useView.setState({ scrollTop: 600 });
    act(() => store().actions.select([store().design!.pages[0].elements[0].id]));
    render(<MiniToolbar />);
    expect(position().top).toBeLessThanOrEqual(700 - 40 - 8);
  });

  it("follows zoom and scrolling", () => {
    show();
    const before = position();
    act(() => useView.setState({ zoom: 1 }));
    expect(position().top).toBe(400 - 18 - 40);
    expect(position().left).not.toBe(before.left);
    act(() => useView.setState({ scrollTop: 100 }));
    expect(position().top).toBe(300 - 18 - 40);
  });

  it("is hidden when the selection is scrolled out of view", () => {
    show();
    act(() => useView.setState({ scrollLeft: 5000 }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => useView.setState({ scrollLeft: 0, scrollTop: 5000 }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => useView.setState({ scrollTop: -5000 }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => useView.setState({ scrollLeft: -5000, scrollTop: 0 }));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("anchors to an element inside a group by its place on the page", () => {
    const inner = at(10, 10, 100, 100);
    const g = createGroup([inner], { x: 500, y: 300, width: 120, height: 120 });
    openElements([g], { selected: [inner] });
    render(<MiniToolbar />);
    // inner is at 510,310 on the page: 255,155 on screen
    expect(position().top).toBe(155 - 18 - 40);
  });
});

describe("<MiniToolbar> visibility", () => {
  it("shows nothing without a selection", () => {
    show([at(400, 400)], []);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("shows nothing before a design is open", () => {
    render(<MiniToolbar />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("hides while a text is edited, an image cropped, an element dragged, in view mode and while presenting", () => {
    show();
    expect(pill()).toBeTruthy();
    act(() => useGesture.setState({ active: true }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => useGesture.setState({ active: false }));
    act(() => useEditor.setState({ croppingId: "crop" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => useEditor.setState({ croppingId: null, editingTextId: "text" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => useEditor.setState({ editingTextId: null }));
    const selected = [...store().selection];
    act(() => store().actions.setPresenting(true));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => store().actions.setPresenting(false));
    // presenting clears the selection
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => store().actions.select(selected));
    expect(pill()).toBeTruthy();
    act(() => store().actions.setMode("view"));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("<MiniToolbar> actions", () => {
  it("offers lock, duplicate, delete and more", () => {
    show();
    expect(
      within(pill())
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Lock", "Duplicate", "Delete", "More actions"]);
  });

  it("locks the selection, and offers only unlocking while it is locked", async () => {
    const user = userEvent.setup();
    const el = at(400, 400);
    show([el]);
    await user.click(within(pill()).getByRole("button", { name: "Lock" }));
    expect(live(el).locked).toBe(true);
    expect(
      within(pill())
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Unlock", "More actions"]);
    await user.click(within(pill()).getByRole("button", { name: "Unlock" }));
    expect(live(el).locked).toBe(false);
  });

  it("treats a selection as locked only when every element is", () => {
    const [a, b] = [at(400, 400), at(100, 400)];
    b.locked = true;
    show([a, b]);
    expect(within(pill()).getByRole("button", { name: "Lock" })).toBeTruthy();
  });

  it("duplicates and deletes the selection", async () => {
    const user = userEvent.setup();
    const el = at(400, 400);
    show([el]);
    await user.click(within(pill()).getByRole("button", { name: "Duplicate" }));
    expect(paintOrder()).toHaveLength(2);
    expect(store().selection).toHaveLength(1);
    await user.click(within(pill()).getByRole("button", { name: "Delete" }));
    expect(paintOrder()).toEqual([el.id]);
  });

  it("opens the same menu as a right click behind '...'", async () => {
    const user = userEvent.setup();
    show();
    await user.click(within(pill()).getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(within(menu).getByRole("menuitem", { name: /^Copy$|^Copy\b/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /^Alternative text/ })).toBeTruthy();
  });
});
