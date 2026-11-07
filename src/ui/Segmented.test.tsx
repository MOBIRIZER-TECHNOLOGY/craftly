import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Segmented, type SegmentedOption } from "./Segmented";

const OPTIONS: SegmentedOption[] = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List", icon: <svg data-testid="list-icon" /> },
  { value: "off", label: "Off", disabled: true },
  { value: "compact", icon: <svg data-testid="compact-icon" />, title: "Compact view" },
];

type DemoProps = { initial?: string; onChange?: (value: string) => void; options?: SegmentedOption[]; size?: "sm" | "md"; fullWidth?: boolean; className?: string };

function Demo({ initial = "grid", onChange, options = OPTIONS, ...props }: DemoProps) {
  const [value, setValue] = useState(initial);
  return (
    <Segmented
      aria-label="View"
      {...props}
      options={options}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

const option = (name: string) => screen.getByRole("radio", { name });
const checkedOption = () => screen.getAllByRole("radio").find((el) => el.getAttribute("aria-checked") === "true");

describe("<Segmented>", () => {
  it("is a radio group with the chosen option checked and the others out of the tab order", () => {
    render(<Demo initial="list" />);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeTruthy();
    expect(checkedOption()).toBe(option("List"));
    expect(option("List").tabIndex).toBe(0);
    expect(option("Grid").tabIndex).toBe(-1);
    expect((option("Off") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows icons, and names an icon-only option after its title", () => {
    render(<Demo />);
    expect(option("List").querySelector("[data-testid='list-icon']")).toBeTruthy();
    const compact = option("Compact view");
    expect(compact.querySelector("[data-testid='compact-icon']")).toBeTruthy();
    expect(compact.classList.contains("is-icon-only")).toBe(true);
    expect(compact.querySelector(".cf-seg__label")).toBeNull();
  });

  it("reports a clicked option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    await user.click(option("List"));
    expect(onChange).toHaveBeenCalledWith("list");
    expect(checkedOption()).toBe(option("List"));
  });

  it("does not choose a disabled option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    await user.click(option("Off"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("works with numeric values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Numbers() {
      const [value, setValue] = useState<number>(1);
      return (
        <Segmented<number>
          aria-label="Columns"
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          options={[
            { value: 1, label: "One" },
            { value: 2, label: "Two" },
          ]}
        />
      );
    }
    render(<Numbers />);
    await user.click(screen.getByRole("radio", { name: "Two" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("takes its look from the size and width props", () => {
    render(<Demo size="sm" fullWidth className="extra" />);
    const group = screen.getByRole("radiogroup");
    expect(group.classList.contains("cf-seg--sm")).toBe(true);
    expect(group.classList.contains("cf-seg--full")).toBe(true);
    expect(group.classList.contains("extra")).toBe(true);
  });

  describe("keyboard", () => {
    it("moves to the next and previous enabled option with the arrow keys, wrapping around", async () => {
      const user = userEvent.setup();
      render(<Demo />);
      option("Grid").focus();
      await user.keyboard("{ArrowRight}");
      expect(checkedOption()).toBe(option("List"));
      await waitFor(() => expect(document.activeElement).toBe(option("List")));
      await user.keyboard("{ArrowDown}");
      expect(checkedOption()).toBe(option("Compact view"));
      await user.keyboard("{ArrowRight}");
      expect(checkedOption()).toBe(option("Grid"));
      await user.keyboard("{ArrowLeft}");
      expect(checkedOption()).toBe(option("Compact view"));
      await user.keyboard("{ArrowUp}");
      expect(checkedOption()).toBe(option("List"));
    });

    it("jumps to the first and last enabled option with Home and End", async () => {
      const user = userEvent.setup();
      render(<Demo initial="list" />);
      option("List").focus();
      await user.keyboard("{End}");
      expect(checkedOption()).toBe(option("Compact view"));
      await user.keyboard("{Home}");
      expect(checkedOption()).toBe(option("Grid"));
    });

    it("ignores other keys", () => {
      const onChange = vi.fn();
      render(<Demo onChange={onChange} />);
      expect(fireEvent.keyDown(option("Grid"), { key: "a" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does nothing when every option is disabled", () => {
      const onChange = vi.fn();
      render(<Demo onChange={onChange} options={[{ value: "a", label: "A", disabled: true }]} initial="a" />);
      expect(fireEvent.keyDown(screen.getByRole("radio", { name: "A" }), { key: "ArrowRight" })).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("icon-only options", () => {
    it("explain themselves with a tooltip on hover", () => {
      vi.useFakeTimers();
      render(<Demo />);
      fireEvent.pointerEnter(option("Compact view"), { pointerType: "mouse" });
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.getByRole("tooltip").textContent).toBe("Compact view");
    });

    it("show no tooltip when the option has a text label", () => {
      vi.useFakeTimers();
      render(<Demo />);
      fireEvent.pointerEnter(option("List"), { pointerType: "mouse" });
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });
});
