import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

describe("<Button>", () => {
  it("is a plain button that runs its click handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("type")).toBe("button");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not submit a form unless it is a submit button", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
        <Button type="submit">Send</Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Plain" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("takes its variant, size and width from the props", () => {
    render(
      <Button variant="primary" size="lg" block className="extra">
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    for (const name of ["cf-btn", "cf-btn--primary", "cf-btn--lg", "cf-btn--block", "extra"]) expect(button.classList.contains(name)).toBe(true);
    expect(button.classList.contains("cf-btn--icon-only")).toBe(false);
  });

  it("defaults to the secondary look at medium size", () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.classList.contains("cf-btn--secondary")).toBe(true);
    expect(button.classList.contains("cf-btn--md")).toBe(true);
  });

  it("shows icons before and after the label", () => {
    render(
      <Button icon={<svg data-testid="lead" />} iconRight={<svg data-testid="trail" />}>
        Next
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Next" });
    expect(button.querySelector("[data-testid='lead']")).toBeTruthy();
    expect(button.querySelector("[data-testid='trail']")).toBeTruthy();
    expect(button.querySelector(".cf-btn__icon--right [data-testid='trail']")).toBeTruthy();
  });

  it("is an icon-only button when there is no label", () => {
    const { rerender } = render(<Button aria-label="More" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "More" }).classList.contains("cf-btn--icon-only")).toBe(true);
    expect(screen.getByRole("button", { name: "More" }).querySelector(".cf-btn__label")).toBeNull();
    rerender(<Button aria-label="More">{false}</Button>);
    expect(screen.getByRole("button", { name: "More" }).classList.contains("cf-btn--icon-only")).toBe(true);
  });

  it("shows a spinner and ignores clicks while loading, but keeps keyboard focus", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading size="sm" onClick={onClick}>
          Saving
        </Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.querySelector(".cf-btn__spinner")).toBeTruthy();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
  });

  it("is not busy when it is not loading", () => {
    render(<Button>Idle</Button>);
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("button").querySelector(".cf-btn__spinner")).toBeNull();
  });

  it("cannot be clicked while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Off" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("hands its element to a ref and passes other attributes on", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} data-autofocus="" title="Hint">
        Ref
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Ref" });
    expect(ref.current).toBe(button);
    expect(button.getAttribute("data-autofocus")).toBe("");
    expect(button.getAttribute("title")).toBe("Hint");
  });
});

describe("<IconButton>", () => {
  it("is named by its label and runs its click handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="Undo" icon={<svg data-testid="undo-icon" />} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button.querySelector("[data-testid='undo-icon']")).toBeTruthy();
    expect(button.getAttribute("type")).toBe("button");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("explains itself with a tooltip showing the label and the shortcut", () => {
    vi.useFakeTimers();
    render(<IconButton label="Undo" shortcut="Ctrl+Z" icon={<svg />} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Undo" }), { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(500));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Undo");
    expect(tip.textContent).toContain("Ctrl+Z");
  });

  it("does not describe itself twice: the tooltip text repeats the name", () => {
    vi.useFakeTimers();
    render(<IconButton label="Undo" icon={<svg />} />);
    const button = screen.getByRole("button", { name: "Undo" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-describedby")).toBeNull();
  });

  it("can do without the tooltip", () => {
    vi.useFakeTimers();
    render(<IconButton label="Undo" icon={<svg />} tooltip={false} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Undo" }), { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("announces the shortcut to assistive technology", () => {
    render(<IconButton label="Undo" shortcut="Ctrl+Z" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Undo" }).getAttribute("aria-keyshortcuts")).toBe("Control+Z Meta+Z");
  });

  it("shows a toggled state only when it has one", () => {
    const { rerender } = render(<IconButton label="Bold" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBeNull();
    rerender(<IconButton label="Bold" icon={<svg />} active />);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Bold" }).classList.contains("is-active")).toBe(true);
    rerender(<IconButton label="Bold" icon={<svg />} active={false} />);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("ignores clicks while disabled but stays focusable", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <IconButton label="Send" type="submit" icon={<svg />} disabled onClick={onClick} />
      </form>,
    );
    const button = screen.getByRole("button", { name: "Send" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("takes its size and class from the props, forwards the ref and passes other attributes on", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} label="More" icon={<svg />} size="lg" className="extra" aria-haspopup="menu" />);
    const button = screen.getByRole("button", { name: "More" });
    expect(ref.current).toBe(button);
    expect(button.classList.contains("cf-iconbtn--lg")).toBe(true);
    expect(button.classList.contains("extra")).toBe(true);
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
  });
});
