import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsDialog } from "./ShortcutsDialog";

const mount = (onClose = vi.fn()) => render(<ShortcutsDialog open onClose={onClose} />);
const groupNames = () => Array.from(document.querySelectorAll(".cf-shortcuts__group")).map((g) => g.getAttribute("aria-label"));
const rowOf = (label: string) => screen.getByText(label).closest("li")!;

describe("<ShortcutsDialog>", () => {
  it("lists the shortcuts in groups, with the search box ready", () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search shortcuts" })).toBeTruthy();
    const region = screen.getByRole("region", { name: "Shortcuts" });
    // the list scrolls inside the dialog: the keyboard has to be able to focus it, or nobody without a mouse can scroll it
    expect(region.tabIndex).toBe(0);
    const groups = ["Add to the page", "Arrange", "Edit and select", "General", "Mouse and canvas gestures", "Pages", "Pen and path points", "Presenting", "View"];
    expect(groupNames().sort()).toEqual(groups);
    expect(
      within(region)
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-label"))
        .sort(),
    ).toEqual(groups);
  });

  it("lists the text formatting shortcuts, each on its own row", () => {
    mount();
    const keys = (label: string) => Array.from(rowOf(label).querySelectorAll("kbd")).map((k) => k.textContent);
    expect(keys("Bold the selected text")).toEqual(["Ctrl", "B"]);
    expect(keys("Italic the selected text")).toEqual(["Ctrl", "I"]);
    expect(keys("Underline the selected text")).toEqual(["Ctrl", "U"]);
  });

  it("lists the Pen, with its key, and the keys of point editing", () => {
    mount();
    const keys = (label: string) => Array.from(rowOf(label).querySelectorAll("kbd")).map((k) => k.textContent);
    expect(keys("Path with the Pen (points and curves)")).toEqual(["P"]);
    // while a path is being placed, undo takes its last point back
    expect(keys("Take the last point back")).toEqual(["Backspace", "Ctrl", "Z"]);
  });

  it("lists the keys that draw a path without a pointer", () => {
    mount();
    const keys = (label: string) => Array.from(rowOf(label).querySelectorAll("kbd")).map((k) => k.textContent);
    expect(keys("Move the Pen's keyboard point by 1 px or 10 px")).toEqual(["Arrow Keys", "Shift", "Arrow Keys"]);
    expect(keys("Place a corner point at the keyboard point (on the first point: close the path, on the last: end it)")).toEqual(["Enter"]);
    expect(keys("Place a smooth point at the keyboard point")).toEqual(["Shift", "Enter"]);
    expect(keys("Pull the curve of the last point by 1 px or 10 px")).toEqual(["Alt", "Arrow Keys", "Alt", "Shift", "Arrow Keys"]);
    expect(keys("Go to the first point, where Enter closes the path")).toEqual(["Home"]);
  });

  it("shows each key as a key cap and alternatives with 'or'", () => {
    mount();
    const undo = rowOf("Undo");
    expect(Array.from(undo.querySelectorAll("kbd")).map((k) => k.textContent)).toEqual(["Ctrl", "Z"]);
    const redo = rowOf("Redo");
    expect(Array.from(redo.querySelectorAll("kbd")).map((k) => k.textContent)).toEqual(["Ctrl", "Shift", "Z", "Ctrl", "Y"]);
    expect(redo.querySelector(".cf-shortcuts__or")?.textContent).toBe("or");
  });

  it("shows gestures as plain text after the keys, or alone", () => {
    mount();
    const zoom = rowOf("Zoom around the pointer");
    expect(zoom.querySelector("kbd")?.textContent).toBe("Ctrl");
    expect(zoom.querySelector(".cf-shortcuts__then")?.textContent).toBe("scroll wheel");
    const context = rowOf("Open the context menu");
    expect(context.querySelector("kbd")).toBeNull();
    expect(context.querySelector(".cf-shortcuts__then")?.textContent).toBe("right-click");
  });

  it("spreads the groups over two columns", () => {
    const { container } = mount();
    const columns = Array.from(container.ownerDocument.querySelectorAll(".cf-shortcuts__col"));
    expect(columns).toHaveLength(2);
    expect(columns.every((c) => c.querySelectorAll(".cf-shortcuts__group").length > 0)).toBe(true);
  });

  it("filters by what the shortcut does", async () => {
    mount();
    await userEvent.setup({ delay: null }).type(screen.getByRole("searchbox", { name: "Search shortcuts" }), "undo");
    expect(groupNames()).toEqual(["General"]);
    expect(screen.getByText("Undo")).toBeTruthy();
    expect(screen.queryByText("Redo")).toBeNull();
  });

  it("filters by the keys, in any order of the words", async () => {
    mount();
    const user = userEvent.setup({ delay: null });
    const search = screen.getByRole("searchbox", { name: "Search shortcuts" });
    await user.type(search, "shift z");
    expect(screen.getByText("Redo")).toBeTruthy();
    expect(screen.queryByText("Undo")).toBeNull();
    await user.clear(search);
    await user.type(search, "page strip");
    expect(groupNames()).toEqual(["Pages"]);
  });

  it("finds the same key in several groups", async () => {
    mount();
    await userEvent.setup({ delay: null }).type(screen.getByRole("searchbox", { name: "Search shortcuts" }), "esc");
    expect(groupNames().sort()).toEqual(["General", "Pages", "Pen and path points", "Presenting"]);
  });

  it("says when nothing matches and brings everything back when the search is cleared", async () => {
    mount();
    const user = userEvent.setup({ delay: null });
    const search = screen.getByRole("searchbox", { name: "Search shortcuts" });
    await user.type(search, "zzzz");
    expect(screen.getByText('No shortcuts match "zzzz".')).toBeTruthy();
    expect(groupNames()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(groupNames()).toHaveLength(9);
    expect(screen.queryByText(/No shortcuts match/)).toBeNull();
  });

  it("ignores spaces around the search words", async () => {
    mount();
    await userEvent.setup({ delay: null }).type(screen.getByRole("searchbox", { name: "Search shortcuts" }), "   ");
    expect(groupNames()).toHaveLength(9);
  });

  it("closes from its close button and on Escape", async () => {
    const onClose = vi.fn();
    mount(onClose);
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
