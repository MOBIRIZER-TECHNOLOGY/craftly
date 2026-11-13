import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, ToastHost } from "@/ui";
import { FLATTENED_SVG_NOTICE, installUploadNotices } from "./uploadNotices";

/** What the notices ask the uploads to tell them. */
let flattened: (() => void) | null = null;
const stop = vi.fn();

vi.mock("@/core/assets", () => ({
  subscribeFlattenedSvg: vi.fn((given: () => void) => {
    flattened = given;
    return stop;
  }),
}));

beforeEach(() => {
  flattened = null;
  stop.mockClear();
  render(<ToastHost />);
});

afterEach(async () => {
  act(() => toast.clear());
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
});

describe("when an SVG was stored as a picture", () => {
  it("tells the person in plain words", () => {
    installUploadNotices();
    act(() => flattened!());
    expect(screen.getByText("This SVG had parts Craftly does not keep, so it was added as a picture.")).toBeTruthy();
    expect(FLATTENED_SVG_NOTICE).toBe("This SVG had parts Craftly does not keep, so it was added as a picture.");
  });

  it("says it once for several that come together, and again for one that comes later", () => {
    let now = 1000;
    installUploadNotices(() => now);
    act(() => flattened!());
    now += 50;
    act(() => flattened!());
    act(() => flattened!());
    expect(screen.getAllByText(FLATTENED_SVG_NOTICE)).toHaveLength(1);
    now += 60_000;
    act(() => flattened!());
    expect(screen.getAllByText(FLATTENED_SVG_NOTICE)).toHaveLength(2);
  });

  it("stops listening when it is uninstalled", () => {
    const uninstall = installUploadNotices();
    expect(stop).not.toHaveBeenCalled();
    uninstall();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
