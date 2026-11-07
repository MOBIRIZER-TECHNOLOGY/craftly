import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { SearchField, type SearchFieldProps } from "./SearchField";
import { Switch } from "./Switch";
import { TextField } from "./TextField";

/* ------------------------------------------------------------------ */
/* SearchField                                                        */
/* ------------------------------------------------------------------ */

function SearchDemo({ initial = "", ...props }: { initial?: string } & Partial<Omit<SearchFieldProps, "value">>) {
  const [value, setValue] = useState(initial);
  return (
    <SearchField
      {...props}
      value={value}
      onChange={(next) => {
        props.onChange?.(next);
        setValue(next);
      }}
    />
  );
}

describe("<SearchField>", () => {
  it("is a search landmark with a search box named after its placeholder", () => {
    render(<SearchDemo placeholder="Search templates" />);
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search templates" })).toBeTruthy();
  });

  it("uses the default placeholder, or an explicit accessible name", () => {
    const { rerender } = render(<SearchDemo />);
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeTruthy();
    rerender(<SearchDemo aria-label="Find a design" placeholder="Type here" />);
    expect(screen.getByRole("searchbox", { name: "Find a design" })).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).placeholder).toBe("Type here");
  });

  it("reports what is typed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchDemo onChange={onChange} />);
    await user.type(screen.getByRole("searchbox"), "cat");
    expect(onChange).toHaveBeenLastCalledWith("cat");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("cat");
  });

  it("offers a clear button only while there is text", async () => {
    const user = userEvent.setup();
    render(<SearchDemo />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await user.type(screen.getByRole("searchbox"), "a");
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("clears the text, tells the owner and puts the cursor back in the field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<SearchDemo initial="poster" onChange={onChange} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("clears on the first Escape and keeps the key from closing the dialog around it", async () => {
    const user = userEvent.setup();
    const around = vi.fn();
    render(
      <div onKeyDown={around}>
        <SearchDemo initial="poster" />
      </div>,
    );
    screen.getByRole("searchbox").focus();
    await user.keyboard("{Escape}");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(around).not.toHaveBeenCalled();
  });

  it("lets Escape through when the field is already empty", async () => {
    const user = userEvent.setup();
    const around = vi.fn();
    render(
      <div onKeyDown={around}>
        <SearchDemo />
      </div>,
    );
    screen.getByRole("searchbox").focus();
    await user.keyboard("{Escape}");
    expect(around).toHaveBeenCalledTimes(1);
  });

  it("submits the text on Enter, if anyone listens", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = render(<SearchDemo initial="logo" onSubmit={onSubmit} />);
    screen.getByRole("searchbox").focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("logo");
    unmount();
    render(<SearchDemo initial="logo" />);
    screen.getByRole("searchbox").focus();
    await user.keyboard("{Enter}");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("logo");
  });

  it("shows trailing content and takes its size, class and id", () => {
    render(<SearchDemo trailing={<kbd>/</kbd>} size="lg" className="extra" id="q" />);
    expect(screen.getByText("/")).toBeTruthy();
    const root = screen.getByRole("search");
    expect(root.classList.contains("cf-search--lg")).toBe(true);
    expect(root.classList.contains("extra")).toBe(true);
    expect(screen.getByRole("searchbox").id).toBe("q");
  });

  it("hands its input to a forwarded ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(<SearchField ref={ref} value="" onChange={() => undefined} />);
    expect(ref.current).toBe(screen.getByRole("searchbox"));
  });

  it("is inert while disabled and has no clear button", () => {
    render(<SearchDemo initial="text" disabled />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.getByRole("search").classList.contains("is-disabled")).toBe(true);
  });

  it("can take focus on mount", () => {
    render(<SearchDemo autoFocus />);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });
});

/* ------------------------------------------------------------------ */
/* TextField                                                          */
/* ------------------------------------------------------------------ */

describe("<TextField>", () => {
  it("links its label to the input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Design name" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Design name");
    await user.type(input, "a");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("has no label element without a label", () => {
    const { container } = render(<TextField aria-label="Plain" />);
    expect(container.querySelector("label")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Plain" })).toBeTruthy();
  });

  it("uses the id it is given", () => {
    render(<TextField label="Name" id="custom-id" />);
    expect(screen.getByLabelText("Name").id).toBe("custom-id");
  });

  it("describes the input with a hint", () => {
    render(<TextField label="Name" hint="Shown in your projects" />);
    const input = screen.getByLabelText("Name");
    const hint = screen.getByText("Shown in your projects");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(hint.getAttribute("role")).toBeNull();
  });

  it("announces an error in place of the hint", () => {
    render(<TextField label="Name" hint="Shown in your projects" error="A name is required" />);
    const input = screen.getByLabelText("Name");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("A name is required");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.queryByText("Shown in your projects")).toBeNull();
    expect(input.closest(".cf-field__box")?.classList.contains("is-invalid")).toBe(true);
  });

  it("shows content before and after the text", () => {
    render(<TextField label="Width" leading={<span>W</span>} trailing={<span>px</span>} size="sm" className="extra" />);
    expect(screen.getByText("W")).toBeTruthy();
    expect(screen.getByText("px")).toBeTruthy();
    expect(screen.getByLabelText("Width").closest(".cf-field")?.classList.contains("cf-field--sm")).toBe(true);
    expect(screen.getByLabelText("Width").closest(".cf-field")?.classList.contains("extra")).toBe(true);
  });

  it("can be disabled, takes a ref and passes input attributes on", () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} label="Name" disabled placeholder="Untitled" maxLength={20} data-autofocus="" />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(ref.current).toBe(input);
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Untitled");
    expect(input.maxLength).toBe(20);
    expect(input.getAttribute("data-autofocus")).toBe("");
    expect(input.closest(".cf-field__box")?.classList.contains("is-disabled")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Checkbox and Switch                                                */
/* ------------------------------------------------------------------ */

function CheckDemo({
  initial = false,
  ...props
}: {
  initial?: boolean;
  label?: string;
  disabled?: boolean;
  indeterminate?: boolean;
  "aria-label"?: string;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <Checkbox
      {...props}
      checked={checked}
      onChange={(next) => {
        props.onChange?.(next);
        setChecked(next);
      }}
    />
  );
}

function SwitchDemo({
  initial = false,
  ...props
}: {
  initial?: boolean;
  label?: string;
  labelFirst?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      {...props}
      checked={checked}
      onChange={(next) => {
        props.onChange?.(next);
        setChecked(next);
      }}
    />
  );
}

describe("<Checkbox>", () => {
  it("toggles and reports the new state, also when its label is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckDemo label="Snap to guides" onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Snap to guides" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(box.checked).toBe(true);
    await user.click(screen.getByText("Snap to guides"));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(box.checked).toBe(false);
  });

  it("toggles with the Space key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckDemo label="Grid" onChange={onChange} />);
    screen.getByRole("checkbox").focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("uses aria-label only when there is no visible label", () => {
    const { unmount } = render(<CheckDemo aria-label="Select all" />);
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeTruthy();
    unmount();
    render(<CheckDemo label="Visible" aria-label="Hidden" />);
    expect(screen.getByRole("checkbox", { name: "Visible" })).toBeTruthy();
    expect(screen.getByRole("checkbox").getAttribute("aria-label")).toBeNull();
  });

  it("cannot be toggled while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckDemo label="Locked" disabled onChange={onChange} />);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox").closest("label")?.classList.contains("is-disabled")).toBe(true);
  });

  it("shows the mixed state of a partly selected group until it is checked", () => {
    const { rerender } = render(<Checkbox label="All" checked={false} indeterminate onChange={() => undefined} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).indeterminate).toBe(true);
    rerender(<Checkbox label="All" checked indeterminate onChange={() => undefined} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).indeterminate).toBe(false);
    rerender(<Checkbox label="All" checked={false} onChange={() => undefined} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).indeterminate).toBe(false);
  });

  it("takes an id and a class", () => {
    render(<Checkbox label="Id" id="cb" className="extra" checked onChange={() => undefined} />);
    expect(screen.getByRole("checkbox").id).toBe("cb");
    expect(screen.getByRole("checkbox").closest("label")?.classList.contains("extra")).toBe(true);
  });
});

describe("<Switch>", () => {
  it("is a switch that toggles and reports the new state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchDemo label="Show rulers" onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Show rulers" }) as HTMLInputElement;
    await user.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByText("Show rulers"));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle.checked).toBe(false);
  });

  it("uses aria-label only when there is no visible label", () => {
    const { unmount } = render(<SwitchDemo aria-label="Dark mode" />);
    expect(screen.getByRole("switch", { name: "Dark mode" })).toBeTruthy();
    unmount();
    render(<SwitchDemo label="Visible" aria-label="Hidden" />);
    expect(screen.getByRole("switch", { name: "Visible" })).toBeTruthy();
  });

  it("can put the label first", () => {
    render(<SwitchDemo label="Autosave" labelFirst />);
    expect(screen.getByRole("switch").closest("label")?.classList.contains("cf-switch--label-first")).toBe(true);
  });

  it("cannot be toggled while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchDemo label="Locked" disabled onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes an id and a class", () => {
    render(<Switch checked id="sw" className="extra" aria-label="x" onChange={() => undefined} />);
    expect(screen.getByRole("switch").id).toBe("sw");
    expect(screen.getByRole("switch").closest("label")?.classList.contains("extra")).toBe(true);
  });

  it("asks for the opposite of what a controlled switch shows", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked={false} aria-label="x" onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<Switch checked aria-label="x" onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
