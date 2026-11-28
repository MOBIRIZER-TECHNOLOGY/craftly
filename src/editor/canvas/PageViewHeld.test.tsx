/** The page canvas while the timeline's playhead is parked: each clip is shown still, at the frame of that moment. */
import { act, configure, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ frame: null as HTMLCanvasElement | null }));
vi.mock(import("@/render/videos"), async (original) => ({
  ...(await original()),
  heldFrame: vi.fn(() => held.frame as unknown as HTMLVideoElement | null),
  playingFrame: vi.fn(() => null),
}));
import { createVideo } from "@/core/factory";
import { heldFrame, playingFrame } from "@/render/videos";
import { contextOf } from "@/test/canvasMock";
import { canvasDesign, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { holdPreview, startPreview, stopPreview } from "./preview";

configure({ asyncUtilTimeout: 20_000 });

const ctxOf = (rig: CanvasRig) => contextOf(rig.container.querySelector<HTMLCanvasElement>("canvas.cf-pageview")!)!;

describe("a clip on a held page", () => {
  it("is drawn at the frame of the held moment, and plays when the page plays", async () => {
    held.frame = Object.assign(document.createElement("canvas"), { width: 32, height: 18 });
    const clip = createVideo({ id: "clip", src: "asset:c", x: 100, y: 100, width: 320, height: 180, duration: 8 });
    const rig = await mountWorkspace(canvasDesign([clip]));
    await waitFor(() => expect(ctxOf(rig).calls.length).toBeGreaterThan(0));
    ctxOf(rig).reset();
    act(() => holdPreview(2.5));
    await waitFor(() => expect(vi.mocked(heldFrame)).toHaveBeenCalledWith(expect.objectContaining({ id: "clip" }), 2.5));
    await waitFor(() =>
      expect(
        ctxOf(rig)
          .callsTo("drawImage")
          .some((c) => c[0] === held.frame),
      ).toBe(true),
    );
    expect(playingFrame).not.toHaveBeenCalled();
    act(() => startPreview(0, 5));
    await waitFor(() => expect(playingFrame).toHaveBeenCalled());
    act(() => stopPreview());
  });
});
