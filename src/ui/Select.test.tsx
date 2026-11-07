import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select, type SelectOption, type SelectProps } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest" },
  { value: "off", label: "Unavailable", disabled: true },
  { value: "az", label: "A-Z" },
];

type DemoProps = { initial?: string | null; onChange?: (value: string) => void; options?: SelectOption[] } & Omit<Partial<SelectProps<string>>, "value" | "onChange" | "options">;

function Demo({ initial = "recent", onChange, options = OPTIONS, ...props }: DemoProps) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <Select<string>
        aria-label="Sort by"
        {...props}
        value={value}
        options={options}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
      <button>Elsewhere</button>
    </>
  );
}

const trigger = () => screen.getByRole("combobox", { name: "Sort by" });
const listbox = () => screen.getByRole("listbox");
const optionNamed = (name: string) => within(listbox()).getByRole("option", { name });
const optionLabels = () =>
  within(listbox())
    .getAllByRole("option")
    .map((el) => el.textContent);
const focused = () => document.activeElement?.textContent;

describe("<Select>", () => {
  describe("trigger", () => {
    it("shows the label of the selected option", () => {
      render(<Demo initial="oldest" />);
      expect(trigger().textContent).toBe("Oldest");
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
      expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
    });

    it("shows the placeholder when there is no value", () => {
      render(<Demo initial={null} placeholder="Pick one" />);
      expect(trigger().textContent).toBe("Pick one");
    });

    it("shows the default placeholder when no option matches the value", () => {
      render(<Demo initial="gone" />);
      expect(trigger().textContent).toBe("Select");
    });

    it("shows the icon of the selected option", () => {
      render(<Demo options={[{ value: "a", label: "Alpha", icon: <svg data-testid="alpha-icon" /> }]} initial="a" />);
      expect(within(trigger()).getByTestId("alpha-icon")).toBeTruthy();
    });

    it("takes its width, size, id and class from the props", () => {
      render(<Demo width={158} size="sm" id="sort" className="extra" />);
      expect(trigger().style.width).toBe("158px");
      expect(trigger().id).toBe("sort");
      expect(trigger().classList.contains("cf-select--sm")).toBe(true);
      expect(trigger().classList.contains("extra")).toBe(true);
    });

    it("cannot be opened while disabled", async () => {
      const user = userEvent.setup();
      render(<Demo disabled />);
      await user.click(trigger());
      expect(screen.queryByRole("listbox")).toBeNull();
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  describe("opening", () => {
    it("lists all options, marks the selected one and puts focus on it", async () => {
      const user = userEvent.setup();
      render(<Demo initial="oldest" />);
      await user.click(trigger());
      expect(optionLabels()).toEqual(["Most recent", "Oldest", "Unavailable", "A-Z"]);
      expect(optionNamed("Oldest").getAttribute("aria-selected")).toBe("true");
      expect(optionNamed("Most recent").getAttribute("aria-selected")).toBe("false");
      expect(optionNamed("Unavailable").getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(optionNamed("Oldest"));
      expect(trigger().getAttribute("aria-expanded")).toBe("true");
      expect(trigger().getAttribute("aria-controls")).toBe(listbox().id);
    });

    it("puts focus on the first enabled option when none is selected", async () => {
      const user = userEvent.setup();
      render(<Demo initial={null} options={[{ value: "x", label: "Off", disabled: true }, ...OPTIONS]} />);
      await user.click(trigger());
      expect(focused()).toBe("Most recent");
    });

    it("focuses the list itself when no option can be chosen", async () => {
      const user = userEvent.setup();
      render(<Demo initial={null} options={[{ value: "x", label: "Off", disabled: true }]} />);
      await user.click(trigger());
      expect(document.activeElement).toBe(listbox());
      await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
      expect(listbox()).toBeTruthy();
    });

    it("opens from the keyboard with the arrow keys", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      trigger().focus();
      await user.keyboard("{ArrowDown}");
      expect(listbox()).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();
      await user.keyboard("{ArrowUp}");
      expect(listbox()).toBeTruthy();
    });

    it("closes again when the trigger is clicked a second time", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(trigger());
      await user.click(trigger());
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  describe("choosing", () => {
    it("reports the clicked option, closes and returns focus to the trigger", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await user.click(trigger());
      await user.click(optionNamed("Oldest"));
      expect(onChange).toHaveBeenCalledWith("oldest");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(trigger().textContent).toBe("Oldest");
      expect(document.activeElement).toBe(trigger());
    });

    it("closes without a change event when the current value is chosen again", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await user.click(trigger());
      await user.click(optionNamed("Most recent"));
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("ignores a click on a disabled option", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await user.click(trigger());
      await user.click(optionNamed("Unavailable"));
      expect(onChange).not.toHaveBeenCalled();
      expect(listbox()).toBeTruthy();
    });

    it("works with numeric values", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      function Numbers() {
        const [value, setValue] = useState<number>(10);
        return (
          <Select<number>
            aria-label="Size"
            value={value}
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            options={[
              { value: 10, label: "Small" },
              { value: 20, label: "Large" },
            ]}
          />
        );
      }
      render(<Numbers />);
      await user.click(screen.getByRole("combobox", { name: "Size" }));
      await user.click(screen.getByRole("option", { name: "Large" }));
      expect(onChange).toHaveBeenCalledWith(20);
    });
  });

  describe("keyboard", () => {
    it("moves through the enabled options and wraps around", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(trigger());
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Oldest");
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("A-Z");
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Most recent");
      await user.keyboard("{ArrowUp}");
      expect(focused()).toBe("A-Z");
    });

    it("jumps to the first and last option with Home and End", async () => {
      const user = userEvent.setup();
      render(<Demo initial="oldest" />);
      await user.click(trigger());
      await user.keyboard("{End}");
      expect(focused()).toBe("A-Z");
      await user.keyboard("{Home}");
      expect(focused()).toBe("Most recent");
    });

    it("chooses the focused option with Enter or Space", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await user.click(trigger());
      await user.keyboard("{ArrowDown}{Enter}");
      expect(onChange).toHaveBeenLastCalledWith("oldest");
      expect(screen.queryByRole("listbox")).toBeNull();
      // back on the trigger: open again (the selected option gets focus), move one down and press Space
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Oldest");
      await user.keyboard("{ArrowDown} ");
      expect(onChange).toHaveBeenLastCalledWith("az");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("closes on Escape and returns focus to the trigger", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await user.click(trigger());
      await user.keyboard("{ArrowDown}{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(onChange).not.toHaveBeenCalled();
    });

    it("closes on Tab without moving focus along", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(trigger());
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "Tab" })).toBe(false);
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("closes on a press outside", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(trigger());
      await user.click(screen.getByRole("button", { name: "Elsewhere" }));
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("jumps to the option that starts with the typed letters", async () => {
      const user = userEvent.setup();
      let now = 1_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      render(<Demo />);
      await user.click(trigger());
      await user.keyboard("o");
      expect(focused()).toBe("Oldest");
      now += 1_000;
      await user.keyboard("a");
      expect(focused()).toBe("A-Z");
      now += 1_000;
      await user.keyboard("z");
      expect(focused()).toBe("A-Z");
    });

    it("uses textValue for type-ahead when the label is not text, and the value when there is none", async () => {
      const user = userEvent.setup();
      let now = 1_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      render(
        <Demo
          initial="a"
          options={[
            { value: "a", label: <b>Alpha</b>, textValue: "Alpha" },
            { value: "b", label: <i>Beta</i>, textValue: "Beta" },
            { value: "c", label: <i>Gamma</i> },
          ]}
        />,
      );
      await user.click(trigger());
      await user.keyboard("b");
      expect(focused()).toBe("Beta");
      now += 1_000;
      await user.keyboard("c");
      expect(focused()).toBe("Gamma");
    });

    it("ignores typed letters that match nothing, shortcuts and Enter with nothing focused", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      await user.click(trigger());
      await user.keyboard("x");
      expect(focused()).toBe("Most recent");
      expect(fireEvent.keyDown(document.activeElement as Element, { key: "o", ctrlKey: true })).toBe(true);
      expect(focused()).toBe("Most recent");
      (document.activeElement as HTMLElement).blur();
      fireEvent.keyDown(listbox(), { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("pointer", () => {
    it("moves focus to the option under the mouse", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(trigger());
      fireEvent.pointerEnter(optionNamed("A-Z"), { pointerType: "mouse" });
      expect(document.activeElement).toBe(optionNamed("A-Z"));
    });

    it("does not follow touch or a disabled option", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      await user.click(trigger());
      fireEvent.pointerEnter(optionNamed("A-Z"), { pointerType: "touch" });
      expect(document.activeElement).toBe(optionNamed("Most recent"));
      fireEvent.pointerEnter(optionNamed("Unavailable"), { pointerType: "mouse" });
      expect(document.activeElement).toBe(optionNamed("Most recent"));
    });
  });
});
