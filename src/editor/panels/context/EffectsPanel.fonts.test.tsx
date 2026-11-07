import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createText } from "@/core/factory";
import { contextOf } from "@/test/canvasMock";
import { openElements, showPanel } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";

/* the effect previews wait for a typeface: this file decides when it has arrived */
const fonts = vi.hoisted(() => ({ ready: false, asked: [] as Array<[string, number | undefined]>, listeners: new Set<() => void>() }));
vi.mock("@/render/fonts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/render/fonts")>();
  return {
    ...mod,
    isFontReady: () => fonts.ready,
    ensureFont: (family: string, weight?: number) => {
      fonts.asked.push([family, weight]);
      return Promise.resolve();
    },
    onFontsChange: (cb: () => void) => {
      fonts.listeners.add(cb);
      return () => void fonts.listeners.delete(cb);
    },
  };
});

beforeEach(() => {
  resetEditor();
  stubLayout();
  fonts.ready = false;
  fonts.asked.length = 0;
  fonts.listeners.clear();
});

describe("Effects panel previews and fonts", () => {
  it("asks for the preview typeface and paints the tiles when it has arrived", async () => {
    const t = createText({ text: "Effects", x: 50, y: 50 });
    openElements([t], { selected: [t] });
    const { container } = showPanel({ kind: "effects" });
    await waitFor(() => expect(fonts.asked.some(([family, weight]) => family === "Plus Jakarta Sans" && weight === 800)).toBe(true));
    const canvases = Array.from(container.querySelectorAll("canvas"));
    expect(canvases.length).toBeGreaterThanOrEqual(10);
    // nothing is painted with a fallback font while it is loading
    expect(canvases.every((c) => (contextOf(c)?.callsTo("fillText").length ?? 0) === 0)).toBe(true);

    fonts.ready = true;
    act(() => fonts.listeners.forEach((cb) => cb()));
    await waitFor(() => expect(canvases.filter((c) => (contextOf(c)?.callsTo("fillText").length ?? 0) > 0).length).toBeGreaterThan(5));
  });
});
