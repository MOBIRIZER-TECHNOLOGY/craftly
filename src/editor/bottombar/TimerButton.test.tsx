import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerButton } from "./TimerButton";

// The stopwatch runs on the clock, so the clock is fake. (Testing Library's own waiting does not cope with fake timers
// under vitest, so the clicks are plain events and the time is moved by hand.)
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2030, 0, 1, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

const trigger = () => screen.getByRole("button", { name: /^Timer/ });
const popover = () => screen.getByRole("dialog", { name: "Timer" });
const inPanel = (name: string) => within(popover()).getByRole("button", { name }) as HTMLButtonElement;
const readout = () => within(popover()).getByRole("timer").textContent;
const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const open = () => fireEvent.click(trigger());

describe("<TimerButton>", () => {
  it("starts closed and idle", () => {
    render(<TimerButton />);
    expect(trigger().getAttribute("aria-label")).toBe("Timer");
    expect(trigger().textContent).toBe("Timer");
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("dialog", { name: "Timer" })).toBeNull();
  });

  it("opens a small panel with the clock, Start and a Reset that has nothing to reset", () => {
    render(<TimerButton />);
    open();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(readout()).toBe("00:00");
    expect(inPanel("Start")).toBeTruthy();
    expect(inPanel("Reset").disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Timer" })).toBeNull();
  });

  it("closes again when the button is clicked a second time", () => {
    render(<TimerButton />);
    open();
    open();
    expect(screen.queryByRole("dialog", { name: "Timer" })).toBeNull();
  });

  it("counts while it runs, in the button and in the panel", () => {
    render(<TimerButton />);
    open();
    fireEvent.click(inPanel("Start"));
    expect(trigger().classList.contains("is-running")).toBe(true);
    pass(5000);
    expect(readout()).toBe("00:05");
    expect(trigger().getAttribute("aria-label")).toBe("Timer, 00:05");
    expect(trigger().textContent).toBe("00:05");
    expect(inPanel("Pause")).toBeTruthy();
  });

  it("keeps counting while the panel is closed", () => {
    render(<TimerButton />);
    open();
    fireEvent.click(inPanel("Start"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    pass(7000);
    expect(trigger().getAttribute("aria-label")).toBe("Timer, 00:07");
    open();
    expect(readout()).toBe("00:07");
  });

  it("pauses, holds the time, and resumes from it", () => {
    render(<TimerButton />);
    open();
    fireEvent.click(inPanel("Start"));
    pass(4000);
    fireEvent.click(inPanel("Pause"));
    expect(trigger().classList.contains("is-running")).toBe(false);
    pass(10_000);
    expect(readout()).toBe("00:04");
    expect(trigger().getAttribute("aria-label")).toBe("Timer, 00:04");
    fireEvent.click(inPanel("Resume"));
    pass(3000);
    expect(readout()).toBe("00:07");
  });

  it("resets to zero and stops", () => {
    render(<TimerButton />);
    open();
    fireEvent.click(inPanel("Start"));
    pass(9000);
    fireEvent.click(inPanel("Reset"));
    expect(readout()).toBe("00:00");
    expect(trigger().getAttribute("aria-label")).toBe("Timer");
    expect(trigger().classList.contains("is-running")).toBe(false);
    expect(inPanel("Start")).toBeTruthy();
    pass(5000);
    expect(readout()).toBe("00:00");
  });

  it("can reset a paused timer", () => {
    render(<TimerButton />);
    open();
    fireEvent.click(inPanel("Start"));
    pass(2000);
    fireEvent.click(inPanel("Pause"));
    expect(inPanel("Reset").disabled).toBe(false);
    fireEvent.click(inPanel("Reset"));
    expect(readout()).toBe("00:00");
  });

  it("shows hours after the first hour", () => {
    render(<TimerButton />);
    open();
    fireEvent.click(inPanel("Start"));
    pass(3_725_000);
    expect(readout()).toBe("1:02:05");
  });

  it("ticks four times a second while it runs and stops ticking when it is removed", () => {
    const start = vi.spyOn(window, "setInterval");
    const stop = vi.spyOn(window, "clearInterval");
    const { unmount } = render(<TimerButton />);
    expect(start).not.toHaveBeenCalled();
    open();
    fireEvent.click(inPanel("Start"));
    expect(start).toHaveBeenCalledWith(expect.any(Function), 250);
    const id = start.mock.results[0].value;
    unmount();
    expect(stop).toHaveBeenCalledWith(id);
  });

  it("stops ticking when paused", () => {
    const stop = vi.spyOn(window, "clearInterval");
    render(<TimerButton />);
    open();
    fireEvent.click(inPanel("Start"));
    stop.mockClear();
    fireEvent.click(inPanel("Pause"));
    expect(stop).toHaveBeenCalled();
  });
});
