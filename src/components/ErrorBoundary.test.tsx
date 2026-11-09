import { fireEvent, render, screen } from "@testing-library/react";
import { clearProblems, listProblems } from "@/core/problems";
import { isCrashing, markCrashing } from "@/core/recovery";
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
  localStorage.clear();
  sessionStorage.clear();
  clearProblems();
  markCrashing(false);
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

describe("<ErrorBoundary> and the problem it writes down", () => {
  it("writes the crash into the list of problems on this device, as a stopped screen", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    const [problem] = listProblems();
    expect(problem).toMatchObject({ kind: "screen", message: "kaboom: the canvas ran out of cheese", count: 1 });
    expect(screen.getByText("Report this problem")).toBeTruthy();
  });

  it("knows that the editor is going away because the screen stopped, until the person goes on", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(isCrashing()).toBe(true);
    explode = false;
    fireEvent.click(screen.getByRole("button", { name: "Go to your projects" }));
    expect(isCrashing()).toBe(false);
  });

  it("lets go of that when another screen is chosen", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="design/a">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(isCrashing()).toBe(true);
    explode = false;
    rerender(
      <ErrorBoundary resetKey="home/">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(isCrashing()).toBe(false);
  });

  it("knows which design it was, and says that Craftly stopped again when the same design stops it twice in a row", () => {
    const first = render(
      <ErrorBoundary designId="d1">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Craftly stopped unexpectedly.");
    first.unmount();
    render(
      <ErrorBoundary designId="d1">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Craftly stopped again when this design was opened.");
  });

  it("counts only the design that stopped, and nothing when no design was open", () => {
    const first = render(
      <ErrorBoundary designId="d1">
        <Bomb />
      </ErrorBoundary>,
    );
    first.unmount();
    render(
      <ErrorBoundary designId="d2">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Craftly stopped unexpectedly.");
    expect(sessionStorage.getItem("craftly.crashes.v1")).toContain("d1");
    expect(sessionStorage.getItem("craftly.crashes.v1")).toContain("d2");
  });

  it("does not look for versions or count anything for a screen that is not a design", () => {
    render(
      <ErrorBoundary designId={null}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.queryByText("Go back to an earlier version")).toBeNull();
    expect(sessionStorage.getItem("craftly.crashes.v1")).toBeNull();
  });
});
