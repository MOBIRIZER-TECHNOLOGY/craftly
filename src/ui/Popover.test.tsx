import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { rect, stubOffsets, stubRects } from "@/test/dashuiLayout";
import { OVERLAY_ROOT_ID } from "./overlay";
import { Popover, type PopoverProps } from "./Popover";

/** A trigger button that toggles a popover anchored to it. */
function Demo({ onClose, ...props }: Partial<Omit<PopoverProps, "open" | "anchor">> & { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        onClick={(e) => {
          setAnchor(e.currentTarget);
          setOpen((value) => !value);
        }}
      >
        Toggle
      </button>
      <button>Elsewhere</button>
      <Popover
        open={open}
        anchor={anchor}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        aria-label="Panel"
        {...props}
      >
        <button>First</button>
        <button>Last</button>
      </Popover>
    </>
  );
}

const panel = () => screen.getByRole("dialog", { name: "Panel" });
const queryPanel = () => screen.queryByRole("dialog", { name: "Panel" });

/** Boxes for the trigger; the panel's own size comes from offsetWidth / offsetHeight. */
function stubGeometry(anchorBox: { current: DOMRect }, panelSize = { width: 120, height: 80 }) {
  const restoreRects = stubRects((el) => (el instanceof HTMLButtonElement && el.textContent === "Toggle" ? anchorBox.current : null));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.cfLayer === "popover" ? panelSize.width : 100;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.cfLayer === "popover" ? panelSize.height : 24;
  });
  return restoreRects;
}

describe("<Popover>", () => {
  it("renders nothing while closed or without an anchor", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const { rerender } = render(<Popover open={false} anchor={anchor} onClose={() => undefined} aria-label="Panel" />);
    expect(queryPanel()).toBeNull();
    rerender(<Popover open anchor={null} onClose={() => undefined} aria-label="Panel" />);
    expect(queryPanel()).toBeNull();
  });

  it("shows its content in the overlay root as a named dialog", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(panel().parentElement?.id).toBe(OVERLAY_ROOT_ID);
    expect(within(panel()).getByRole("button", { name: "First" })).toBeTruthy();
  });

  it("lets the caller choose the role, id and class of the panel", async () => {
    const user = userEvent.setup();
    render(<Demo role="presentation" id="my-panel" className="extra" style={{ width: 200 }} />);
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const el = document.getElementById("my-panel") as HTMLElement;
    expect(el.classList.contains("cf-popover")).toBe(true);
    expect(el.classList.contains("extra")).toBe(true);
    expect(el.style.width).toBe("200px");
  });

  it("hands the panel element to a forwarded ref", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLDivElement>();
    function WithRef() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <button onClick={(e) => setAnchor(e.currentTarget)}>Open</button>
          <Popover ref={ref} open anchor={anchor} onClose={() => undefined} aria-label="Panel" />
        </>
      );
    }
    render(<WithRef />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(ref.current).toBe(panel());
  });

  it("marks the page while it is open", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(document.body.dataset.cfOverlay).toBe("1");
    await user.keyboard("{Escape}");
    expect(document.body.dataset.cfOverlay).toBeUndefined();
  });

  describe("focus", () => {
    it("moves focus into the panel when it opens and back to the trigger when it closes", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      const trigger = screen.getByRole("button", { name: "Toggle" });
      await user.click(trigger);
      expect(document.activeElement).toBe(panel());
      await user.keyboard("{Escape}");
      expect(queryPanel()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("gives the focus to the item marked data-autofocus, also in StrictMode", async () => {
      const user = userEvent.setup();
      function Marked() {
        const [anchor, setAnchor] = useState<HTMLElement | null>(null);
        return (
          <>
            <button onClick={(e) => setAnchor(e.currentTarget)}>Open</button>
            <Popover open={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} aria-label="Panel">
              <button data-autofocus="">Item</button>
            </Popover>
          </>
        );
      }
      render(
        <StrictMode>
          <Marked />
        </StrictMode>,
      );
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(document.activeElement).toBe(within(panel()).getByRole("button", { name: "Item" }));
    });

    it("leaves focus alone when initialFocus is off", async () => {
      const user = userEvent.setup();
      render(<Demo initialFocus={false} />);
      const trigger = screen.getByRole("button", { name: "Toggle" });
      await user.click(trigger);
      expect(document.activeElement).toBe(trigger);
    });

    it("does not pull focus back when restoreFocus is off", async () => {
      const user = userEvent.setup();
      render(<Demo restoreFocus={false} />);
      const trigger = screen.getByRole("button", { name: "Toggle" });
      await user.click(trigger);
      await user.keyboard("{Escape}");
      expect(document.activeElement).not.toBe(trigger);
    });

    it("leaves focus on the element the user pressed outside the panel", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await user.click(screen.getByRole("button", { name: "Elsewhere" }));
      expect(queryPanel()).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Elsewhere" }));
    });

    it("keeps Tab inside the panel", async () => {
      stubOffsets();
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      const first = screen.getByRole("button", { name: "First" });
      const last = screen.getByRole("button", { name: "Last" });
      last.focus();
      expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(first);
      expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(last);
    });

    it("lets Tab leave the panel when trapFocus is off", async () => {
      stubOffsets();
      const user = userEvent.setup();
      render(<Demo trapFocus={false} />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      const last = screen.getByRole("button", { name: "Last" });
      last.focus();
      expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(true);
    });
  });

  describe("dismissal", () => {
    it("closes on Escape", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<Demo onClose={onClose} />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(queryPanel()).toBeNull();
    });

    it("stays open on Escape when closeOnEscape is off", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<Demo onClose={onClose} closeOnEscape={false} />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
      expect(panel()).toBeTruthy();
    });

    it("closes when the user presses outside, but not inside or on the trigger", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<Demo onClose={onClose} />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await user.click(screen.getByRole("button", { name: "First" }));
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.pointerDown(screen.getByRole("button", { name: "Toggle" }));
      expect(onClose).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Elsewhere" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(queryPanel()).toBeNull();
    });

    it("lets the trigger toggle the panel shut", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      const trigger = screen.getByRole("button", { name: "Toggle" });
      await user.click(trigger);
      expect(panel()).toBeTruthy();
      await user.click(trigger);
      expect(queryPanel()).toBeNull();
    });

    it("ignores outside presses when closeOnOutsidePress is off", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<Demo onClose={onClose} closeOnOutsidePress={false} />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await user.click(screen.getByRole("button", { name: "Elsewhere" }));
      expect(onClose).not.toHaveBeenCalled();
      expect(panel()).toBeTruthy();
    });

    it("closes by itself when its trigger is removed from the page", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      function Removable() {
        const [show, setShow] = useState(true);
        const [anchor, setAnchor] = useState<HTMLElement | null>(null);
        return (
          <>
            {show ? <button onClick={(e) => setAnchor(e.currentTarget)}>Trigger</button> : null}
            <button onClick={() => setShow(false)}>Remove trigger</button>
            <Popover open anchor={anchor} onClose={onClose} closeOnOutsidePress={false} aria-label="Panel" />
          </>
        );
      }
      render(<Removable />);
      await user.click(screen.getByRole("button", { name: "Trigger" }));
      // while the trigger is on the page the popover stays open
      expect(onClose).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Remove trigger" }));
      expect(screen.queryByRole("button", { name: "Trigger" })).toBeNull();
      // the next layout event (a resize here, a frame or an observer in a browser) finds the trigger gone and closes it. Whether
      // it closed a moment earlier is left open on purpose: the frame asked for when the popover got its trigger can come after
      // the trigger is gone, and on a busy machine it did, which made this test fail now and then
      act(() => void window.dispatchEvent(new Event("resize")));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
  });

  describe("placement", () => {
    it("opens below the trigger with the left edges aligned", async () => {
      const anchorBox = { current: rect(100, 100, 100, 30) };
      stubGeometry(anchorBox);
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      expect(panel().style.left).toBe("100px");
      expect(panel().style.top).toBe("138px");
      expect(panel().dataset.side).toBe("bottom");
      expect(panel().dataset.align).toBe("start");
    });

    it("flips above the trigger when there is no room below", async () => {
      const anchorBox = { current: rect(100, 740, 100, 30) };
      stubGeometry(anchorBox);
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      expect(panel().dataset.side).toBe("top");
      expect(panel().style.top).toBe(`${740 - 8 - 80}px`);
    });

    it("applies the offset, the alignment and the cross-axis offset", async () => {
      const anchorBox = { current: rect(100, 100, 100, 30) };
      stubGeometry(anchorBox);
      const user = userEvent.setup();
      render(<Demo placement="bottom-end" offset={20} alignOffset={10} />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      expect(panel().style.top).toBe("150px");
      expect(panel().style.left).toBe(`${200 - 120 - 10}px`);
      expect(panel().dataset.align).toBe("end");
    });

    it("is at least as wide as the trigger with matchWidth", async () => {
      const anchorBox = { current: rect(100, 100, 187, 30) };
      stubGeometry(anchorBox);
      const user = userEvent.setup();
      render(<Demo matchWidth />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      expect(panel().style.minWidth).toBe("187px");
    });

    it("limits the height of a panel that is taller than the room it has", async () => {
      const anchorBox = { current: rect(100, 400, 100, 30) };
      stubGeometry(anchorBox, { width: 120, height: 900 });
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      expect(panel().style.maxHeight).toBe("384px");
    });

    it("opens at a point for context menus", () => {
      stubGeometry({ current: rect(0, 0, 0, 0) });
      render(<Popover open anchor={{ x: 300, y: 200 }} onClose={() => undefined} aria-label="Panel" offset={2} />);
      expect(panel().style.left).toBe("300px");
      expect(panel().style.top).toBe("202px");
    });

    it("follows the trigger when the window is resized or scrolled", async () => {
      const anchorBox = { current: rect(100, 100, 100, 30) };
      stubGeometry(anchorBox);
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      anchorBox.current = rect(300, 100, 100, 30);
      act(() => void window.dispatchEvent(new Event("resize")));
      await waitFor(() => expect(panel().style.left).toBe("300px"));
      anchorBox.current = rect(420, 150, 100, 30);
      act(() => void document.body.dispatchEvent(new Event("scroll")));
      await waitFor(() => expect(panel().style.left).toBe("420px"));
      expect(panel().style.top).toBe("188px");
    });

    it("stays put when only the panel's own content scrolls", async () => {
      const anchorBox = { current: rect(100, 100, 100, 30) };
      stubGeometry(anchorBox);
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      // the resize observer reports once when it starts watching, which schedules one more placement: let it run first
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      anchorBox.current = rect(500, 100, 100, 30);
      fireEvent.scroll(screen.getByRole("button", { name: "First" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(panel().style.left).toBe("100px");
    });
  });

  describe("layers", () => {
    function Nested() {
      const [parentOpen, setParentOpen] = useState(false);
      const [childOpen, setChildOpen] = useState(false);
      const [trigger, setTrigger] = useState<HTMLElement | null>(null);
      const [inner, setInner] = useState<HTMLElement | null>(null);
      return (
        <>
          <button
            onClick={(e) => {
              setTrigger(e.currentTarget);
              setParentOpen(true);
            }}
          >
            Open parent
          </button>
          <button>Elsewhere</button>
          <Popover open={parentOpen} anchor={trigger} onClose={() => setParentOpen(false)} aria-label="Parent">
            <button
              onClick={(e) => {
                setInner(e.currentTarget);
                setChildOpen(true);
              }}
            >
              Open child
            </button>
          </Popover>
          <Popover open={childOpen} anchor={inner} onClose={() => setChildOpen(false)} aria-label="Child">
            <button>In child</button>
          </Popover>
        </>
      );
    }

    it("lifts a popover opened from another one above it", async () => {
      const user = userEvent.setup();
      render(<Nested />);
      await user.click(screen.getByRole("button", { name: "Open parent" }));
      screen.getByRole("dialog", { name: "Parent" }).style.zIndex = "300";
      await user.click(screen.getByRole("button", { name: "Open child" }));
      expect(screen.getByRole("dialog", { name: "Child" }).style.zIndex).toBe("301");
      expect(document.body.dataset.cfOverlay).toBe("2");
    });

    it("keeps the parent open while the user works inside the child, and closes both on an outside press", async () => {
      const user = userEvent.setup();
      render(<Nested />);
      await user.click(screen.getByRole("button", { name: "Open parent" }));
      await user.click(screen.getByRole("button", { name: "Open child" }));
      await user.click(screen.getByRole("button", { name: "In child" }));
      expect(screen.getByRole("dialog", { name: "Parent" })).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "Child" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Elsewhere" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes the topmost popover first on Escape", async () => {
      const user = userEvent.setup();
      render(<Nested />);
      await user.click(screen.getByRole("button", { name: "Open parent" }));
      await user.click(screen.getByRole("button", { name: "Open child" }));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "Child" })).toBeNull();
      expect(screen.getByRole("dialog", { name: "Parent" })).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
