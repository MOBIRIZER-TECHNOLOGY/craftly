/**
 * Helpers for the tests of the left rail and its panels (`src/editor/panels/tabs`, `shared`, `LeftRail`, `SidePanel`).
 *
 * `mountPanels()` lays out what the real editor puts beside the page - the rail, the side panel and the hosts the panels
 * talk to (toasts, confirm dialogs, context menus) - on a design opened in the store, without the heavy workspace.
 * The rest are small shortcuts: read the active page, make an image file, fake a drag, give canvases real pixels.
 */
import { act, configure, render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import { getActivePage, useEditor, type LeftTab } from "@/core/store";
import type { Design, DesignElement } from "@/core/types";
import { LeftRail } from "@/editor/panels/LeftRail";
import { useElementsNav, type ElementsPage } from "@/editor/panels/tabs/elements/nav";
import { SidePanel } from "@/editor/panels/SidePanel";
import { ConfirmHost, ContextMenuHost, ToastHost, toast } from "@/ui";
import { resetEditor, sampleDesign } from "./helpers";

/* The panels draw catalogues of previews (templates, photos, icons) and the machine is often busy: give `findBy` and `waitFor` more than the default second before they give up. */
configure({ asyncUtilTimeout: 20_000 });

/** The design the panels tests start from: a page with something on it. */
export const withContent = (): Design => sampleDesign({ title: "Panels sample" });

/** Puts the Elements tab back on its overview (or on a sub-page), with empty search boxes. */
export function resetElementsNav(page: ElementsPage | null = null, query = ""): void {
  useElementsNav.setState({ page, rootQuery: "", query, graphicsPane: "illustrations" });
}

/** A one page design with nothing on the page (applying a template then needs no confirmation). */
export function emptyDesign(overrides: Partial<Pick<Design, "id" | "title" | "width" | "height">> = {}): Design {
  return { ...createDesign({ title: "Empty panels design", width: 1280, height: 720, pages: [createPage({ name: "Blank" })] }), ...overrides };
}

export interface MountOptions {
  design?: Design;
  /** the rail tab to open first (the editor starts on "elements") */
  tab?: LeftTab;
}

/** Toasts live in module state, so the ones of an earlier test would still be on screen: dismiss them and let them leave. */
export function clearToasts(): void {
  const wasFake = vi.isFakeTimers();
  if (!wasFake) vi.useFakeTimers();
  toast.clear();
  vi.advanceTimersByTime(300);
  if (!wasFake) vi.useRealTimers();
}

/** Rail + side panel + the overlay hosts, on a design opened in the (reset) store. */
export function mountPanels({ design = withContent(), tab }: MountOptions = {}): RenderResult & { design: Design } {
  resetEditor();
  clearToasts();
  const actions = useEditor.getState().actions;
  actions.openDesign(design);
  if (tab) actions.setLeftTab(tab);
  const view = render(
    <>
      <LeftRail />
      <SidePanel />
      <ToastHost />
      <ConfirmHost />
      <ContextMenuHost />
    </>,
  );
  return Object.assign(view, { design });
}

/** `render`, then let the effects and observers that report right after mounting settle (no "not wrapped in act" noise). */
export async function renderSettled(ui: ReactElement): Promise<RenderResult> {
  let view!: RenderResult;
  await act(async () => {
    view = render(ui);
  });
  return view;
}

/** The elements of the active page, straight from the store. */
export function pageElements(): DesignElement[] {
  return getActivePage(useEditor.getState())?.elements ?? [];
}

export const lastElement = (): DesignElement => {
  const list = pageElements();
  return list[list.length - 1];
};

/** An image file for upload tests (the harness decodes any image at 64 x 48; an SVG is measured from its viewBox). */
export function imageFile(name = "photo.png", type = "image/png"): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type });
}

export function svgFile(name = "logo.svg", width = 120, height = 60): File {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ff0000"/></svg>`;
  return new File([svg], name, { type: "image/svg+xml" });
}

/** A minimal `dataTransfer` for drag events (jsdom has no DataTransfer). */
export function fakeDataTransfer(init: { files?: File[]; types?: string[] } = {}) {
  const data = new Map<string, string>();
  return {
    files: init.files ?? [],
    types: init.types ?? [],
    data,
    effectAllowed: "all",
    dropEffect: "none",
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? "",
    setDragImage: () => undefined,
  };
}

/**
 * Makes `getImageData` of every canvas answer with a picture made of flat colour blocks (`perColor` pixels each), so code
 * that reads pixels back (the palette from an image) has something to find. `restore` undoes it; `sizes` lists the size of
 * each canvas a 2D context was asked for.
 */
export function stubCanvasPixels(colors: Array<[number, number, number, number?]>, perColor = 400): { restore: () => void; sizes: Array<[number, number]> } {
  const data = new Uint8ClampedArray(colors.length * perColor * 4);
  let at = 0;
  for (const [r, g, b, a = 255] of colors) for (let i = 0; i < perColor; i++, at += 4) data.set([r, g, b, a], at);
  const sizes: Array<[number, number]> = [];
  const original = HTMLCanvasElement.prototype.getContext;
  const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, ...args: unknown[]) {
    sizes.push([this.width, this.height]);
    const ctx = (original as (...a: unknown[]) => CanvasRenderingContext2D | null).call(this, ...args);
    if (ctx) (ctx as unknown as { getImageData: unknown }).getImageData = (_x: number, _y: number, w: number, h: number) => ({ data, width: w, height: h });
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext);
  return { restore: () => spy.mockRestore(), sizes };
}
