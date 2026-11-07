import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTextMeasurer } from "@/core/textMetrics";
import { ensureFont } from "@/render/fonts";
import { createDesign, createPage, createShape, createText } from "./factory";
import { pageOf, useActivePage, useEditor, useSelectedElements } from "./store";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();

function open() {
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(
    createDesign({
      width: 1000,
      height: 600,
      pages: [createPage({ id: "p1", elements: [createShape("rect", { id: "r1", x: 10, y: 10 }), createShape("rect", { id: "r2", x: 300, y: 10 })] })],
    }),
  );
}

beforeEach(open);

describe("useActivePage", () => {
  it("gives the page being edited", () => {
    const { result } = renderHook(() => useActivePage());
    expect(result.current?.id).toBe("p1");
    expect(result.current?.elements).toHaveLength(2);
  });

  it("follows the page when it changes and when another page is chosen", () => {
    const { result } = renderHook(() => useActivePage());
    act(() => a().updateElements(["r1"], { x: 99 }));
    expect(result.current?.elements[0].x).toBe(99);
    let second = "";
    act(() => {
      second = a().addPage();
    });
    expect(result.current?.id).toBe(second);
  });

  it("is null when no design is open", () => {
    const { result } = renderHook(() => useActivePage());
    act(() => a().closeDesign());
    expect(result.current).toBeNull();
  });
});

describe("useSelectedElements", () => {
  it("lists the selected elements in the order they were selected", () => {
    const { result } = renderHook(() => useSelectedElements());
    expect(result.current).toEqual([]);
    act(() => a().select(["r2", "r1"]));
    expect(result.current.map((e) => e.id)).toEqual(["r2", "r1"]);
  });

  it("shows an element's new state once it changes, and keeps the same list while nothing selected changes", () => {
    act(() => a().select(["r1"]));
    const { result } = renderHook(() => useSelectedElements());
    const first = result.current;
    act(() => a().updateElements(["r1"], { opacity: 0.4 }));
    expect(result.current[0].opacity).toBe(0.4);
    expect(result.current).not.toBe(first);
    const settled = result.current;
    act(() => a().setHover("r2"));
    expect(result.current).toBe(settled);
  });

  it("leaves out ids that are not on the page any more", () => {
    act(() => a().select(["r1", "r2"]));
    const { result } = renderHook(() => useSelectedElements());
    act(() => useEditor.setState({ selection: ["r1", "ghost"] }));
    expect(result.current.map((e) => e.id)).toEqual(["r1"]);
  });

  it("is empty when no design is open", () => {
    act(() => a().select(["r1"]));
    const { result } = renderHook(() => useSelectedElements());
    act(() => a().closeDesign());
    expect(result.current).toEqual([]);
  });
});

describe("when a font finishes loading", () => {
  class FakeFontFace {
    constructor(
      readonly family: string,
      readonly source: string,
      readonly descriptors: unknown,
    ) {}
    load(): Promise<this> {
      return Promise.resolve(this);
    }
  }

  beforeEach(() => {
    vi.stubGlobal("FontFace", FakeFontFace);
    Object.defineProperty(document, "fonts", { value: { add: () => undefined }, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as unknown as { fonts?: unknown }).fonts;
    setTextMeasurer(null);
  });

  it("measures the text boxes again, without adding an undo step", async () => {
    act(() => {
      a().addElement(createText({ id: "t", text: "Hello", fontSize: 40, x: 0, y: 0 }), { center: false });
    });
    const id = page().elements.at(-1)!.id;
    const stepsBefore = s().past.length;
    const widthBefore = page().elements.at(-1)!.width;
    // the real font turns out wider than the fallback was
    setTextMeasurer({ width: (_font, text) => text.length * 30, metrics: () => ({ ascent: 30, descent: 10 }) });
    const versionBefore = s().docVersion;
    await ensureFont("Inter", 400, false);
    const el = page().elements.find((e) => e.id === id)!;
    expect(el.width).toBe(150);
    expect(el.width).toBeGreaterThan(widthBefore);
    expect(s().docVersion).toBe(versionBefore + 1);
    expect(s().past).toHaveLength(stepsBefore);
    expect(s().saveState).toBe("unsaved");
  });

  it("still tells the editor to repaint when nothing needed measuring again", async () => {
    const design = s().design;
    const versionBefore = s().docVersion;
    await ensureFont("Lora", 400, false);
    expect(s().docVersion).toBe(versionBefore + 1);
    expect(s().design).toBe(design);
  });

  it("does nothing when no design is open", async () => {
    a().closeDesign();
    const versionBefore = s().docVersion;
    await ensureFont("Poppins", 400, false);
    expect(s().docVersion).toBe(versionBefore);
  });
});

function page() {
  return pageOf(s().design, s().activePageId)!;
}
