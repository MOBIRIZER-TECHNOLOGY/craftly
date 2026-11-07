import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The developer routes load heavy tools (the canvas sandbox, the renderer gallery): stand in for them, the point
// here is which route shows what, and that production builds leave them out.
vi.mock("@/dev/Gallery", () => ({ Gallery: () => <div>Gallery stand-in</div> }));
vi.mock("@/dev/Sandbox", () => ({ Sandbox: () => <div>Sandbox stand-in</div> }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("<App> developer routes", () => {
  it("shows the renderer gallery on #/gallery in development", async () => {
    window.location.hash = "#/gallery";
    const { App } = await import("@/App");
    render(<App />);
    expect(await screen.findByText("Gallery stand-in")).toBeTruthy();
  });

  it("shows the canvas sandbox on #/sandbox in development", async () => {
    window.location.hash = "#/sandbox";
    const { App } = await import("@/App");
    render(<App />);
    expect(await screen.findByText("Sandbox stand-in")).toBeTruthy();
  });

  it("leaves both out of a production build: those routes show the dashboard", async () => {
    vi.stubEnv("DEV", false);
    vi.resetModules();
    const { App } = await import("@/App");
    window.location.hash = "#/gallery";
    const first = render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "What will you design today?" })).toBeTruthy();
    expect(screen.queryByText("Gallery stand-in")).toBeNull();
    first.unmount();
    window.location.hash = "#/sandbox";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "What will you design today?" })).toBeTruthy();
    expect(screen.queryByText("Sandbox stand-in")).toBeNull();
  });
});
