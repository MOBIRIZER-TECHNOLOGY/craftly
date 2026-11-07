import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { rect, stubRects } from "@/test/dashuiLayout";
import { Slider, sliderRatioToValue, sliderValueToRatio, type SliderProps } from "./Slider";

describe("sliderValueToRatio / sliderRatioToValue", () => {
  it("maps linearly between the ends", () => {
    expect(sliderValueToRatio(50, 0, 100)).toBe(0.5);
    expect(sliderValueToRatio(0, 0, 100)).toBe(0);
    expect(sliderValueToRatio(100, 0, 100)).toBe(1);
    expect(sliderRatioToValue(0.25, 0, 200)).toBe(50);
    expect(sliderRatioToValue(0.5, -10, 10)).toBe(0);
  });

  it("clamps values and ratios that are out of range", () => {
    expect(sliderValueToRatio(150, 0, 100)).toBe(1);
    expect(sliderValueToRatio(-5, 0, 100)).toBe(0);
    expect(sliderRatioToValue(-1, 10, 20)).toBe(10);
    expect(sliderRatioToValue(2, 10, 20)).toBe(20);
  });

  it("puts everything at the start of an empty range", () => {
    expect(sliderValueToRatio(5, 5, 5)).toBe(0);
  });

  it("copes with a reversed range", () => {
    expect(sliderValueToRatio(25, 100, 0)).toBe(0.75);
    expect(sliderValueToRatio(500, 100, 0)).toBeCloseTo(0, 10);
  });

  it("maps logarithmically when asked, so each step multiplies the value", () => {
    expect(sliderValueToRatio(10, 1, 100, "log")).toBeCloseTo(0.5, 10);
    expect(sliderRatioToValue(0.5, 1, 100, "log")).toBeCloseTo(10, 10);
    expect(sliderRatioToValue(0, 1, 100, "log")).toBeCloseTo(1, 10);
    expect(sliderRatioToValue(1, 1, 100, "log")).toBeCloseTo(100, 10);
  });

  it("falls back to a linear mapping for a log scale that includes zero", () => {
    expect(sliderValueToRatio(50, 0, 100, "log")).toBe(0.5);
    expect(sliderRatioToValue(0.5, 0, 100, "log")).toBe(50);
  });
});

type DemoProps = Partial<Omit<SliderProps, "value" | "onChange">> & { initial?: number; onChange?: (value: number) => void };

function Demo({ initial = 50, onChange, ...props }: DemoProps) {
  const [value, setValue] = useState(initial);
  return (
    <Slider
      min={0}
      max={100}
      aria-label="Zoom"
      {...props}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

const thumb = () => screen.getByRole("slider");
const control = () => thumb().closest(".cf-slider__control") as HTMLElement;
const now = () => Number(thumb().getAttribute("aria-valuenow"));

describe("<Slider>", () => {
  describe("semantics", () => {
    it("exposes its range, value and a text for the value", () => {
      render(<Demo initial={30} min={10} max={90} format={(v) => `${v}%`} />);
      expect(thumb().getAttribute("aria-valuemin")).toBe("10");
      expect(thumb().getAttribute("aria-valuemax")).toBe("90");
      expect(thumb().getAttribute("aria-valuenow")).toBe("30");
      expect(thumb().getAttribute("aria-valuetext")).toBe("30%");
      expect(thumb().getAttribute("aria-orientation")).toBe("horizontal");
    });

    it("is named by its visible label and shows the value on request", () => {
      render(<Demo label="Opacity" showValue initial={33.333} aria-label={undefined} />);
      expect(screen.getByRole("slider", { name: "Opacity" })).toBeTruthy();
      expect(screen.getByText("33.33")).toBeTruthy();
    });

    it("falls back to aria-label when there is no visible label", () => {
      render(<Demo />);
      expect(screen.getByRole("slider", { name: "Zoom" })).toBeTruthy();
      expect(screen.queryByText("Zoom")).toBeNull();
    });

    it("shows the value without a label", () => {
      render(<Demo showValue initial={12} />);
      expect(screen.getByText("12")).toBeTruthy();
    });

    it("is not focusable while disabled", () => {
      render(<Demo disabled />);
      expect(thumb().getAttribute("aria-disabled")).toBe("true");
      expect(thumb().tabIndex).toBe(-1);
    });
  });

  describe("keyboard", () => {
    it("steps with the arrow keys and reports each step", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      thumb().focus();
      await user.keyboard("{ArrowRight}");
      expect(now()).toBe(51);
      await user.keyboard("{ArrowUp}");
      expect(now()).toBe(52);
      await user.keyboard("{ArrowLeft}{ArrowDown}{ArrowDown}");
      expect(now()).toBe(49);
      expect(onChange).toHaveBeenLastCalledWith(49);
      expect(onChangeEnd).toHaveBeenCalledTimes(5);
      expect(onChangeEnd).toHaveBeenLastCalledWith(49);
    });

    it("moves ten times as far with Shift, PageUp and PageDown", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      thumb().focus();
      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
      expect(now()).toBe(60);
      await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
      expect(now()).toBe(50);
      await user.keyboard("{PageUp}");
      expect(now()).toBe(60);
      await user.keyboard("{PageDown}{PageDown}");
      expect(now()).toBe(40);
    });

    it("jumps to the ends with Home and End", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      thumb().focus();
      await user.keyboard("{End}");
      expect(now()).toBe(100);
      await user.keyboard("{Home}");
      expect(now()).toBe(0);
    });

    it("stops at the ends, still reporting the end of the edit", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo initial={100} onChange={onChange} onChangeEnd={onChangeEnd} />);
      thumb().focus();
      await user.keyboard("{ArrowRight}");
      expect(now()).toBe(100);
      expect(onChange).not.toHaveBeenCalled();
      expect(onChangeEnd).toHaveBeenCalledWith(100);
    });

    it("uses the step it was given", async () => {
      const user = userEvent.setup();
      render(<Demo step={5} />);
      thumb().focus();
      await user.keyboard("{ArrowRight}");
      expect(now()).toBe(55);
      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
      expect(now()).toBe(100);
    });

    it("takes hundredths on a small range", async () => {
      const user = userEvent.setup();
      render(<Demo min={0} max={1} initial={0.5} />);
      thumb().focus();
      await user.keyboard("{ArrowRight}");
      expect(now()).toBe(0.51);
      await user.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(now()).toBe(0.49);
    });

    it("copes with a step written in exponent form", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo min={0} max={0.000001} initial={0} onChange={onChange} />);
      thumb().focus();
      await user.keyboard("{ArrowRight}");
      expect(onChange).toHaveBeenCalledWith(1e-8);
    });

    it("moves a log slider by a fixed share of its track", async () => {
      const user = userEvent.setup();
      render(<Demo min={1} max={100} initial={10} scale="log" />);
      thumb().focus();
      await user.keyboard("{ArrowRight}");
      expect(now()).toBeCloseTo(10 ** (1 + 0.04), 3);
      await user.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(now()).toBeCloseTo(10 ** (1 - 0.04), 3);
    });

    it("ignores other keys and does nothing while disabled", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { unmount } = render(<Demo onChange={onChange} />);
      thumb().focus();
      expect(fireEvent.keyDown(thumb(), { key: "a" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
      unmount();
      render(<Demo onChange={onChange} disabled />);
      await user.keyboard("{ArrowRight}");
      expect(fireEvent.keyDown(thumb(), { key: "ArrowRight" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("pointer", () => {
    /** A 200 px wide track at the left edge, with the thumb centred on 100. */
    const withTrack = () =>
      stubRects((el) => {
        if (el.classList.contains("cf-slider__track")) return rect(0, 0, 200, 10);
        if (el.classList.contains("cf-slider__thumb")) return rect(98, 0, 4, 10);
        return null;
      });

    it("jumps to the pressed position, follows the drag and reports the end", () => {
      withTrack();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo initial={0} onChange={onChange} onChangeEnd={onChangeEnd} />);
      fireEvent.pointerDown(control(), { clientX: 100, button: 0, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(50);
      expect(control().closest(".cf-slider")?.classList.contains("is-dragging")).toBe(true);
      expect(document.activeElement).toBe(thumb());
      fireEvent.pointerMove(control(), { clientX: 150, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(75);
      fireEvent.pointerMove(control(), { clientX: 400, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(100);
      expect(onChangeEnd).not.toHaveBeenCalled();
      fireEvent.pointerUp(control(), { pointerId: 1 });
      expect(onChangeEnd).toHaveBeenCalledWith(100);
      expect(control().closest(".cf-slider")?.classList.contains("is-dragging")).toBe(false);
    });

    it("does not jump when the thumb itself is grabbed off-centre", () => {
      withTrack();
      const onChange = vi.fn();
      render(<Demo initial={50} onChange={onChange} />);
      fireEvent.pointerDown(thumb(), { clientX: 110, button: 0, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.pointerMove(control(), { clientX: 130, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(60);
    });

    it("also cancels a drag", () => {
      withTrack();
      const onChangeEnd = vi.fn();
      render(<Demo initial={0} onChangeEnd={onChangeEnd} />);
      fireEvent.pointerDown(control(), { clientX: 40, button: 0, pointerId: 1 });
      fireEvent.pointerCancel(control(), { pointerId: 1 });
      expect(onChangeEnd).toHaveBeenCalledWith(20);
    });

    it("snaps to the step", () => {
      withTrack();
      const onChange = vi.fn();
      render(<Demo min={0} max={1} step={0.1} initial={0} onChange={onChange} />);
      fireEvent.pointerDown(control(), { clientX: 66, button: 0, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith(0.3);
    });

    it("maps a position on a log slider logarithmically", () => {
      withTrack();
      const onChange = vi.fn();
      render(<Demo min={1} max={100} scale="log" initial={1} onChange={onChange} />);
      fireEvent.pointerDown(control(), { clientX: 100, button: 0, pointerId: 1 });
      expect(onChange.mock.calls[0][0]).toBeCloseTo(10, 6);
    });

    it("ignores moves and releases when no drag is running", () => {
      withTrack();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      fireEvent.pointerMove(control(), { clientX: 150, pointerId: 1 });
      fireEvent.pointerUp(control(), { pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      expect(onChangeEnd).not.toHaveBeenCalled();
    });

    it("ignores other mouse buttons and a disabled slider", () => {
      withTrack();
      const onChange = vi.fn();
      const { unmount } = render(<Demo initial={0} onChange={onChange} />);
      fireEvent.pointerDown(control(), { clientX: 100, button: 2, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      unmount();
      render(<Demo initial={0} onChange={onChange} disabled />);
      fireEvent.pointerDown(control(), { clientX: 100, button: 0, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps the value when the track has no width", () => {
      const onChange = vi.fn();
      render(<Demo initial={20} onChange={onChange} />);
      fireEvent.pointerDown(control(), { clientX: 100, button: 0, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      expect(now()).toBe(20);
    });
  });
});
