import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

let explode = true;

function Bomb() {
  if (explode) throw new Error("kaboom: the canvas ran out of cheese");
  return <p>All fine here</p>;
}

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  explode = true;
  // React reports every caught error to the console: keep the test output quiet and check what is logged
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<ErrorBoundary>", () => {
  it("shows its children while nothing is wrong", () => {
    explode = false;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("All fine here")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces a crashed child with a calm recovery screen that shows the error message", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");
    expect(alert.textContent).toContain("Your designs are saved on this device");
    expect(alert.querySelector("pre")?.textContent).toBe("kaboom: the canvas ran out of cheese");
    expect(screen.getByRole("button", { name: "Reload Craftly" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to your projects" })).toBeTruthy();
  });

  it("logs the crash with the component stack", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    const call = consoleError.mock.calls.find((args) => args[0] === "Craftly crashed:");
    expect(call).toBeTruthy();
    expect((call?.[1] as Error).message).toContain("kaboom");
    expect(typeof call?.[2]).toBe("string");
  });

  it("reloads the page from the first button", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload Craftly" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("goes to the projects page from the second button and tries its children again", () => {
    window.location.hash = "#/design/broken";
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    explode = false;
    fireEvent.click(screen.getByRole("button", { name: "Go to your projects" }));
    expect(window.location.hash).toBe("#/");
    expect(screen.getByText("All fine here")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the recovery screen again when the children still fail after a retry", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to your projects" }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("clears the error when the resetKey changes, for example after navigating away", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="design/a">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    explode = false;
    rerender(
      <ErrorBoundary resetKey="design/a">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(
      <ErrorBoundary resetKey="home/">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("All fine here")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not remount healthy children when the resetKey changes", () => {
    explode = false;
    let mounts = 0;
    function Counter() {
      mounts += 1;
      return <p>counter</p>;
    }
    const { rerender } = render(
      <ErrorBoundary resetKey="a">
        <Counter />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="b">
        <Counter />
      </ErrorBoundary>,
    );
    expect(screen.getByText("counter")).toBeTruthy();
    expect(mounts).toBe(2);
  });
});
