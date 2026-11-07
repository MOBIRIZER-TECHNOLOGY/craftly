import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkSupport } from "./device";
import { useSupport } from "./useSupport";

vi.mock("./device", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./device")>()),
  checkSupport: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  vi.mocked(checkSupport).mockReset().mockResolvedValue({ ok: true });
});

describe("useSupport", () => {
  it("knows nothing until the browser has answered, then gives the answer", async () => {
    const { result } = renderHook(() => useSupport([]));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual({ ok: true }));
    expect(checkSupport).toHaveBeenCalledWith(undefined, []);
  });

  it("asks about the graphics-card features the model needs", async () => {
    const no = { ok: false, reason: "missing-feature", message: "No half precision." } as const;
    vi.mocked(checkSupport).mockResolvedValue(no);
    const { result } = renderHook(() => useSupport(["shader-f16", "other"]));
    await waitFor(() => expect(result.current).toEqual(no));
    expect(checkSupport).toHaveBeenCalledWith(undefined, ["shader-f16", "other"]);
  });

  it("does not ask while it is switched off, and asks once it is switched on", async () => {
    const { result, rerender } = renderHook(({ active }) => useSupport([], active), { initialProps: { active: false } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(checkSupport).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    rerender({ active: true });
    await waitFor(() => expect(result.current).toEqual({ ok: true }));
  });

  it("asks again only when the list of features changes, not when a new list with the same names is given", async () => {
    const { rerender } = renderHook(({ needs }) => useSupport(needs), { initialProps: { needs: ["a"] as readonly string[] } });
    await waitFor(() => expect(checkSupport).toHaveBeenCalledTimes(1));
    rerender({ needs: ["a"] });
    rerender({ needs: ["a", "b"] });
    await waitFor(() => expect(checkSupport).toHaveBeenCalledTimes(2));
  });

  it("drops an answer that arrives after the screen is gone", async () => {
    let answer!: (value: { ok: true }) => void;
    vi.mocked(checkSupport).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result, unmount } = renderHook(() => useSupport([]));
    unmount();
    answer({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeNull();
  });
});
