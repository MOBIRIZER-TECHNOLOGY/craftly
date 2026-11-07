import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rect, stubRects } from "@/test/dashuiLayout";
import { ColorPicker, type ColorPickerProps } from "./ColorPicker";
import { ColorSwatch } from "./ColorSwatch";

type DemoProps = Partial<Omit<ColorPickerProps, "value">> & { initial?: string };

function Demo({ initial = "#ff0000", onChange, ...props }: DemoProps) {
  const [value, setValue] = useState(initial);
  return (
    <ColorPicker
      {...props}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

const hexField = () => screen.getByRole("textbox", { name: "Hex colour" }) as HTMLInputElement;
const squareEl = () => screen.getByRole("slider", { name: "Saturation and brightness" });
const hueEl = () => screen.getByRole("slider", { name: "Hue" });
const opacityEl = () => screen.getByRole("slider", { name: "Opacity" });
const hueValue = () => Number(hueEl().getAttribute("aria-valuenow"));

/** Boxes for the three drag areas: a 200 x 100 square, a 360 px hue bar and a 200 px opacity bar. */
function stubBars() {
  return stubRects((el) => {
    if (el.classList.contains("cf-cp__sv")) return rect(0, 0, 200, 100);
    if (el.classList.contains("cf-cp__bar--hue")) return rect(0, 0, 360, 10);
    if (el.classList.contains("cf-cp__bar--alpha")) return rect(0, 0, 200, 10);
    return null;
  });
}

async function typeHex(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.clear(hexField());
  await user.type(hexField(), text);
}

afterEach(() => {
  delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
});

describe("<ColorPicker>", () => {
  describe("display", () => {
    it("shows the colour as upper-case hex digits and describes the square", () => {
      render(<Demo initial="#ff8800" />);
      expect(hexField().value).toBe("FF8800");
      expect(squareEl().getAttribute("aria-valuenow")).toBe("100");
      expect(squareEl().getAttribute("aria-valuetext")).toBe("Saturation 100%, brightness 100%");
      expect(hueValue()).toBe(32);
    });

    it("starts from black when the colour cannot be read", () => {
      render(<Demo initial="not a colour" />);
      expect(hexField().value).toBe("000000");
    });

    it("has an opacity slider and field only when asked for", () => {
      const { unmount } = render(<Demo />);
      expect(screen.queryByRole("slider", { name: "Opacity" })).toBeNull();
      expect(screen.queryByRole("spinbutton", { name: "Opacity" })).toBeNull();
      unmount();
      render(<Demo showAlpha initial="rgba(255,0,0,0.5)" />);
      expect(opacityEl().getAttribute("aria-valuenow")).toBe("50");
      expect(opacityEl().getAttribute("aria-valuetext")).toBe("50%");
      expect((screen.getByRole("spinbutton", { name: "Opacity" }) as HTMLInputElement).value).toBe("50");
    });

    it("keeps the hue when the colour is set to a grey from outside", () => {
      const { rerender } = render(<ColorPicker value="#0000ff" onChange={() => undefined} />);
      expect(hueValue()).toBe(240);
      rerender(<ColorPicker value="#808080" onChange={() => undefined} />);
      expect(hexField().value).toBe("808080");
      expect(hueValue()).toBe(240);
      rerender(<ColorPicker value="#000000" onChange={() => undefined} />);
      expect(hueValue()).toBe(240);
      rerender(<ColorPicker value="#00ff00" onChange={() => undefined} />);
      expect(hueValue()).toBe(120);
    });

    it("keeps the saturation when the colour is set to black from outside", () => {
      const { rerender } = render(<ColorPicker value="#ff0000" onChange={() => undefined} />);
      rerender(<ColorPicker value="#000000" onChange={() => undefined} />);
      expect(squareEl().getAttribute("aria-valuenow")).toBe("100");
    });

    it("ignores an outside value it cannot read", () => {
      const { rerender } = render(<ColorPicker value="#ff0000" onChange={() => undefined} />);
      rerender(<ColorPicker value="nonsense" onChange={() => undefined} />);
      expect(hexField().value).toBe("FF0000");
    });

    it("drops the opacity of an outside colour while opacity is not shown", () => {
      const onChange = vi.fn();
      const { rerender } = render(<ColorPicker value="#ff0000" onChange={onChange} />);
      rerender(<ColorPicker value="rgba(0,0,255,0.5)" onChange={onChange} />);
      expect(hexField().value).toBe("0000FF");
      fireEvent.keyDown(squareEl(), { key: "ArrowLeft" });
      expect(onChange.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe("hex field", () => {
    it("applies a complete six-digit colour as soon as it is typed", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      await typeHex(user, "00ff00");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("#00ff00");
      expect(onChangeEnd).toHaveBeenCalledWith("#00ff00");
      expect(hexField().value).toBe("00FF00");
      expect(hueValue()).toBe(120);
    });

    it("accepts a leading hash", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await typeHex(user, "#123456");
      expect(onChange).toHaveBeenLastCalledWith("#123456");
    });

    it("expands a three-digit colour when the field is left", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await typeHex(user, "0f0");
      expect(onChange).not.toHaveBeenCalled();
      await user.tab();
      expect(onChange).toHaveBeenCalledWith("#00ff00");
    });

    it("applies the colour on Enter", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await typeHex(user, "abc");
      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenCalledWith("#aabbcc");
      expect(document.activeElement).not.toBe(hexField());
    });

    it("puts the old colour back when the text is not a colour", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await typeHex(user, "zzz");
      await user.tab();
      expect(onChange).not.toHaveBeenCalled();
      expect(hexField().value).toBe("FF0000");
      await typeHex(user, "12");
      await user.tab();
      expect(hexField().value).toBe("FF0000");
    });

    it("reports nothing when the typed colour is the one already shown", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await typeHex(user, "ff0000");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("drops the edit on Escape, even when the text is a valid colour, without letting the key reach the popover around it", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const around = vi.fn();
      render(
        <div onKeyDown={around}>
          <Demo onChange={onChange} />
        </div>,
      );
      await user.clear(hexField());
      // four digits are a complete #rgba colour: leaving the field would apply them, Escape must not
      await user.type(hexField(), "00ff");
      around.mockClear();
      await user.keyboard("{Escape}");
      expect(around).not.toHaveBeenCalled();
      expect(hexField().value).toBe("FF0000");
      expect(onChange).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(hexField());
      // the next edit starts normally
      await typeHex(user, "0f0");
      await user.tab();
      expect(onChange).toHaveBeenCalledWith("#00ff00");
    });

    it("keeps the opacity when the typed colour has none, and reads it when opacity is shown", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo showAlpha initial="rgba(255,0,0,0.5)" onChange={onChange} />);
      await typeHex(user, "00ff00");
      expect(onChange).toHaveBeenLastCalledWith("rgba(0,255,0,0.5)");
      await typeHex(user, "0000ff80");
      await user.tab();
      expect(onChange).toHaveBeenLastCalledWith("rgba(0,0,255,0.5)");
      await typeHex(user, "ff0000ff");
      await user.tab();
      expect(onChange).toHaveBeenLastCalledWith("#ff0000");
    });

    it("ignores the opacity digits of a typed colour while opacity is not shown", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await typeHex(user, "00ff0080");
      await user.tab();
      expect(onChange).toHaveBeenLastCalledWith("#00ff00");
    });

    it("keeps hue and saturation when a grey or black is typed", async () => {
      const user = userEvent.setup();
      render(<Demo initial="#0000ff" />);
      await typeHex(user, "808080");
      expect(hueValue()).toBe(240);
      await typeHex(user, "000000");
      expect(hueValue()).toBe(240);
      expect(squareEl().getAttribute("aria-valuenow")).toBe("0");
    });
  });

  describe("saturation and brightness square", () => {
    it("picks the colour under a press and follows the drag", () => {
      stubBars();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      fireEvent.pointerDown(squareEl(), { clientX: 100, clientY: 50, button: 0, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith("#804040");
      expect(document.activeElement).toBe(squareEl());
      fireEvent.pointerMove(squareEl(), { clientX: 0, clientY: 0, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith("#ffffff");
      fireEvent.pointerMove(squareEl(), { clientX: 300, clientY: 500, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith("#000000");
      expect(onChangeEnd).not.toHaveBeenCalled();
      fireEvent.pointerUp(squareEl(), { pointerId: 1 });
      expect(onChangeEnd).toHaveBeenCalledWith("#000000");
    });

    it("does nothing for moves and releases outside a drag, for other buttons and cancelled drags", () => {
      stubBars();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      fireEvent.pointerMove(squareEl(), { clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(squareEl(), { pointerId: 1 });
      fireEvent.pointerDown(squareEl(), { clientX: 10, clientY: 10, button: 2, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.pointerDown(squareEl(), { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
      onChange.mockClear();
      fireEvent.pointerCancel(squareEl(), { pointerId: 1 });
      fireEvent.pointerMove(squareEl(), { clientX: 50, clientY: 50, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      expect(onChangeEnd).not.toHaveBeenCalled();
    });

    it("ignores a press when the square has no size", () => {
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      fireEvent.pointerDown(squareEl(), { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("moves with the arrow keys, ten times further with Shift", () => {
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo initial="#ff0000" onChange={onChange} onChangeEnd={onChangeEnd} />);
      fireEvent.keyDown(squareEl(), { key: "ArrowDown" });
      expect(onChange).toHaveBeenLastCalledWith("#fc0000");
      fireEvent.keyDown(squareEl(), { key: "ArrowUp", shiftKey: true });
      expect(onChange).toHaveBeenLastCalledWith("#ff0000");
      fireEvent.keyDown(squareEl(), { key: "ArrowLeft", shiftKey: true });
      expect(squareEl().getAttribute("aria-valuenow")).toBe("90");
      fireEvent.keyDown(squareEl(), { key: "ArrowRight", shiftKey: true });
      expect(squareEl().getAttribute("aria-valuenow")).toBe("100");
      expect(onChangeEnd).toHaveBeenCalledTimes(4);
    });

    it("stays inside the square at its edges and ignores other keys", () => {
      const onChange = vi.fn();
      render(<Demo initial="#ff0000" onChange={onChange} />);
      fireEvent.keyDown(squareEl(), { key: "ArrowRight" });
      fireEvent.keyDown(squareEl(), { key: "ArrowUp" });
      expect(squareEl().getAttribute("aria-valuenow")).toBe("100");
      expect(fireEvent.keyDown(squareEl(), { key: "a" })).toBe(true);
    });
  });

  describe("hue and opacity bars", () => {
    it("picks the hue under a press and follows the drag", () => {
      stubBars();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      const bar = hueEl().closest(".cf-cp__bar") as HTMLElement;
      fireEvent.pointerDown(bar, { clientX: 100, button: 0, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith("#55ff00");
      expect(document.activeElement).toBe(hueEl());
      fireEvent.pointerMove(bar, { clientX: 240, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith("#0000ff");
      fireEvent.pointerUp(bar, { pointerId: 1 });
      expect(onChangeEnd).toHaveBeenCalledWith("#0000ff");
    });

    it("stops just short of 360 degrees at the right end of the bar, where the colour is red again", () => {
      stubBars();
      render(<Demo initial="#00ff00" />);
      const bar = hueEl().closest(".cf-cp__bar") as HTMLElement;
      fireEvent.pointerDown(bar, { clientX: 5000, button: 0, pointerId: 1 });
      expect(hueValue()).toBe(360);
      expect(hexField().value).toBe("FF0000");
      fireEvent.pointerDown(bar, { clientX: -50, button: 0, pointerId: 1 });
      expect(hueValue()).toBe(0);
    });

    it("picks the opacity under a press", () => {
      stubBars();
      const onChange = vi.fn();
      render(<Demo showAlpha onChange={onChange} />);
      const bar = opacityEl().closest(".cf-cp__bar") as HTMLElement;
      fireEvent.pointerDown(bar, { clientX: 100, button: 0, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith("rgba(255,0,0,0.5)");
      fireEvent.pointerMove(bar, { clientX: 200, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith("#ff0000");
    });

    it("ignores moves, releases and other buttons outside a drag, and a bar without size", () => {
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      const bar = hueEl().closest(".cf-cp__bar") as HTMLElement;
      fireEvent.pointerMove(bar, { clientX: 100, pointerId: 1 });
      fireEvent.pointerUp(bar, { pointerId: 1 });
      fireEvent.pointerDown(bar, { clientX: 100, button: 2, pointerId: 1 });
      fireEvent.pointerDown(bar, { clientX: 100, button: 0, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.pointerCancel(bar, { pointerId: 1 });
      fireEvent.pointerUp(bar, { pointerId: 1 });
      expect(onChangeEnd).not.toHaveBeenCalled();
    });

    it("moves the hue with the arrow keys and holds it between 0 and 359.99", () => {
      const onChangeEnd = vi.fn();
      render(<Demo onChangeEnd={onChangeEnd} />);
      fireEvent.keyDown(hueEl(), { key: "ArrowRight" });
      expect(hueValue()).toBe(1);
      fireEvent.keyDown(hueEl(), { key: "ArrowUp", shiftKey: true });
      expect(hueValue()).toBe(11);
      fireEvent.keyDown(hueEl(), { key: "ArrowDown", shiftKey: true });
      fireEvent.keyDown(hueEl(), { key: "ArrowLeft", shiftKey: true });
      expect(hueValue()).toBe(0);
      fireEvent.keyDown(hueEl(), { key: "ArrowLeft" });
      expect(hueValue()).toBe(0);
      expect(onChangeEnd).toHaveBeenCalledTimes(5);
      expect(fireEvent.keyDown(hueEl(), { key: "a" })).toBe(true);
    });

    it("moves the opacity in percent with the arrow keys", () => {
      const onChange = vi.fn();
      render(<Demo showAlpha onChange={onChange} />);
      fireEvent.keyDown(opacityEl(), { key: "ArrowLeft" });
      expect(opacityEl().getAttribute("aria-valuenow")).toBe("99");
      expect(onChange).toHaveBeenLastCalledWith("rgba(255,0,0,0.99)");
      fireEvent.keyDown(opacityEl(), { key: "ArrowDown", shiftKey: true });
      expect(opacityEl().getAttribute("aria-valuenow")).toBe("89");
      fireEvent.keyDown(opacityEl(), { key: "ArrowRight", shiftKey: true });
      fireEvent.keyDown(opacityEl(), { key: "ArrowRight", shiftKey: true });
      expect(opacityEl().getAttribute("aria-valuenow")).toBe("100");
    });

    it("sets the opacity from the number field", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo showAlpha onChange={onChange} onChangeEnd={onChangeEnd} />);
      const field = screen.getByRole("spinbutton", { name: "Opacity" });
      await user.clear(field);
      await user.type(field, "25{Enter}");
      expect(onChange).toHaveBeenLastCalledWith("rgba(255,0,0,0.25)");
      expect(onChangeEnd).toHaveBeenLastCalledWith("rgba(255,0,0,0.25)");
      expect(opacityEl().getAttribute("aria-valuenow")).toBe("25");
    });
  });

  describe("pick from screen", () => {
    it("is not offered where the browser has no eyedropper", () => {
      render(<Demo />);
      expect(screen.queryByRole("button", { name: "Pick colour from screen" })).toBeNull();
    });

    it("takes the colour the user clicks on the screen", async () => {
      const user = userEvent.setup();
      (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
        open() {
          return Promise.resolve({ sRGBHex: "#336699" });
        }
      };
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      render(<Demo onChange={onChange} onChangeEnd={onChangeEnd} />);
      await user.click(screen.getByRole("button", { name: "Pick colour from screen" }));
      expect(onChange).toHaveBeenCalledWith("#336699");
      expect(onChangeEnd).toHaveBeenCalledWith("#336699");
      expect(hexField().value).toBe("336699");
    });

    it("keeps the opacity of the current colour", async () => {
      const user = userEvent.setup();
      (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
        open() {
          return Promise.resolve({ sRGBHex: "#336699" });
        }
      };
      const onChange = vi.fn();
      render(<Demo showAlpha initial="rgba(255,0,0,0.5)" onChange={onChange} />);
      await user.click(screen.getByRole("button", { name: "Pick colour from screen" }));
      expect(onChange).toHaveBeenLastCalledWith("rgba(51,102,153,0.5)");
    });

    it("does nothing when the user cancels or the answer is not a colour", async () => {
      const user = userEvent.setup();
      const answers: Array<() => Promise<{ sRGBHex: string }>> = [() => Promise.reject(new Error("cancelled")), () => Promise.resolve({ sRGBHex: "nonsense" })];
      (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
        open() {
          return (answers.shift() as () => Promise<{ sRGBHex: string }>)();
        }
      };
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      const button = screen.getByRole("button", { name: "Pick colour from screen" });
      await user.click(button);
      await user.click(button);
      await act(async () => void (await Promise.resolve()));
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

describe("<ColorSwatch>", () => {
  it("is a labelled image showing the colour", () => {
    render(<ColorSwatch color="#ff8800" />);
    const swatch = screen.getByRole("img", { name: "#ff8800" });
    expect(swatch.style.getPropertyValue("--cf-swatch")).toBe("#ff8800");
    expect(swatch.style.width).toBe("28px");
    expect(swatch.classList.contains("cf-swatch--circle")).toBe(true);
  });

  it("takes its size, shape and name from the props", () => {
    render(<ColorSwatch color="#112233" size={56} shape="square" title="Brand blue" />);
    const swatch = screen.getByRole("img", { name: "Brand blue" });
    expect(swatch.style.height).toBe("56px");
    expect(swatch.classList.contains("cf-swatch--square")).toBe(true);
    expect(swatch.getAttribute("title")).toBe("Brand blue");
  });

  it("becomes a toggle button when it has a click handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<ColorSwatch color="#ff0000" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "#ff0000" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<ColorSwatch color="#ff0000" onClick={onClick} selected title="Red" />);
    const selected = screen.getByRole("button", { name: "Red" });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.classList.contains("is-selected")).toBe(true);
  });
});
