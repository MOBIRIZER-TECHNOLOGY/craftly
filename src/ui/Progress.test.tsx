import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./Progress";

describe("Progress", () => {
  it("tells assistive technology how far along it is", () => {
    render(<Progress label="Downloading the model" value={0.34} />);
    const bar = screen.getByRole("progressbar", { name: "Downloading the model" });
    expect(bar.getAttribute("aria-valuenow")).toBe("34");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("fills the bar to the same share", () => {
    const { container } = render(<Progress label="x" value={0.5} />);
    expect((container.querySelector(".cf-progress__bar") as HTMLElement).style.width).toBe("50%");
  });

  it("keeps a value outside 0 to 1 inside the bar", () => {
    const { rerender } = render(<Progress label="x" value={1.7} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    rerender(<Progress label="x" value={-3} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("is indeterminate when no value is given: no number is announced", () => {
    render(<Progress label="Working" />);
    const bar = screen.getByRole("progressbar", { name: "Working" });
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(bar.classList.contains("is-indeterminate")).toBe(true);
  });
});
