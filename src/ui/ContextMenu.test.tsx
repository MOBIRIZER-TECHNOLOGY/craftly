import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost, closeContextMenu, openContextMenu, type ContextMenuRequest } from "./ContextMenu";

const menu = () => screen.queryByRole("menu", { name: "Context menu" });
const open = (request: Partial<ContextMenuRequest> = {}) =>
  act(() =>
    openContextMenu({
      x: 120,
      y: 80,
      items: [
        { id: "copy", label: "Copy", onSelect: () => undefined },
        { id: "paste", label: "Paste", onSelect: () => undefined },
      ],
      ...request,
    }),
  );

afterEach(() => {
  act(() => closeContextMenu());
});

describe("<ContextMenuHost>", () => {
  it("renders nothing until a menu is requested", () => {
    render(<ContextMenuHost />);
    expect(menu()).toBeNull();
  });

  it("opens the requested menu at the pointer position", () => {
    render(<ContextMenuHost />);
    open({ x: 120, y: 80 });
    expect(menu()).toBeTruthy();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Copy", "Paste"]);
    const panel = menu()?.closest("[data-cf-layer]") as HTMLElement;
    expect(panel.style.left).toBe("120px");
    expect(panel.style.top).toBe("82px");
  });

  it("runs the chosen action, then closes and tells the requester", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenuHost />);
    open({ items: [{ id: "copy", label: "Copy", onSelect }], onClose });
    await user.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on demand, once", () => {
    const onClose = vi.fn();
    render(<ContextMenuHost />);
    open({ onClose });
    act(() => closeContextMenu());
    act(() => closeContextMenu());
    expect(menu()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("replaces an open menu with a new one and tells the first requester it is gone", () => {
    const firstClosed = vi.fn();
    const secondClosed = vi.fn();
    render(<ContextMenuHost />);
    open({ items: [{ id: "a", label: "First menu" }], onClose: firstClosed });
    open({ items: [{ id: "b", label: "Second menu" }], onClose: secondClosed });
    expect(screen.queryByRole("menuitem", { name: "First menu" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Second menu" })).toBeTruthy();
    expect(firstClosed).toHaveBeenCalledTimes(1);
    expect(secondClosed).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContextMenuHost />);
    open({ onClose });
    await user.keyboard("{Escape}");
    expect(menu()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a press outside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Page</button>
        <ContextMenuHost />
      </>,
    );
    open();
    await user.click(screen.getByRole("button", { name: "Page" }));
    expect(menu()).toBeNull();
  });

  it("lets the arrow keys move through the entries", async () => {
    const user = userEvent.setup();
    render(<ContextMenuHost />);
    open();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Copy");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Paste");
  });

  describe("dismissed when the surroundings change", () => {
    it.each([
      ["the window loses focus", () => window.dispatchEvent(new Event("blur"))],
      ["the window is resized", () => window.dispatchEvent(new Event("resize"))],
      ["the page scrolls", () => document.body.dispatchEvent(new Event("scroll"))],
      ["the mouse wheel turns over the page", () => fireEvent.wheel(document.body)],
    ])("closes when %s", (_name, trigger) => {
      const onClose = vi.fn();
      render(<ContextMenuHost />);
      open({ onClose });
      act(() => void trigger());
      expect(menu()).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("stays open when the menu itself scrolls", () => {
      render(<ContextMenuHost />);
      open();
      const item = screen.getByRole("menuitem", { name: "Copy" });
      act(() => void item.dispatchEvent(new Event("scroll")));
      fireEvent.wheel(item);
      expect(menu()).toBeTruthy();
    });

    it("stops watching the window once the menu has closed", () => {
      const remove = vi.spyOn(window, "removeEventListener");
      render(<ContextMenuHost />);
      open();
      act(() => closeContextMenu());
      const removed = remove.mock.calls.map((call) => call[0]);
      expect(removed).toEqual(expect.arrayContaining(["blur", "resize", "scroll", "wheel"]));
    });
  });
});
