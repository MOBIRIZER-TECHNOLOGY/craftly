/** A clip's captions in a font of the app's own: drawn in it before the browser's of their kind, and waited for. */
import { describe, expect, it, vi } from "vitest";
import { createPage, createVideo } from "@/core/factory";
import type { DesignElement, VideoElement } from "@/core/types";
import { spyContext } from "@/test/logicPaint";

const fonts = vi.hoisted(() => ({ ready: false, asked: [] as Array<[string, number]> }));
vi.mock(import("./fonts"), async (original) => ({
  ...(await original()),
  isFontReady: (family: string) => fonts.ready || family !== "Lora",
  ensureFont: async (family: string, weight = 400) => {
    fonts.asked.push([family, weight]);
  },
}));
vi.mock(import("./videos"), async (original) => ({
  ...(await original()),
  playingFrame: () => Object.assign(document.createElement("canvas"), { width: 32, height: 18 }) as unknown as HTMLVideoElement,
}));
const { captionFontCss, collectResources, renderPage } = await import("./renderPage");

const lines = [{ start: 0, end: 2, text: "Hello" }];
const clip = (over: Partial<VideoElement> = {}) => createVideo({ src: "asset:c", duration: 4, trimEnd: 4, x: 0, y: 0, width: 200, height: 100, captions: lines, ...over });
const paint = (elements: DesignElement[]) => {
  const spy = spyContext({ width: 400, height: 300 });
  const complete = renderPage(spy.ctx, { width: 400, height: 300 }, createPage({ elements }), { scale: 1, animation: { time: 1 }, playVideos: {} });
  return { spy, complete };
};

describe("captions in a font of the app's own", () => {
  it("name that font before the browser's of their kind", () => {
    expect(captionFontCss({ font: "serif", family: "" })).toBe('Georgia, "Times New Roman", serif');
    expect(captionFontCss({ font: "serif", family: "Lora" })).toBe('"Lora Variable", "Lora", Georgia, "Times New Roman", serif');
    // a font that is not in the list (an uploaded one) is named as it is
    expect(captionFontCss({ font: "sans", family: "My Brand" })).toMatch(/^"My Brand", Inter/);
  });

  it("ask for the font, are drawn in the browser's meanwhile, and the page is unfinished until it has come", () => {
    fonts.ready = false;
    fonts.asked = [];
    const waiting = paint([clip({ captionStyle: { family: "Lora", font: "serif" } })]);
    expect(fonts.asked).toEqual([["Lora", 600]]);
    expect(waiting.complete).toBe(false);
    expect(waiting.spy.to("fillText")[0].state.font).toContain('"Lora Variable"');
    fonts.ready = true;
    expect(paint([clip({ captionStyle: { family: "Lora" } })]).complete).toBe(true);
  });

  it("make a download wait for the font, when the clip has captions to show in it", () => {
    const withLines = collectResources(createPage({ elements: [clip({ captionStyle: { family: "Lora" } })] }));
    expect([...withLines.fonts.values()]).toEqual([{ family: "Lora", weight: 600, italic: false }]);
    expect(collectResources(createPage({ elements: [clip({ captionStyle: { family: "Lora" }, captions: [] })] })).fonts.size).toBe(0);
    expect(collectResources(createPage({ elements: [clip()] })).fonts.size).toBe(0);
  });
});
