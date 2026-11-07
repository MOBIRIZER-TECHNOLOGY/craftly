import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { stubOffsets } from "@/test/dashuiLayout";
import { Modal, type ModalProps } from "./Modal";
import { Popover } from "./Popover";

/** An "Open modal" button that opens a modal with a text field and a footer button. */
function Demo({ onClose, ...props }: Partial<Omit<ModalProps, "open">> & { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open modal</button>
      <Modal
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Rename design"
        footer={<button>Save</button>}
        {...props}
      >
        <input aria-label="Name" />
      </Modal>
    </>
  );
}

const dialog = () => screen.getByRole("dialog");
const backdropOf = () => document.querySelector("[data-cf-layer='modal']") as HTMLElement;
const isInert = (el: Element) => Boolean((el as HTMLElement).inert);

async function openDemo(props: Parameters<typeof Demo>[0] = {}) {
  const user = userEvent.setup();
  const view = render(<Demo {...props} />);
  await user.click(screen.getByRole("button", { name: "Open modal" }));
  return { user, ...view };
}

describe("<Modal>", () => {
  it("renders nothing while closed", () => {
    render(
      <Modal open={false} onClose={() => undefined} title="Hidden">
        content
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a modal dialog named after its title, with body and footer", async () => {
    await openDemo();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Rename design" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Rename design" })).toBeTruthy();
    expect(within(dialog()).getByRole("textbox", { name: "Name" })).toBeTruthy();
    expect(within(dialog()).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(dialog().closest("#cf-overlay-root")).toBeTruthy();
  });

  it("uses aria-label as the name when there is no visible title", () => {
    render(
      <Modal open onClose={() => undefined} aria-label="Template preview">
        body
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Template preview" })).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("takes its size and classes from the props", () => {
    render(
      <Modal open onClose={() => undefined} aria-label="Wide" size="xl" flush className="my-modal" bodyClassName="my-body">
        body
      </Modal>,
    );
    const el = dialog();
    expect(el.classList.contains("cf-modal--xl")).toBe(true);
    expect(el.classList.contains("cf-modal--flush")).toBe(true);
    expect(el.classList.contains("my-modal")).toBe(true);
    expect(el.querySelector(".cf-modal__body")?.classList.contains("my-body")).toBe(true);
  });

  describe("closing", () => {
    it("closes from the Close button", async () => {
      const onClose = vi.fn();
      const { user } = await openDemo({ onClose });
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("has no Close button with hideClose", async () => {
      await openDemo({ hideClose: true });
      expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    });

    it("closes on Escape unless closeOnEscape is off", async () => {
      const onClose = vi.fn();
      const first = await openDemo({ onClose });
      await first.user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
      first.unmount();

      const stays = vi.fn();
      const second = await openDemo({ onClose: stays, closeOnEscape: false });
      await second.user.keyboard("{Escape}");
      expect(stays).not.toHaveBeenCalled();
      expect(dialog()).toBeTruthy();
    });

    it("closes when the backdrop is clicked, but not when the dialog is", async () => {
      const onClose = vi.fn();
      const { user } = await openDemo({ onClose });
      await user.click(dialog());
      expect(onClose).not.toHaveBeenCalled();
      await user.click(backdropOf());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not close when a press starts inside the dialog and ends on the backdrop", async () => {
      const onClose = vi.fn();
      await openDemo({ onClose });
      fireEvent.pointerDown(dialog());
      fireEvent.click(backdropOf());
      expect(onClose).not.toHaveBeenCalled();
    });

    it("ignores the backdrop when closeOnBackdrop is off", async () => {
      const onClose = vi.fn();
      const { user } = await openDemo({ onClose, closeOnBackdrop: false });
      await user.click(backdropOf());
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog()).toBeTruthy();
    });

    it("stays in the page for the exit animation, then leaves", () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      const { rerender } = render(
        <Modal open onClose={onClose} title="Bye">
          body
        </Modal>,
      );
      rerender(
        <Modal open={false} onClose={onClose} title="Bye">
          body
        </Modal>,
      );
      expect(backdropOf().classList.contains("is-closing")).toBe(true);
      act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(onClose).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(159));
      expect(screen.getByRole("dialog")).toBeTruthy();
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.body.dataset.cfModalOpen).toBeUndefined();
    });
  });

  describe("focus", () => {
    it("starts on the first focusable element of the body and returns to the opener on close", async () => {
      stubOffsets();
      const { user } = await openDemo();
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
      await user.keyboard("{Escape}");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open modal" }));
    });

    it("goes back to the button that opened the menu when the dialog came from one of the menu's items, which are gone by then", async () => {
      stubOffsets();
      const user = userEvent.setup();
      function FromMenu() {
        const [anchor, setAnchor] = useState<HTMLElement | null>(null);
        const [open, setOpen] = useState(false);
        return (
          <>
            <button onClick={(e) => setAnchor(e.currentTarget)}>Open menu</button>
            <Popover open={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} aria-label="Menu">
              <button
                onClick={() => {
                  setAnchor(null);
                  setOpen(true);
                }}
              >
                Item
              </button>
            </Popover>
            <Modal open={open} onClose={() => setOpen(false)} title="From the menu">
              <input aria-label="Name" />
            </Modal>
          </>
        );
      }
      render(<FromMenu />);
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      await user.click(await screen.findByRole("button", { name: "Item" }));
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open menu" }));
    });

    it("goes back to the element that took the opener's place while the dialog was open, when both carry the same data-focus-key", async () => {
      stubOffsets();
      const user = userEvent.setup();
      /* like a tool of the editor: its button turns into a progress block with an auto-focused Cancel, and the question comes a moment later */
      function Swap() {
        const [working, setWorking] = useState(false);
        const [open, setOpen] = useState(false);
        useEffect(() => {
          if (!working) return;
          const timer = setTimeout(() => setOpen(true), 50);
          return () => clearTimeout(timer);
        }, [working]);
        return (
          <>
            {working ? (
              <button key="busy" data-focus-key="tool" autoFocus>
                Cancel
              </button>
            ) : (
              <button key="idle" data-focus-key="tool" onClick={() => setWorking(true)}>
                Start
              </button>
            )}
            <Modal
              open={open}
              onClose={() => {
                setOpen(false);
                setWorking(false);
              }}
              title="Question"
            >
              <input aria-label="Answer" />
            </Modal>
          </>
        );
      }
      render(<Swap />);
      await user.click(screen.getByRole("button", { name: "Start" }));
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Start" }));
    });

    it("prefers an element marked data-autofocus", () => {
      stubOffsets();
      render(
        <Modal open onClose={() => undefined} title="Confirm">
          <input aria-label="First" />
          <button data-autofocus="">Primary</button>
        </Modal>,
      );
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Primary" }));
    });

    it("uses initialFocusRef when given", () => {
      stubOffsets();
      const ref = createRef<HTMLInputElement>();
      render(
        <Modal open onClose={() => undefined} title="Search" initialFocusRef={ref}>
          <input aria-label="First" />
          <input aria-label="Second" ref={ref} />
        </Modal>,
      );
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Second" }));
    });

    it("falls back to the first focusable element outside the body, such as the Close button", () => {
      stubOffsets();
      render(
        <Modal open onClose={() => undefined} title="Info">
          just text
        </Modal>,
      );
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    });

    it("focuses the dialog itself when nothing inside can take focus", () => {
      render(
        <Modal open onClose={() => undefined} aria-label="Plain" hideClose>
          just text
        </Modal>,
      );
      expect(document.activeElement).toBe(dialog());
    });

    it("keeps Tab inside the dialog", () => {
      stubOffsets();
      render(
        <Modal open onClose={() => undefined} title="Trap" footer={<button>Save</button>}>
          <input aria-label="Name" />
        </Modal>,
      );
      const name = screen.getByRole("textbox", { name: "Name" });
      const close = screen.getByRole("button", { name: "Close" });
      close.focus();
      expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(name);
      expect(fireEvent.keyDown(name, { key: "Tab", shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(close);
    });

    it("brings focus back when it escapes to the page behind (browsers without inert)", () => {
      const { container } = render(
        <>
          <button>Behind</button>
          <Modal open onClose={() => undefined} title="Held">
            body
          </Modal>
        </>,
      );
      (container as HTMLElement).inert = false;
      screen.getByRole("button", { name: "Behind" }).focus();
      expect(document.activeElement).toBe(dialog());
    });

    it("lets focus move into popovers and menus opened from the dialog", () => {
      render(
        <Modal open onClose={() => undefined} title="Held">
          body
        </Modal>,
      );
      const layer = document.createElement("div");
      layer.dataset.cfLayer = "popover";
      const inner = document.createElement("button");
      layer.append(inner);
      document.getElementById("cf-overlay-root")?.append(layer);
      inner.focus();
      expect(document.activeElement).toBe(inner);
      const other = document.createElement("button");
      document.getElementById("cf-overlay-root")?.append(other);
      other.focus();
      expect(document.activeElement).toBe(other);
    });
  });

  describe("page behind", () => {
    it("makes the page inert and stops it from scrolling while open, and restores both on close", async () => {
      const style = document.createElement("style");
      const script = document.createElement("script");
      document.body.append(style, script);
      const { user, container } = await openDemo();
      expect(isInert(container)).toBe(true);
      expect(isInert(style)).toBe(false);
      expect(isInert(script)).toBe(false);
      expect(isInert(document.getElementById("cf-overlay-root") as Element)).toBe(false);
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.dataset.cfModalOpen).toBe("1");
      await user.click(screen.getByRole("button", { name: "Close" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(isInert(container)).toBe(false);
      expect(document.body.style.overflow).toBe("");
      expect(document.body.dataset.cfModalOpen).toBeUndefined();
    });

    it("keeps the page inert until the last of several open modals has closed", () => {
      function Two({ firstOpen, secondOpen }: { firstOpen: boolean; secondOpen: boolean }) {
        return (
          <>
            <Modal open={firstOpen} onClose={() => undefined} title="First">
              one
            </Modal>
            <Modal open={secondOpen} onClose={() => undefined} title="Second">
              two
            </Modal>
          </>
        );
      }
      vi.useFakeTimers();
      const { container, rerender } = render(<Two firstOpen secondOpen />);
      expect(document.body.dataset.cfModalOpen).toBe("2");
      expect(isInert(container)).toBe(true);
      rerender(<Two firstOpen secondOpen={false} />);
      act(() => void vi.advanceTimersByTime(200));
      expect(document.body.dataset.cfModalOpen).toBe("1");
      expect(isInert(container)).toBe(true);
      rerender(<Two firstOpen={false} secondOpen={false} />);
      act(() => void vi.advanceTimersByTime(200));
      expect(document.body.dataset.cfModalOpen).toBeUndefined();
      expect(isInert(container)).toBe(false);
    });
  });

  describe("stacking", () => {
    function Stack() {
      const [second, setSecond] = useState(false);
      return (
        <>
          <Modal open onClose={() => undefined} title="Base" footer={<button onClick={() => setSecond(true)}>Open second</button>}>
            base
          </Modal>
          <Modal open={second} onClose={() => setSecond(false)} title="Nested">
            nested
          </Modal>
        </>
      );
    }

    it("lifts a modal opened from inside another one above it", async () => {
      const user = userEvent.setup();
      render(<Stack />);
      backdropOf().style.zIndex = "300";
      await user.click(screen.getByRole("button", { name: "Open second" }));
      const nested = screen.getByRole("dialog", { name: "Nested" }).parentElement as HTMLElement;
      expect(nested.style.zIndex).toBe("301");
    });

    it("leaves a modal on its base layer when the one below has a low z-index", async () => {
      const user = userEvent.setup();
      render(<Stack />);
      backdropOf().style.zIndex = "100";
      await user.click(screen.getByRole("button", { name: "Open second" }));
      const nested = screen.getByRole("dialog", { name: "Nested" }).parentElement as HTMLElement;
      expect(nested.style.zIndex).toBe("");
    });
  });
});
