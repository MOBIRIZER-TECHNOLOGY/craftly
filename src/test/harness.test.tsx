import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createShape, createText, solid } from "@/core/factory";
import { Button } from "@/ui";
import { contextOf, createMockContext } from "./canvasMock";
import { clearLibrary, flush, sampleDesign } from "./helpers";
import { setMedia } from "./media";
import { PageThumb } from "@/components/PageThumb";
import { renderPageToCanvas } from "@/render/renderPage";
import { saveDesign, getDesign } from "@/core/library";

describe("the jsdom test harness", () => {
  it("renders a component", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("paints pages onto the recording canvas", async () => {
    const design = createDesign({
      width: 400,
      height: 300,
      pages: [createPage({ background: solid("#ff0000"), elements: [createShape("rect", { x: 10, y: 10, width: 100, height: 80 }), createText({ text: "Hi", x: 20, y: 120 })] })],
    });
    const canvas = await renderPageToCanvas(design, design.pages[0], { width: 200 });
    const ctx = contextOf(canvas);
    expect(ctx).toBeTruthy();
    expect(ctx?.calls.length).toBeGreaterThan(0);
    expect(ctx?.callsTo("fillText").length ?? 0).toBeGreaterThan(0);
  });

  it("draws a PageThumb once it is visible", async () => {
    const design = sampleDesign();
    const { container } = render(<PageThumb design={design} page={design.pages[0]} width={200} />);
    await flush(5);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(contextOf(canvas)?.callsTo("drawImage").length).toBe(1);
  });

  it("keeps designs in a fake IndexedDB", async () => {
    await clearLibrary();
    const design = sampleDesign({ id: "harness-1" });
    await saveDesign(design);
    expect((await getDesign("harness-1"))?.title).toBe("Sample");
  });

  it("answers matchMedia per query", () => {
    expect(window.matchMedia("(max-width: 899px)").matches).toBe(false);
    setMedia("(max-width: 899px)", true);
    expect(window.matchMedia("(max-width: 899px)").matches).toBe(true);
  });

  it("has a context that measures text and makes gradients", () => {
    const ctx = createMockContext();
    ctx.font = "20px Inter";
    expect(ctx.measureText("abcd").width).toBeCloseTo(44);
    const g = ctx.createLinearGradient(0, 0, 10, 0);
    g.addColorStop(0, "#000");
    expect((g as unknown as { stops: unknown[] }).stops).toHaveLength(1);
    ctx.save();
    ctx.fillStyle = "#123456";
    ctx.restore();
    expect(ctx.fillStyle).toBe("#000000");
  });
});
