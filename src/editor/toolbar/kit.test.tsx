import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { IconBold } from "@/ui";
import { resetEditor } from "@/test/helpers";
import { MenuButton, PopoverButton, SliderField, TBIcon, TBText, keepFocus, toggleContext, useContextActive } from "./kit";

beforeEach(() => {
  resetEditor();
  document.getSelection()?.removeAllRanges();
});

describe("<TBIcon>", () => {
  it("is a named button that does not take the focus away from the text editor on mouse press", () => {
    render(<TBIcon label="Bold" icon={<IconBold />} />);
    const button = screen.getByRole("button", { name: "Bold" });
    // a cancelled mousedown keeps the focus (and the text selection) where it is
    expect(fireEvent.mouseDown(button)).toBe(false);
  });

  it("lets the owner replace the mousedown behaviour", () => {
    const onMouseDown = vi.fn();
    render(<TBIcon label="Bold" icon={<IconBold />} onMouseDown={onMouseDown} />);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Bold" }))).toBe(true);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it("shows on, off and mixed states", () => {
    const { rerender } = render(<TBIcon label="Bold" icon={<IconBold />} active />);
    const state = () => screen.getByRole("button", { name: "Bold" });
    expect(state().getAttribute("aria-pressed")).toBe("true");
    expect(state().classList.contains("is-active")).toBe(true);
    rerender(<TBIcon label="Bold" icon={<IconBold />} active={false} />);
    expect(state().getAttribute("aria-pressed")).toBe("false");
    rerender(<TBIcon label="Bold" icon={<IconBold />} mixed active />);
    expect(state().getAttribute("aria-pressed")).toBe("mixed");
    expect(state().classList.contains("is-mixed")).toBe(true);
    expect(state().classList.contains("is-active")).toBe(false);
  });

  it("announces a popup button as expanded instead of pressed", () => {
    const { rerender } = render(<TBIcon label="Border" icon={<IconBold />} popup="dialog" active />);
    const state = () => screen.getByRole("button", { name: "Border" });
    expect(state().getAttribute("aria-haspopup")).toBe("dialog");
    expect(state().getAttribute("aria-expanded")).toBe("true");
    expect(state().hasAttribute("aria-pressed")).toBe(false);
    rerender(<TBIcon label="Border" icon={<IconBold />} popup="menu" />);
    expect(state().getAttribute("aria-haspopup")).toBe("menu");
    expect(state().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows its tooltip on keyboard focus, with the shortcut", async () => {
    const user = userEvent.setup();
    render(<TBIcon label="Bold" tip="Make it bold" shortcut="Ctrl+B" icon={<IconBold />} />);
    await user.tab();
    expect(await screen.findByRole("tooltip")).toBeTruthy();
    expect(screen.getByRole("tooltip").textContent).toContain("Make it bold");
    expect(screen.getByRole("tooltip").textContent).toContain("Ctrl+B");
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-keyshortcuts")).toBeTruthy();
  });
});

describe("<TBText>", () => {
  it("is a text button named by its text, with the state of a toggle when it has one", () => {
    const { rerender } = render(<TBText>Effects</TBText>);
    const button = () => screen.getByRole("button", { name: "Effects" });
    expect(button().hasAttribute("aria-pressed")).toBe(false);
    rerender(<TBText active>Effects</TBText>);
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(button().classList.contains("is-active")).toBe(true);
    rerender(<TBText active={false}>Effects</TBText>);
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("names a button by its label when the text says something else, and announces shortcuts and popups", () => {
    render(
      <TBText label="Align" popup="menu" active shortcut="Ctrl+G">
        <span>icon only</span>
      </TBText>,
    );
    const button = screen.getByRole("button", { name: "Align" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Ctrl+G");
  });

  it("keeps the focus where it is on mouse press unless told otherwise", () => {
    const onMouseDown = vi.fn();
    const { rerender } = render(<TBText>Position</TBText>);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Position" }))).toBe(false);
    rerender(<TBText onMouseDown={onMouseDown}>Position</TBText>);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Position" }))).toBe(true);
    expect(keepFocus).toBeTypeOf("function");
  });
});

describe("<SliderField>", () => {
  it("shows a slider and a number box for the same value and reports either", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SliderField label="Weight" value={10} min={0} max={40} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Weight" });
    const number = screen.getByRole("spinbutton", { name: "Weight value" }) as HTMLInputElement;
    expect(number.value).toBe("10");
    expect(slider.getAttribute("aria-valuenow")).toBe("10");
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(11);
    await user.click(number);
    await user.clear(number);
    await user.type(number, "25{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(25);
  });

  it("keeps the slider inside its range and leaves the number blank when the values differ", () => {
    const { rerender } = render(<SliderField label="Weight" value={500} min={0} max={40} onChange={() => undefined} />);
    expect(screen.getByRole("slider", { name: "Weight" }).getAttribute("aria-valuenow")).toBe("40");
    rerender(<SliderField label="Weight" value={Number.NaN} min={5} max={40} onChange={() => undefined} />);
    expect(screen.getByRole("slider", { name: "Weight" }).getAttribute("aria-valuenow")).toBe("5");
    rerender(<SliderField label="Weight" value={12} mixed min={0} max={40} onChange={() => undefined} />);
    expect((screen.getByRole("spinbutton", { name: "Weight value" }) as HTMLInputElement).value).toBe("");
  });

  it("can be disabled", () => {
    render(<SliderField label="Weight" value={10} min={0} max={40} onChange={() => undefined} disabled />);
    expect(screen.getByRole("slider", { name: "Weight" }).getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByRole("spinbutton", { name: "Weight value" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("steps the number box in its own units", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SliderField label="Line spacing" value={1.25} min={0.8} max={3} step={0.05} numberStep={0.1} onChange={onChange} />);
    const number = screen.getByRole("spinbutton", { name: "Line spacing value" });
    await user.click(number);
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(1.35);
  });
});

describe("<PopoverButton>", () => {
  it("opens its panel, passes a close function to it and closes on a second click or Escape", async () => {
    const user = userEvent.setup();
    render(
      <PopoverButton label="Settings" icon={<IconBold />}>
        {({ close }) => <button onClick={close}>Done</button>}
      </PopoverButton>,
    );
    const trigger = screen.getByRole("button", { name: "Settings" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });

  it("looks 'on' while closed when told so", () => {
    render(
      <PopoverButton label="Border" icon={<IconBold />} active>
        {() => <p>content</p>}
      </PopoverButton>,
    );
    expect(screen.getByRole("button", { name: "Border" }).classList.contains("is-active")).toBe(true);
  });

  it("selects the same characters of the text editor again when it closes", async () => {
    const user = userEvent.setup();
    const root = document.createElement("div");
    root.setAttribute("data-cf-text-editor", "");
    root.setAttribute("contenteditable", "true");
    root.tabIndex = 0;
    root.textContent = "Hello big world";
    document.body.appendChild(root);
    const text = root.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(text, 6, text, 9);
    render(
      <PopoverButton label="Spacing" icon={<IconBold />}>
        {() => <input aria-label="Amount" />}
      </PopoverButton>,
    );
    await user.click(screen.getByRole("button", { name: "Spacing" }));
    // typing into the field of the panel takes the selection away from the editor
    document.getSelection()!.removeAllRanges();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(root);
    expect(document.getSelection()!.toString()).toBe("big");
  });

  it("leaves the selection alone when the focus went somewhere else by the time it closes", async () => {
    const user = userEvent.setup();
    const root = document.createElement("div");
    root.setAttribute("data-cf-text-editor", "");
    root.setAttribute("contenteditable", "true");
    root.tabIndex = 0;
    root.textContent = "Hello big world";
    const other = document.createElement("input");
    document.body.append(root, other);
    const text = root.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(text, 6, text, 9);
    render(
      <PopoverButton label="Spacing" icon={<IconBold />}>
        {() => <p>content</p>}
      </PopoverButton>,
    );
    other.focus();
    await user.click(screen.getByRole("button", { name: "Spacing" }));
    document.getSelection()!.removeAllRanges();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(other);
    expect(document.getSelection()!.toString()).toBe("");
  });

  it("does not touch the selection when no text editor is open", async () => {
    const user = userEvent.setup();
    render(
      <PopoverButton label="Spacing" icon={<IconBold />}>
        {() => <p>content</p>}
      </PopoverButton>,
    );
    await user.click(screen.getByRole("button", { name: "Spacing" }));
    await user.keyboard("{Escape}");
    expect(document.getSelection()!.toString()).toBe("");
    expect(document.activeElement).toBe(document.body);
  });
});

describe("<MenuButton>", () => {
  it("opens a menu of items and runs the chosen one", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MenuButton label="Flip" icon={<IconBold />} items={[{ id: "h", label: "Horizontal", onSelect }]} />);
    await user.click(screen.getByRole("button", { name: "Flip" }));
    await user.click(screen.getByRole("menuitem", { name: "Horizontal" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("asks for fresh items every time the menu opens", async () => {
    const user = userEvent.setup();
    const items = vi.fn(() => [{ id: "x", label: `Opened ${items.mock.calls.length}` }]);
    render(<MenuButton label="More" icon={<IconBold />} items={items} />);
    expect(items).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Opened 1" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /^Opened \d$/ })).toBeTruthy();
    expect(items.mock.calls.length).toBeGreaterThan(1);
  });

  it("can be a text button with a label and a chevron, and be disabled", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MenuButton label="Align" text="Align" icon={<IconBold />} iconRight={<span data-testid="chevron" />} items={[{ id: "l", label: "Left" }]} />);
    const button = screen.getByRole("button", { name: "Align" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(within(button).getByTestId("chevron")).toBeTruthy();
    await user.click(button);
    expect(screen.getByRole("menuitem", { name: "Left" })).toBeTruthy();
    await user.keyboard("{Escape}");
    rerender(<MenuButton label="Align" text="Align" icon={<IconBold />} items={[{ id: "l", label: "Left" }]} disabled />);
    await user.click(screen.getByRole("button", { name: "Align" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("context panel helpers", () => {
  function Probe({ panel }: { panel: Parameters<typeof useContextActive>[0] }) {
    return <output data-testid="active">{String(useContextActive(panel))}</output>;
  }
  const active = () => screen.getByTestId("active").textContent;

  it("toggles a panel open and closed", () => {
    render(<Probe panel={{ kind: "effects" }} />);
    expect(active()).toBe("false");
    act(() => toggleContext({ kind: "effects" }));
    expect(useEditor.getState().context).toEqual({ kind: "effects" });
    expect(active()).toBe("true");
    act(() => toggleContext({ kind: "effects" }));
    expect(useEditor.getState().context).toBeNull();
    expect(active()).toBe("false");
  });

  it("replaces a different panel instead of closing", () => {
    act(() => toggleContext({ kind: "effects" }));
    act(() => toggleContext({ kind: "font" }));
    expect(useEditor.getState().context).toEqual({ kind: "font" });
  });

  it("tells colour panels apart by target and key, and animate panels by tab", () => {
    render(<Probe panel={{ kind: "color", target: "graphic", key: "#ff0000" }} />);
    act(() => toggleContext({ kind: "color", target: "graphic", key: "#00ff00" }));
    expect(active()).toBe("false");
    act(() => toggleContext({ kind: "color", target: "graphic", key: "#ff0000" }));
    expect(active()).toBe("true");
    act(() => toggleContext({ kind: "color", target: "fill" }));
    expect(active()).toBe("false");
    // no key and an empty key are the same panel
    act(() => useEditor.getState().actions.openContext({ kind: "color", target: "fill" }));
    expect(useEditor.getState().context).toEqual({ kind: "color", target: "fill" });
    act(() => toggleContext({ kind: "color", target: "fill" }));
    expect(useEditor.getState().context).toBeNull();
    act(() => toggleContext({ kind: "animate", tab: "page" }));
    act(() => toggleContext({ kind: "animate", tab: "element" }));
    expect(useEditor.getState().context).toEqual({ kind: "animate", tab: "element" });
    act(() => toggleContext({ kind: "position", tab: "arrange" }));
    act(() => toggleContext({ kind: "position", tab: "layers" }));
    expect(useEditor.getState().context).toBeNull();
  });
});
