import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { rect, stubRects } from "@/test/dashuiLayout";
import { Tooltip, type TooltipProps } from "./Tooltip";

const tip = () => screen.queryByRole("tooltip");
const trigger = (name = "Bold") => screen.getByRole("button", { name });
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const hover = (el: Element, pointerType = "mouse") => fireEvent.pointerEnter(el, { pointerType });

function Demo(props: Partial<TooltipProps> & { label?: string }) {
  const { label = "Bold", ...rest } = props;
  return (
    <Tooltip content="Make the text bold" {...rest}>
      <button>{label}</button>
    </Tooltip>
  );
}

/** The grace period between two tooltips is measured against the clock, so each test moves it on. */
let clock = 1_000_000;
function startClock() {
  vi.useFakeTimers();
  clock += 10_000;
  vi.setSystemTime(clock);
}

describe("<Tooltip>", () => {
  describe("hover", () => {
    it("appears after the delay and disappears when the pointer leaves", () => {
      startClock();
      render(<Demo />);
      hover(trigger());
      advance(449);
      expect(tip()).toBeNull();
      advance(1);
      expect(tip()?.textContent).toBe("Make the text bold");
      fireEvent.pointerLeave(trigger());
      expect(tip()).toBeNull();
    });

    it("describes the trigger while it is shown", () => {
      startClock();
      render(<Demo />);
      expect(trigger().getAttribute("aria-describedby")).toBeNull();
      hover(trigger());
      advance(450);
      expect(trigger().getAttribute("aria-describedby")).toBe(tip()?.id);
      fireEvent.pointerLeave(trigger());
      expect(trigger().getAttribute("aria-describedby")).toBeNull();
    });

    it("leaves aria-describedby alone with describe off, and keeps one the trigger already had", () => {
      startClock();
      const { unmount } = render(<Demo describe={false} />);
      hover(trigger());
      advance(450);
      expect(tip()).toBeTruthy();
      expect(trigger().getAttribute("aria-describedby")).toBeNull();
      unmount();
      render(
        <Tooltip content="Tip">
          <button aria-describedby="help">Bold</button>
        </Tooltip>,
      );
      expect(trigger().getAttribute("aria-describedby")).toBe("help");
    });

    it("waits as long as the delay prop says", () => {
      startClock();
      render(<Demo delay={100} />);
      hover(trigger());
      advance(100);
      expect(tip()).toBeTruthy();
    });

    it("never appears when the pointer leaves before the delay", () => {
      startClock();
      render(<Demo />);
      hover(trigger());
      advance(200);
      fireEvent.pointerLeave(trigger());
      advance(1000);
      expect(tip()).toBeNull();
    });

    it("starts counting again when the pointer re-enters", () => {
      startClock();
      render(<Demo />);
      hover(trigger());
      advance(300);
      hover(trigger());
      advance(300);
      expect(tip()).toBeNull();
      advance(150);
      expect(tip()).toBeTruthy();
    });

    it("does not appear for a touch", () => {
      startClock();
      render(<Demo />);
      hover(trigger(), "touch");
      advance(1000);
      expect(tip()).toBeNull();
    });

    it("goes away when the trigger is pressed", () => {
      startClock();
      render(<Demo />);
      hover(trigger());
      advance(450);
      fireEvent.pointerDown(trigger());
      expect(tip()).toBeNull();
    });

    it("opens at once when another tooltip closed a moment ago, and waits again after that", () => {
      startClock();
      render(
        <>
          <Demo label="Bold" />
          <Demo label="Italic" content="Make the text italic" />
        </>,
      );
      hover(trigger("Bold"));
      advance(450);
      fireEvent.pointerLeave(trigger("Bold"));
      hover(trigger("Italic"));
      advance(0);
      expect(tip()?.textContent).toBe("Make the text italic");
      fireEvent.pointerLeave(trigger("Italic"));
      advance(400);
      hover(trigger("Bold"));
      advance(100);
      expect(tip()).toBeNull();
      advance(350);
      expect(tip()?.textContent).toBe("Make the text bold");
    });
  });

  describe("keyboard", () => {
    it("appears at once on focus and goes away on blur", () => {
      startClock();
      render(<Demo />);
      act(() => trigger().focus());
      advance(0);
      expect(tip()).toBeTruthy();
      act(() => trigger().blur());
      expect(tip()).toBeNull();
    });

    it("goes away on Escape without closing anything else, and ignores other keys", () => {
      startClock();
      render(<Demo />);
      act(() => trigger().focus());
      advance(0);
      fireEvent.keyDown(trigger(), { key: "a" });
      expect(tip()).toBeTruthy();
      fireEvent.keyDown(trigger(), { key: "Escape" });
      expect(tip()).toBeNull();
      fireEvent.keyDown(trigger(), { key: "Escape" });
      expect(tip()).toBeNull();
    });
  });

  describe("content", () => {
    it("shows the shortcut next to the text", () => {
      startClock();
      render(<Demo shortcut="Ctrl+B" />);
      hover(trigger());
      advance(450);
      expect(tip()?.textContent).toContain("Make the text bold");
      expect(tip()?.querySelector(".cf-tooltip__kbd")?.textContent).toBe("Ctrl+B");
    });

    it("renders rich content", () => {
      startClock();
      render(<Demo content={<strong>Very bold</strong>} />);
      hover(trigger());
      advance(450);
      expect(tip()?.querySelector("strong")?.textContent).toBe("Very bold");
    });

    it("is switched off for empty content", () => {
      startClock();
      for (const content of ["", null, undefined, false]) {
        const { unmount } = render(<Demo content={content as never} />);
        hover(trigger());
        advance(1000);
        expect(tip()).toBeNull();
        unmount();
      }
    });

    it("is switched off with disabled, even when it was already showing", () => {
      startClock();
      const { rerender } = render(<Demo />);
      hover(trigger());
      advance(450);
      expect(tip()).toBeTruthy();
      rerender(<Demo disabled />);
      expect(tip()).toBeNull();
      hover(trigger());
      advance(1000);
      expect(tip()).toBeNull();
    });

    it("hides when the page scrolls or the window is resized", () => {
      startClock();
      render(<Demo />);
      hover(trigger());
      advance(450);
      act(() => void document.body.dispatchEvent(new Event("scroll")));
      expect(tip()).toBeNull();
      advance(1000);
      hover(trigger());
      advance(450);
      expect(tip()).toBeTruthy();
      act(() => void window.dispatchEvent(new Event("resize")));
      expect(tip()).toBeNull();
    });
  });

  describe("trigger", () => {
    it("keeps the trigger's own handlers and ref", () => {
      startClock();
      const ref = createRef<HTMLButtonElement>();
      const calls: string[] = [];
      render(
        <Tooltip content="Tip">
          <button
            ref={ref}
            onPointerEnter={() => calls.push("enter")}
            onPointerLeave={() => calls.push("leave")}
            onPointerDown={() => calls.push("down")}
            onFocus={() => calls.push("focus")}
            onBlur={() => calls.push("blur")}
            onKeyDown={() => calls.push("key")}
          >
            Bold
          </button>
        </Tooltip>,
      );
      expect(ref.current).toBe(trigger());
      hover(trigger());
      fireEvent.pointerDown(trigger());
      act(() => trigger().focus());
      fireEvent.keyDown(trigger(), { key: "a" });
      act(() => trigger().blur());
      fireEvent.pointerLeave(trigger());
      expect(calls).toEqual(["enter", "down", "focus", "key", "blur", "leave"]);
    });

    it("renders the trigger untouched when the tooltip is off", () => {
      render(<Demo content="" />);
      expect(trigger().getAttribute("aria-describedby")).toBeNull();
      expect(trigger().tagName).toBe("BUTTON");
    });

    it("does not show anything after it was removed while waiting", () => {
      startClock();
      const { unmount } = render(<Demo />);
      hover(trigger());
      unmount();
      advance(1000);
      expect(tip()).toBeNull();
    });
  });

  describe("placement", () => {
    function stubBoxes(anchor: DOMRect) {
      stubRects((el) => (el instanceof HTMLButtonElement ? anchor : null));
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
        return this.getAttribute("role") === "tooltip" ? 60 : 0;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.getAttribute("role") === "tooltip" ? 20 : 0;
      });
    }

    it("sits centred above the trigger by default", () => {
      startClock();
      stubBoxes(rect(100, 100, 80, 30));
      render(<Demo />);
      hover(trigger());
      advance(450);
      expect(tip()?.style.left).toBe("110px");
      expect(tip()?.style.top).toBe(`${100 - 8 - 20}px`);
      expect(tip()?.dataset.side).toBe("top");
    });

    it("flips below the trigger at the top of the window", () => {
      startClock();
      stubBoxes(rect(100, 6, 80, 30));
      render(<Demo />);
      hover(trigger());
      advance(450);
      expect(tip()?.dataset.side).toBe("bottom");
      expect(tip()?.style.top).toBe(`${36 + 8}px`);
    });

    it("can be placed beside the trigger", () => {
      startClock();
      stubBoxes(rect(300, 100, 80, 30));
      render(<Demo placement="right" />);
      hover(trigger());
      advance(450);
      expect(tip()?.dataset.side).toBe("right");
      expect(tip()?.style.left).toBe(`${380 + 8}px`);
    });
  });
});
