import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage, createShape, createText } from "@/core/factory";
import { contextOf } from "@/test/canvasMock";
import { TransitionPreview } from "./TransitionPreview";

const design = { width: 1000, height: 500 };
const from = () => createPage({ elements: [createShape("rect", { x: 10, y: 10, width: 100, height: 100 })] });
const to = () =>
  createPage({
    background: { type: "solid", color: "#ffeecc" },
    elements: [createText({ text: "Next", x: 20, y: 20, animation: { in: { kind: "fade", duration: 0.5, delay: 0 } } })],
  });

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
});

describe("<TransitionPreview>", () => {
  it("shows the new page as it rests while there is no transition", async () => {
    render(<TransitionPreview design={design} from={from()} to={to()} transition={null} />);
    const canvas = screen.getByRole("img", { name: "This page" }) as HTMLCanvasElement;
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull();
    await waitFor(() => expect(contextOf(canvas)?.calls.length ?? 0).toBeGreaterThan(0));
  });

  it("keeps the shape of the design", () => {
    const { container } = render(<TransitionPreview design={design} from={from()} to={to()} transition={null} />);
    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe("1000 / 500");
    expect((screen.getByRole("img") as HTMLCanvasElement).width).toBe(308);
    expect((screen.getByRole("img") as HTMLCanvasElement).height).toBe(154);
  });

  it("plays a transition on the canvas and can play it again", async () => {
    const user = userEvent.setup();
    render(<TransitionPreview design={design} from={from()} to={to()} transition={{ kind: "slide", duration: 0.6, direction: "left" }} />);
    const canvas = screen.getByRole("img", { name: "Preview of the transition" }) as HTMLCanvasElement;
    await waitFor(() => expect(contextOf(canvas)?.callsTo("drawImage").length ?? 0).toBeGreaterThan(0));
    const seen = contextOf(canvas)!.calls.length;
    await user.click(screen.getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(contextOf(canvas)!.calls.length).toBeGreaterThan(seen));
  });

  it("starts over when another transition is chosen", async () => {
    const { rerender } = render(<TransitionPreview design={design} from={from()} to={to()} transition={{ kind: "dissolve", duration: 0.7 }} />);
    const canvas = screen.getByRole("img") as HTMLCanvasElement;
    await waitFor(() => expect(contextOf(canvas)?.calls.length ?? 0).toBeGreaterThan(0));
    const seen = contextOf(canvas)!.calls.length;
    const same = { from: from(), to: to() };
    rerender(<TransitionPreview design={design} from={same.from} to={same.to} transition={{ kind: "zoom", duration: 0.7 }} />);
    await waitFor(() => expect(contextOf(canvas)!.calls.length).toBeGreaterThan(seen));
  });

  it("does nothing on a canvas without a 2D context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<TransitionPreview design={design} from={from()} to={to()} transition={{ kind: "dissolve", duration: 0.7 }} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("img", { name: "Preview of the transition" })).toBeTruthy();
  });

  it("paints nothing when it is closed before the pages are ready", async () => {
    const { unmount } = render(<TransitionPreview design={design} from={from()} to={to()} transition={null} />);
    const canvas = screen.getByRole("img") as HTMLCanvasElement;
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(contextOf(canvas)?.callsTo("drawImage").length ?? 0).toBe(0);
  });

  it("copes with a device that reports no pixel ratio", () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 0, configurable: true });
    render(<TransitionPreview design={design} from={from()} to={to()} transition={null} />);
    expect((screen.getByRole("img") as HTMLCanvasElement).width).toBe(308);
  });
});
