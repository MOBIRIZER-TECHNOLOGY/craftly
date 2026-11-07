import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { rect, stubRects } from "@/test/dashuiLayout";
import { Menu, MenuList, MenuPopover, type MenuEntry, type MenuPopoverProps } from "./Menu";

/** A key press that makes the next menu behave like it was opened from the keyboard. */
const asKeyboardUser = () => fireEvent.keyDown(document.body, { key: "ArrowDown" });
/** A pointer press: the next menu behaves like it was opened with the mouse. */
const asMouseUser = () => fireEvent.pointerDown(document.body);

const names = () => screen.getAllByRole("menuitem").map((el) => el.textContent);
const focused = () => document.activeElement?.textContent;

function simpleItems(log: string[] = []): MenuEntry[] {
  return [
    { id: "open", label: "Open", onSelect: () => log.push("open") },
    { id: "rename", label: "Rename", onSelect: () => log.push("rename") },
    { id: "redo", label: "Redo", onSelect: () => log.push("redo") },
    { id: "delete", label: "Delete", danger: true, onSelect: () => log.push("delete") },
  ];
}

function submenuItems(log: string[] = []): MenuEntry[] {
  return [
    { id: "open", label: "Open" },
    {
      id: "more",
      label: "More",
      submenu: [
        { id: "alpha", label: "Alpha", onSelect: () => log.push("alpha") },
        { id: "beta", label: "Beta", onSelect: () => log.push("beta") },
      ],
    },
    { id: "last", label: "Last" },
  ];
}

describe("<Menu>", () => {
  it("lists its entries with the right roles", () => {
    render(
      <Menu
        aria-label="Edit"
        onClose={() => undefined}
        items={[
          { id: "open", label: "Open" },
          { type: "divider" },
          { type: "label", label: "View" },
          { id: "grid", label: "Show grid", checked: true },
          { id: "snap", label: "Snap to guides", checked: false },
          { id: "off", label: "Disabled", disabled: true },
        ]}
      />,
    );
    const menu = screen.getByRole("menu", { name: "Edit" });
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(within(menu).getByRole("separator")).toBeTruthy();
    expect(within(menu).getByText("View")).toBeTruthy();
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Show grid" }).getAttribute("aria-checked")).toBe("true");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Snap to guides" }).getAttribute("aria-checked")).toBe("false");
    expect(within(menu).getByRole("menuitem", { name: "Disabled" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("shows hints, shortcuts and icons next to the label", () => {
    render(
      <Menu
        onClose={() => undefined}
        items={[
          { id: "copy", label: "Copy", shortcut: "Ctrl+C", icon: <svg data-testid="copy-icon" /> },
          { id: "view", label: "View", hint: "Thumbnails" },
        ]}
      />,
    );
    const copy = screen.getByRole("menuitem", { name: /Copy/ });
    expect(within(copy).getByTestId("copy-icon")).toBeTruthy();
    expect(copy.textContent).toContain("Ctrl+C");
    expect(screen.getByRole("menuitem", { name: /View/ }).textContent).toContain("Thumbnails");
  });

  it("keeps the icon gutter out when no entry has an icon or a check", () => {
    const { container } = render(<Menu onClose={() => undefined} items={simpleItems()} />);
    expect(container.querySelector(".cf-menu__icon")).toBeNull();
  });

  it("closes the menu and then runs the chosen action", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    render(<Menu onClose={() => order.push("close")} items={[{ id: "open", label: "Open", onSelect: () => order.push("select") }]} />);
    await user.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(order).toEqual(["close", "select"]);
  });

  it("does nothing when a disabled entry is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<Menu onClose={onClose} items={[{ id: "off", label: "Off", disabled: true, onSelect }]} />);
    await user.click(screen.getByRole("menuitem", { name: "Off" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("treats an entry with an empty submenu as a plain action", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu onClose={() => undefined} items={[{ id: "x", label: "Plain", submenu: [], onSelect }]} />);
    await user.click(screen.getByRole("menuitem", { name: "Plain" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menuitem", { name: "Plain" }).getAttribute("aria-haspopup")).toBeNull();
  });

  describe("initial focus", () => {
    it("focuses the menu itself after a mouse press", () => {
      asMouseUser();
      render(<Menu aria-label="Menu" onClose={() => undefined} items={simpleItems()} />);
      expect(document.activeElement).toBe(screen.getByRole("menu"));
    });

    it("focuses the first entry when the keyboard opened it", () => {
      asKeyboardUser();
      render(<Menu onClose={() => undefined} items={simpleItems()} />);
      expect(focused()).toBe("Open");
    });

    it("focuses the first enabled entry", () => {
      asKeyboardUser();
      render(
        <Menu
          onClose={() => undefined}
          items={[
            { id: "off", label: "Off", disabled: true },
            { id: "on", label: "On" },
          ]}
        />,
      );
      expect(focused()).toBe("On");
    });

    it("always focuses the first entry with focusFirst", () => {
      asMouseUser();
      render(<MenuList focusFirst onClose={() => undefined} items={simpleItems()} />);
      expect(focused()).toBe("Open");
    });

    it("takes no focus with autoFocus off", () => {
      asKeyboardUser();
      render(<MenuList autoFocus={false} onClose={() => undefined} items={simpleItems()} />);
      expect(document.activeElement).toBe(document.body);
    });
  });

  describe("keyboard", () => {
    it("moves down and up through the entries, wrapping at both ends", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      render(<Menu onClose={() => undefined} items={simpleItems()} />);
      expect(focused()).toBe("Open");
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Rename");
      await user.keyboard("{ArrowUp}{ArrowUp}");
      expect(focused()).toBe("Delete");
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Open");
    });

    it("starts from the ends when nothing is focused yet", async () => {
      asMouseUser();
      const user = userEvent.setup();
      const { unmount } = render(<Menu onClose={() => undefined} items={simpleItems()} />);
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Open");
      unmount();
      asMouseUser();
      render(<Menu aria-label="Again" onClose={() => undefined} items={simpleItems()} />);
      expect(document.activeElement).toBe(screen.getByRole("menu"));
      await user.keyboard("{ArrowUp}");
      expect(focused()).toBe("Delete");
    });

    it("jumps to the first and last entry with Home and End", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      render(<Menu onClose={() => undefined} items={simpleItems()} />);
      await user.keyboard("{End}");
      expect(focused()).toBe("Delete");
      await user.keyboard("{Home}");
      expect(focused()).toBe("Open");
    });

    it("skips disabled entries, dividers and labels", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      render(
        <Menu
          onClose={() => undefined}
          items={[{ id: "a", label: "A" }, { id: "b", label: "B", disabled: true }, { type: "divider" }, { type: "label", label: "Group" }, { id: "c", label: "C" }]}
        />,
      );
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("C");
    });

    it("does not fail on a menu without enabled entries", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      render(<Menu aria-label="Menu" onClose={() => undefined} items={[{ id: "off", label: "Off", disabled: true }]} />);
      await user.keyboard("{ArrowDown}{ArrowUp}");
      expect(document.activeElement).toBe(screen.getByRole("menu"));
    });

    it("chooses the focused entry with Enter and Space", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      const log: string[] = [];
      const onClose = vi.fn();
      render(<Menu onClose={onClose} items={simpleItems(log)} />);
      await user.keyboard("{Enter}");
      await user.keyboard("{ArrowDown}");
      await user.keyboard(" ");
      expect(log).toEqual(["open", "rename"]);
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("closes on Tab instead of moving focus out", () => {
      asKeyboardUser();
      const onClose = vi.fn();
      render(<Menu onClose={onClose} items={simpleItems()} />);
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "Tab" })).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores ArrowLeft in a top-level menu and ArrowRight on entries without a submenu", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      render(<Menu onClose={() => undefined} items={simpleItems()} />);
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" })).toBe(true);
      await user.keyboard("{ArrowRight}");
      expect(focused()).toBe("Open");
    });

    it("calls onExitLeft for ArrowLeft when it has a parent menu", () => {
      asKeyboardUser();
      const onExitLeft = vi.fn();
      render(<MenuList onClose={() => undefined} onExitLeft={onExitLeft} items={simpleItems()} />);
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" })).toBe(false);
      expect(onExitLeft).toHaveBeenCalledTimes(1);
    });
  });

  describe("type-ahead", () => {
    const labels = (): MenuEntry[] => [
      { id: "open", label: "Open" },
      { id: "rename", label: "Rename" },
      { id: "redo", label: "Redo" },
      { id: "reload", label: "Reload" },
      { id: "off", label: "Reset", disabled: true },
    ];

    it("jumps to the next entry that starts with the typed letters, and keeps narrowing while typing fast", async () => {
      asKeyboardUser();
      let now = 10_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const user = userEvent.setup();
      render(<Menu onClose={() => undefined} items={labels()} />);
      await user.keyboard("r");
      expect(focused()).toBe("Rename");
      now += 100;
      await user.keyboard("e");
      expect(focused()).toBe("Redo");
      now += 100;
      await user.keyboard("l");
      expect(focused()).toBe("Reload");
    });

    it("starts a new search after a pause and cycles through entries with the same first letter", async () => {
      asKeyboardUser();
      let now = 10_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const user = userEvent.setup();
      render(<Menu onClose={() => undefined} items={labels()} />);
      await user.keyboard("r");
      expect(focused()).toBe("Rename");
      now += 1000;
      await user.keyboard("r");
      expect(focused()).toBe("Redo");
      now += 1000;
      await user.keyboard("r");
      expect(focused()).toBe("Reload");
      now += 1000;
      await user.keyboard("r");
      expect(focused()).toBe("Rename");
    });

    it("stays where it is when nothing matches, and never selects a disabled entry", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      render(<Menu onClose={() => undefined} items={labels()} />);
      await user.keyboard("z");
      expect(focused()).toBe("Open");
      await user.keyboard("{End}");
      expect(focused()).toBe("Reload");
    });

    it("leaves shortcuts with modifier keys alone", () => {
      asKeyboardUser();
      render(<Menu onClose={() => undefined} items={labels()} />);
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "r", ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "r", metaKey: true })).toBe(true);
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "r", altKey: true })).toBe(true);
      expect(focused()).toBe("Open");
    });
  });

  describe("submenus", () => {
    it("opens with ArrowRight, focuses the first entry and closes again with ArrowLeft", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      render(<Menu aria-label="Root" onClose={() => undefined} items={submenuItems()} />);
      await user.keyboard("{ArrowDown}");
      const parent = screen.getByRole("menuitem", { name: "More" });
      expect(parent.getAttribute("aria-haspopup")).toBe("menu");
      expect(parent.getAttribute("aria-expanded")).toBe("false");
      await user.keyboard("{ArrowRight}");
      const sub = screen.getByRole("menu", { name: "More" });
      expect(parent.getAttribute("aria-expanded")).toBe("true");
      expect(
        within(sub)
          .getAllByRole("menuitem")
          .map((el) => el.textContent),
      ).toEqual(["Alpha", "Beta"]);
      expect(focused()).toBe("Alpha");
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Beta");
      await user.keyboard("{ArrowLeft}");
      expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
      expect(document.activeElement).toBe(parent);
      expect(parent.getAttribute("aria-expanded")).toBe("false");
    });

    it("opens with Enter and runs a chosen entry, closing the whole menu", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      const log: string[] = [];
      const onClose = vi.fn();
      render(<Menu onClose={onClose} items={submenuItems(log)} />);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(focused()).toBe("Alpha");
      await user.keyboard("{ArrowDown}{Enter}");
      expect(log).toEqual(["beta"]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes only the submenu on Escape, and the next Escape reaches the menu around it", async () => {
      asKeyboardUser();
      const user = userEvent.setup();
      const onClose = vi.fn();
      function Host() {
        const [anchor, setAnchor] = useState<HTMLElement | null>(null);
        return (
          <>
            <button onClick={(e) => setAnchor(e.currentTarget)}>Open menu</button>
            <MenuPopover
              open={anchor !== null}
              anchor={anchor}
              onClose={() => {
                onClose();
                setAnchor(null);
              }}
              items={submenuItems()}
              aria-label="Root"
            />
          </>
        );
      }
      render(<Host />);
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
      expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
      expect(screen.getByRole("menu", { name: "Root" })).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("opens on a mouse click without moving focus into it", async () => {
      asMouseUser();
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<Menu onClose={onClose} items={submenuItems()} />);
      await user.click(screen.getByRole("menuitem", { name: "More" }));
      expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(screen.getByRole("menuitem", { name: "Alpha" }));
    });

    it("opens on hover after a short delay, and closes when the pointer moves to another entry", () => {
      vi.useFakeTimers();
      render(<Menu onClose={() => undefined} items={submenuItems()} />);
      fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "More" }), { pointerType: "mouse" });
      expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
      act(() => void vi.advanceTimersByTime(150));
      expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
      expect(focused()).toBe("More");
      fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Last" }), { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(100));
      expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
      act(() => void vi.advanceTimersByTime(100));
      expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
    });

    it("keeps the submenu open when the pointer comes back to its parent entry in time", () => {
      vi.useFakeTimers();
      render(<Menu onClose={() => undefined} items={submenuItems()} />);
      const parent = screen.getByRole("menuitem", { name: "More" });
      fireEvent.pointerEnter(parent, { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(150));
      fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Last" }), { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(100));
      fireEvent.pointerEnter(parent, { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
    });

    it("does not open on a touch hover and does not react to a disabled entry", () => {
      vi.useFakeTimers();
      render(
        <Menu
          onClose={() => undefined}
          items={[
            { id: "more", label: "More", submenu: [{ id: "alpha", label: "Alpha" }] },
            { id: "off", label: "Off", disabled: true, submenu: [{ id: "x", label: "X" }] },
          ]}
        />,
      );
      fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "More" }), { pointerType: "touch" });
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
      fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Off" }), { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.queryByRole("menu", { name: "Off" })).toBeNull();
    });

    it("closes an open submenu when the pointer moves onto a disabled entry", () => {
      vi.useFakeTimers();
      render(
        <Menu
          onClose={() => undefined}
          items={[
            { id: "more", label: "More", submenu: [{ id: "alpha", label: "Alpha" }] },
            { id: "off", label: "Off", disabled: true },
          ]}
        />,
      );
      fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "More" }), { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(150));
      expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
      fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Off" }), { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
    });
  });

  describe("checkbox entries", () => {
    it("shows a trailing check for a checked entry that also has an icon", () => {
      const { container } = render(
        <Menu
          onClose={() => undefined}
          items={[
            { id: "grid", label: "Grid", icon: <svg data-testid="icon" />, checked: true },
            { id: "snap", label: "Snap", icon: <svg />, checked: false },
          ]}
        />,
      );
      expect(container.querySelectorAll(".cf-menu__check")).toHaveLength(1);
      expect(within(screen.getByRole("menuitemcheckbox", { name: "Grid" })).getByTestId("icon")).toBeTruthy();
    });

    it("uses the check mark itself as the icon of a checked entry without one", () => {
      const { container } = render(
        <Menu
          onClose={() => undefined}
          items={[
            { id: "grid", label: "Grid", checked: true },
            { id: "snap", label: "Snap", checked: false },
          ]}
        />,
      );
      expect(container.querySelectorAll(".cf-menu__icon svg")).toHaveLength(1);
      expect(container.querySelectorAll(".cf-menu__icon")).toHaveLength(2);
    });
  });
});

describe("<MenuPopover>", () => {
  function Host({ items, ...props }: { items: MenuEntry[] } & Partial<MenuPopoverProps>) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <>
        <button onClick={(e) => setAnchor(e.currentTarget)}>Actions</button>
        <button>Elsewhere</button>
        <MenuPopover open={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} items={items} aria-label="Actions menu" {...props} />
      </>
    );
  }

  it("opens under its trigger as a menu in the overlay root", async () => {
    const user = userEvent.setup();
    render(<Host items={simpleItems()} />);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const menu = screen.getByRole("menu", { name: "Actions menu" });
    expect(menu.closest("#cf-overlay-root")).toBeTruthy();
    expect(names()).toEqual(["Open", "Rename", "Redo", "Delete"]);
  });

  it("runs the chosen action, closes and gives focus back to the trigger", async () => {
    const user = userEvent.setup();
    const log: string[] = [];
    render(<Host items={simpleItems(log)} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(log).toEqual(["rename"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens with the first entry focused when the trigger was activated from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Host items={simpleItems()} />);
    screen.getByRole("button", { name: "Actions" }).focus();
    await user.keyboard("{Enter}");
    expect(focused()).toBe("Open");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and on a press outside", async () => {
    const user = userEvent.setup();
    render(<Host items={simpleItems()} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Tab", async () => {
    const user = userEvent.setup();
    render(<Host items={simpleItems()} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.tab();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("passes its class name along and can be as wide as the trigger", async () => {
    stubRects((el) => (el instanceof HTMLButtonElement && el.textContent === "Actions" ? rect(10, 10, 150, 30) : null));
    const user = userEvent.setup();
    render(<Host items={simpleItems()} className="custom-menu" matchWidth />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const panel = screen.getByRole("menu").closest("[data-cf-layer]") as HTMLElement;
    expect(panel.classList.contains("custom-menu")).toBe(true);
    expect(panel.style.minWidth).toBe("150px");
  });

  it("opens on the side it is asked to", async () => {
    stubRects((el) => (el instanceof HTMLButtonElement && el.textContent === "Actions" ? rect(300, 100, 80, 30) : null));
    const user = userEvent.setup();
    render(<Host items={simpleItems()} placement="top" offset={4} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const panel = screen.getByRole("menu").closest("[data-cf-layer]") as HTMLElement;
    expect(panel.dataset.side).toBe("top");
  });
});
