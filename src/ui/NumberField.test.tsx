import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberField, type NumberFieldProps } from "./NumberField";

type DemoProps = Partial<Omit<NumberFieldProps, "value" | "onChange">> & { initial?: number; onChange?: (value: number) => void };

function Demo({ initial = 10, onChange, ...props }: DemoProps) {
  const [value, setValue] = useState(initial);
  return (
    <NumberField
      aria-label="Width"
      {...props}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

const field = () => screen.getByRole("spinbutton") as HTMLInputElement;

/** Replace the text of the field the way a person would: select all, type, then leave it. */
async function enter(user: UserEvent, text: string, finish: "{Enter}" | "tab" = "{Enter}") {
  await user.clear(field());
  if (text) await user.type(field(), text);
  if (finish === "tab") await user.tab();
  else await user.keyboard(finish);
}

describe("<NumberField>", () => {
  describe("display", () => {
    it("shows the value with up to two decimals", () => {
      render(<Demo initial={12.3456} />);
      expect(field().value).toBe("12.35");
    });

    it("shows a fixed number of decimals when precision is set", () => {
      const { rerender } = render(<NumberField aria-label="Width" value={7} precision={2} onChange={() => undefined} />);
      expect(field().value).toBe("7.00");
      rerender(<NumberField aria-label="Width" value={7.6} precision={0} onChange={() => undefined} />);
      expect(field().value).toBe("8");
    });

    it("shows nothing for a value that is not a number", () => {
      render(<NumberField aria-label="Width" value={Number.NaN} onChange={() => undefined} />);
      expect(field().value).toBe("");
      expect(field().getAttribute("aria-valuenow")).toBeNull();
    });

    it("exposes the value and its limits as a spin button", () => {
      render(<Demo initial={4} min={0} max={10} />);
      expect(field().getAttribute("aria-valuenow")).toBe("4");
      expect(field().getAttribute("aria-valuemin")).toBe("0");
      expect(field().getAttribute("aria-valuemax")).toBe("10");
      expect(screen.getByRole("spinbutton", { name: "Width" })).toBe(field());
    });

    it("shows a label inside the field and uses it as the name", () => {
      render(<NumberField label="Height" value={3} onChange={() => undefined} />);
      expect(screen.getByRole("spinbutton", { name: "Height" })).toBeTruthy();
      expect(screen.getByText("Height")).toBeTruthy();
    });

    it("shows a prefix and a suffix around the number", () => {
      render(<Demo prefix={<span>W</span>} suffix="px" title="Width of the page" width={96} className="extra" size="sm" id="w" />);
      expect(screen.getByText("W")).toBeTruthy();
      expect(screen.getByText("px")).toBeTruthy();
      const root = field().parentElement as HTMLElement;
      expect(root.title).toBe("Width of the page");
      expect(root.style.width).toBe("96px");
      expect(root.classList.contains("extra")).toBe(true);
      expect(root.classList.contains("cf-num--sm")).toBe(true);
      expect(field().id).toBe("w");
    });

    it("hands the input to a forwarded ref", () => {
      const ref = createRef<HTMLInputElement>();
      render(<NumberField ref={ref} aria-label="Width" value={1} onChange={() => undefined} />);
      expect(ref.current).toBe(field());
    });

    it("is disabled as a whole", () => {
      render(<Demo disabled stepper />);
      expect(field().disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Decrease Width" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Increase Width" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("typing", () => {
    it("applies the typed number on Enter, as a change and a commit", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(<Demo onChange={onChange} onCommit={onCommit} />);
      await enter(user, "42");
      expect(onChange).toHaveBeenCalledWith(42);
      expect(onCommit).toHaveBeenCalledWith(42);
      expect(field().value).toBe("42");
      expect(document.activeElement).not.toBe(field());
    });

    it("applies the typed number when focus leaves the field", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await enter(user, "7", "tab");
      expect(onChange).toHaveBeenCalledWith(7);
    });

    it("keeps the text as typed while editing", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await user.clear(field());
      await user.type(field(), "123");
      expect(field().value).toBe("123");
      expect(onChange).not.toHaveBeenCalled();
    });

    describe("the selection made when the field gets focus", () => {
      /** Animation frames wait in a queue until the test lets them run, so the order of typing and frame is never left to timing. */
      function holdFrames() {
        const queued: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => queued.push(callback));
        return () => act(() => queued.splice(0).forEach((callback) => callback(0)));
      }

      it("selects the whole number on the next frame, so typing replaces it", async () => {
        const runFrames = holdFrames();
        const user = userEvent.setup();
        render(<Demo initial={250} />);
        await user.click(field());
        expect(field().selectionStart).toBe(field().selectionEnd);
        runFrames();
        expect(field().selectionStart).toBe(0);
        expect(field().selectionEnd).toBe(3);
      });

      it("leaves text that was typed before that frame alone", async () => {
        const runFrames = holdFrames();
        const user = userEvent.setup();
        render(<Demo initial={250} />);
        await user.click(field());
        await user.clear(field());
        await user.type(field(), "20");
        runFrames();
        expect(field().value).toBe("20");
        // the caret is still after the typed digits: nothing was selected over them
        expect(field().selectionStart).toBe(2);
        expect(field().selectionEnd).toBe(2);
        await user.keyboard("0{Enter}");
        expect(field().value).toBe("200");
      });
    });

    it("holds the value inside min and max", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo initial={5} min={0} max={10} onChange={onChange} />);
      await enter(user, "99");
      expect(onChange).toHaveBeenLastCalledWith(10);
      await user.click(field());
      await enter(user, "-5");
      expect(onChange).toHaveBeenLastCalledWith(0);
    });

    it("rounds to the step's precision", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo step={0.1} onChange={onChange} />);
      await enter(user, "1.23456");
      expect(onChange).toHaveBeenLastCalledWith(1.23);
    });

    it("understands a decimal comma, a typographic minus, a sign, a bare decimal point and trailing units", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      for (const [typed, expected] of [
        ["1,5", 1.5],
        ["−3", -3],
        ["+4", 4],
        [".5", 0.5],
        ["12px", 12],
        ["6.", 6],
      ] as const) {
        await enter(user, typed);
        expect(onChange).toHaveBeenLastCalledWith(expected);
      }
    });

    it("ignores text that is not a number and shows the old value again", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(<Demo onChange={onChange} onCommit={onCommit} />);
      await enter(user, "abc");
      expect(onChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(field().value).toBe("10");
      await enter(user, "");
      expect(field().value).toBe("10");
    });

    it("reports nothing when the typed number equals the current value", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(<Demo onChange={onChange} onCommit={onCommit} />);
      await enter(user, "10");
      expect(onChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("does nothing when focus leaves a field that was never edited", () => {
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      fireEvent.blur(field());
      expect(onChange).not.toHaveBeenCalled();
    });

    it("drops the edit on Escape without letting the key reach the dialog around it", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const around = vi.fn();
      render(
        <div onKeyDown={around}>
          <Demo onChange={onChange} />
        </div>,
      );
      await user.clear(field());
      await user.type(field(), "99");
      around.mockClear();
      await user.keyboard("{Escape}");
      expect(onChange).not.toHaveBeenCalled();
      expect(field().value).toBe("10");
      expect(around).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(field());
    });
  });

  describe("arrow keys", () => {
    it("step up and down, reporting every step", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(<Demo step={2} onChange={onChange} onCommit={onCommit} />);
      await user.click(field());
      await user.keyboard("{ArrowUp}");
      expect(field().value).toBe("12");
      await user.keyboard("{ArrowDown}{ArrowDown}");
      expect(field().value).toBe("8");
      expect(onChange).toHaveBeenLastCalledWith(8);
      expect(onCommit).toHaveBeenCalledTimes(3);
    });

    it("move ten times as far with Shift and a tenth as far with Alt", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(field());
      await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
      expect(field().value).toBe("20");
      await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
      expect(field().value).toBe("19.9");
    });

    it("start from the number being typed", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.clear(field());
      await user.type(field(), "30");
      await user.keyboard("{ArrowUp}");
      expect(field().value).toBe("31");
    });

    it("start from the current value when the typed text is not a number", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.clear(field());
      await user.type(field(), "x");
      await user.keyboard("{ArrowUp}");
      expect(field().value).toBe("11");
    });

    it("stop at the limits without reporting anything", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo initial={10} max={10} onChange={onChange} />);
      await user.click(field());
      await user.keyboard("{ArrowUp}");
      expect(onChange).not.toHaveBeenCalled();
      expect(field().value).toBe("10");
    });
  });

  describe("stepper buttons", () => {
    it("decrease and increase by the step", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(<Demo stepper step={2} onChange={onChange} onCommit={onCommit} />);
      await user.click(screen.getByRole("button", { name: "Increase Width" }));
      expect(onChange).toHaveBeenLastCalledWith(12);
      await user.click(screen.getByRole("button", { name: "Decrease Width" }));
      await user.click(screen.getByRole("button", { name: "Decrease Width" }));
      expect(onChange).toHaveBeenLastCalledWith(8);
      expect(onCommit).toHaveBeenCalledTimes(3);
    });

    it("jump ten steps with Shift held", () => {
      const onChange = vi.fn();
      render(<Demo stepper onChange={onChange} />);
      fireEvent.click(screen.getByRole("button", { name: "Increase Width" }), { shiftKey: true });
      expect(onChange).toHaveBeenLastCalledWith(20);
    });

    it("are switched off at the limits", () => {
      render(<Demo stepper initial={0} min={0} max={0} />);
      expect((screen.getByRole("button", { name: "Decrease Width" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Increase Width" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("do not steal focus from the field when pressed", () => {
      render(<Demo stepper />);
      expect(fireEvent.pointerDown(screen.getByRole("button", { name: "Increase Width" }))).toBe(false);
    });

    it("are named after the label when there is one", () => {
      render(<NumberField stepper label="Size" value={3} onChange={() => undefined} />);
      expect(screen.getByRole("button", { name: "Decrease Size" })).toBeTruthy();
    });

    it("are named generically when the field has no name", () => {
      render(<NumberField stepper value={3} onChange={() => undefined} />);
      expect(screen.getByRole("button", { name: "Decrease value" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Increase value" })).toBeTruthy();
    });
  });

  describe("scrubbing the prefix", () => {
    const handle = () => screen.getByText("W").closest(".cf-num__handle") as HTMLElement;

    it("changes the value as the pointer drags, and commits once at the end", () => {
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(<Demo prefix={<span>W</span>} onChange={onChange} onCommit={onCommit} />);
      fireEvent.pointerDown(handle(), { clientX: 100, button: 0, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 120, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(20);
      expect(document.documentElement.classList.contains("cf-scrubbing")).toBe(true);
      fireEvent.pointerMove(handle(), { clientX: 130, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(25);
      expect(onCommit).not.toHaveBeenCalled();
      fireEvent.pointerUp(handle(), { pointerId: 1 });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(25);
      expect(document.documentElement.classList.contains("cf-scrubbing")).toBe(false);
    });

    it("scrubs by the step, ten times faster with Shift and ten times slower with Alt", () => {
      const onChange = vi.fn();
      render(<Demo prefix={<span>W</span>} step={0.5} onChange={onChange} />);
      fireEvent.pointerDown(handle(), { clientX: 0, button: 0, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 20, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(15);
      fireEvent.pointerMove(handle(), { clientX: 40, pointerId: 1, shiftKey: true });
      expect(onChange).toHaveBeenLastCalledWith(65);
      fireEvent.pointerMove(handle(), { clientX: 60, pointerId: 1, altKey: true });
      expect(onChange).toHaveBeenLastCalledWith(65.5);
      fireEvent.pointerUp(handle(), { pointerId: 1 });
    });

    it("never goes beyond the limits", () => {
      const onChange = vi.fn();
      render(<Demo prefix={<span>W</span>} min={0} max={12} onChange={onChange} />);
      fireEvent.pointerDown(handle(), { clientX: 0, button: 0, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 100, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(12);
      fireEvent.pointerMove(handle(), { clientX: -300, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(0);
      fireEvent.pointerUp(handle(), { pointerId: 1 });
    });

    it("treats a press without a drag as a click that focuses the field", () => {
      const onChange = vi.fn();
      render(<Demo prefix={<span>W</span>} onChange={onChange} />);
      fireEvent.pointerDown(handle(), { clientX: 100, button: 0, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 101, pointerId: 1 });
      fireEvent.pointerUp(handle(), { pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(field());
    });

    it("makes the label the handle when there is no prefix", () => {
      const onChange = vi.fn();
      render(<NumberField label="Width" value={10} onChange={onChange} />);
      const label = screen.getByText("Width").closest(".cf-num__handle") as HTMLElement;
      fireEvent.pointerDown(label, { clientX: 0, button: 0, pointerId: 1 });
      fireEvent.pointerMove(label, { clientX: 10, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(15);
      fireEvent.pointerUp(label, { pointerId: 1 });
    });

    it("ignores moves and releases that do not belong to a scrub", () => {
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(<Demo prefix={<span>W</span>} onChange={onChange} onCommit={onCommit} />);
      fireEvent.pointerMove(handle(), { clientX: 50, pointerId: 1 });
      fireEvent.pointerUp(handle(), { pointerId: 1 });
      fireEvent.pointerCancel(handle(), { pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("ignores other mouse buttons", () => {
      const onChange = vi.fn();
      render(<Demo prefix={<span>W</span>} onChange={onChange} />);
      fireEvent.pointerDown(handle(), { clientX: 0, button: 2, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 50, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("can be switched off, and is off for a disabled field", () => {
      const onChange = vi.fn();
      const { unmount } = render(<Demo prefix={<span>W</span>} scrub={false} onChange={onChange} />);
      fireEvent.pointerDown(handle(), { clientX: 0, button: 0, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 50, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      unmount();
      render(<Demo prefix={<span>W</span>} disabled onChange={onChange} />);
      fireEvent.pointerDown(handle(), { clientX: 0, button: 0, pointerId: 1 });
      fireEvent.pointerMove(handle(), { clientX: 50, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("has no handle on a stepper field", () => {
      render(<Demo stepper prefix={<span>W</span>} />);
      expect(screen.queryByText("W")).toBeNull();
    });
  });
});
