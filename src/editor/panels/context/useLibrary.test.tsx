import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrandKit, getRecentColors, pushRecentColor, setBrandKit } from "@/core/library";
import { clearLibrary } from "@/test/helpers";
import { useBrandKit, useRecentColors } from "./useLibrary";

/* wrap the real library so single calls can be made to fail or wait */
vi.mock("@/core/library", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/core/library")>();
  return { ...mod, getBrandKit: vi.fn(mod.getBrandKit), getRecentColors: vi.fn(mod.getRecentColors), pushRecentColor: vi.fn(mod.pushRecentColor) };
});

beforeEach(async () => {
  await clearLibrary();
  vi.mocked(getBrandKit).mockClear();
  vi.mocked(getRecentColors).mockClear();
  vi.mocked(pushRecentColor).mockClear();
});

function Kit() {
  const kit = useBrandKit();
  return <output data-testid="kit">{kit === null ? "loading" : kit.colors.join(",") || "empty"}</output>;
}

function Recents() {
  const [recents, remember] = useRecentColors();
  return (
    <>
      <output data-testid="recents">{recents.join(",") || "none"}</output>
      <button onClick={() => remember("#abcdef")}>remember</button>
    </>
  );
}

describe("useBrandKit", () => {
  it("is null until the brand kit has loaded, then follows the library", async () => {
    await setBrandKit({ colors: ["#111111"], fonts: [], logos: [] });
    render(<Kit />);
    expect(screen.getByTestId("kit").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("kit").textContent).toBe("#111111"));
    await act(async () => setBrandKit({ colors: ["#222222", "#333333"], fonts: [], logos: [] }));
    await waitFor(() => expect(screen.getByTestId("kit").textContent).toBe("#222222,#333333"));
  });

  it("stays null when the library cannot be read", async () => {
    vi.mocked(getBrandKit).mockRejectedValueOnce(new Error("storage is gone"));
    render(<Kit />);
    await waitFor(() => expect(getBrandKit).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("kit").textContent).toBe("loading");
  });

  it("ignores an answer that arrives after it was unmounted, and stops listening", async () => {
    let answer: (kit: { colors: string[]; fonts: string[]; logos: string[] }) => void = () => undefined;
    vi.mocked(getBrandKit).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { unmount } = render(<Kit />);
    unmount();
    await act(async () => answer({ colors: ["#444444"], fonts: [], logos: [] }));
    await act(async () => setBrandKit({ colors: ["#555555"], fonts: [], logos: [] }));
    // the change after unmounting did not trigger another read
    expect(getBrandKit).toHaveBeenCalledTimes(1);
  });
});

describe("useRecentColors", () => {
  it("lists the recent colours and adds one that is remembered, newest first", async () => {
    await pushRecentColor("#010101");
    render(<Recents />);
    await waitFor(() => expect(screen.getByTestId("recents").textContent).toBe("#010101"));
    await act(async () => screen.getByRole("button", { name: "remember" }).click());
    await waitFor(() => expect(screen.getByTestId("recents").textContent).toBe("#abcdef,#010101"));
  });

  it("shows no colours when they cannot be read", async () => {
    vi.mocked(getRecentColors).mockRejectedValueOnce(new Error("storage is gone"));
    render(<Recents />);
    await waitFor(() => expect(getRecentColors).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("recents").textContent).toBe("none");
  });

  it("carries on when a colour cannot be saved", async () => {
    vi.mocked(pushRecentColor).mockRejectedValueOnce(new Error("storage is full"));
    render(<Recents />);
    await waitFor(() => expect(getRecentColors).toHaveBeenCalledTimes(1));
    await act(async () => screen.getByRole("button", { name: "remember" }).click());
    await waitFor(() => expect(pushRecentColor).toHaveBeenCalledWith("#abcdef"));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("recents").textContent).toBe("none");
  });
});
