/**
 * Helpers shared by the tests of the editor chrome around the canvas: top bar, page strip and grid, dialogs, bottom bar
 * and presenter. They sit on top of the harness in `helpers.tsx` (which this file does not change).
 */
import { act, configure, createEvent, fireEvent, render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { onTestFinished, vi } from "vitest";
import { createDesign, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import { saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design, Page } from "@/core/types";
import { ConfirmHost, ToastHost, toast } from "@/ui";
import { flush } from "./helpers";

// Six test workers share the machine: give waitFor and findBy... more than their default second.
configure({ asyncUtilTimeout: 20_000 });

/**
 * Three pages: "Intro" (headline and a box, with presenter notes), an unnamed one with a photo and "Wrap up" (a line of
 * text and notes). The design is 1280 x 720, like a presentation.
 */
export function chromeDesign(title = "Chrome design"): Design {
  const intro = createPage({
    name: "Intro",
    notes: "Welcome everyone",
    elements: [createText({ text: "Hello chrome", fontSize: 72, x: 80, y: 60, width: 600 }), createShape("rect", { x: 100, y: 300, width: 300, height: 200 })],
  });
  const middle = createPage({ elements: [createImage({ src: "blob:test/photo.jpg", x: 200, y: 100, width: 320, height: 240, naturalWidth: 640, naturalHeight: 480 })] });
  const outro = createPage({ name: "Wrap up", notes: "Thank you", elements: [createText({ text: "The end", fontSize: 72, x: 80, y: 80, width: 600 })] });
  return createDesign({ title, width: 1280, height: 720, pages: [intro, middle, outro] });
}

/** A design with `count` blank pages in distinct colours (page 1 is red, page 2 blue ...). */
export function coloredDesign(count: number, title = "Coloured pages"): Design {
  const colors = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];
  const pages: Page[] = Array.from({ length: count }, (_unused, i) => createPage({ background: solid(colors[i % colors.length]), duration: 2 }));
  return createDesign({ title, width: 400, height: 300, pages });
}

/**
 * Put `design` in the library and open it in the store the way the editor does, then render `ui` beside the toast and
 * confirm hosts that the app mounts once at its root (toasts and "Are you sure?" dialogs need them).
 */
export async function renderChrome(ui: ReactElement, design: Design = chromeDesign()): Promise<RenderResult & { design: Design }> {
  await saveDesign(design);
  act(() => useEditor.getState().actions.openDesign(design));
  const view = render(
    <>
      {ui}
      <ToastHost />
      <ConfirmHost />
    </>,
  );
  await flush();
  return Object.assign(view, { design });
}

/** Run an async action of the editor (save, copy, print ...) inside `act`, so the toasts it shows do not warn about untracked updates. */
export async function inAct(action: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await action();
  });
}

/** Wait for the next animation frame (a number field selects its text in one when it is focused: typing before that races it). */
export async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** Dismiss every toast and wait until they have left the screen (the toast list lives outside React). */
export async function clearToasts(): Promise<void> {
  act(() => toast.clear());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 230));
  });
}

/* ---------- the document in the store ---------- */

export const storeDesign = (): Design => {
  const design = useEditor.getState().design;
  if (!design) throw new Error("no design is open");
  return design;
};
export const pageIds = (): string[] => storeDesign().pages.map((p) => p.id);
export const pageNames = (): Array<string | undefined> => storeDesign().pages.map((p) => p.name);
export const activeIndex = (): number => {
  const s = useEditor.getState();
  return storeDesign().pages.findIndex((p) => p.id === s.activePageId);
};

/* ---------- drag and drop (jsdom has no DataTransfer and builds plain Events for drag events) ---------- */

export interface FakeDataTransfer {
  dropEffect: string;
  effectAllowed: string;
  types: string[];
  setData(type: string, value: string): void;
  getData(type: string): string;
  readonly data: Map<string, string>;
}

export function fakeDataTransfer(): FakeDataTransfer {
  const data = new Map<string, string>();
  const dt: FakeDataTransfer = {
    dropEffect: "none",
    effectAllowed: "all",
    types: [],
    setData(type, value) {
      data.set(type, value);
      dt.types = [...data.keys()];
    },
    getData: (type) => data.get(type) ?? "",
    data,
  };
  return dt;
}

/** Fire a drag event with a pointer position. Returns false when the handler cancelled it (`preventDefault`). */
export function fireDrag(el: Element, type: "dragStart" | "dragOver" | "dragEnd" | "drop", dataTransfer: FakeDataTransfer, clientX = 0): boolean {
  const event = createEvent[type](el, { dataTransfer });
  Object.defineProperty(event, "clientX", { value: clientX });
  return fireEvent(el, event);
}

/* ---------- what the recording canvas painted ---------- */

export interface PaintRecord {
  /** `fillRect` calls: the fill colour (or paint) and the opacity in force when the rectangle was filled. `n` orders every record of the three lists. */
  fills: Array<{ n: number; canvas: HTMLCanvasElement; style: unknown; rect: number[]; alpha: number }>;
  /** `drawImage` calls: what was drawn and how opaque */
  images: Array<{ n: number; canvas: HTMLCanvasElement; source: unknown; args: unknown[]; alpha: number }>;
  /** `fill` calls (shapes), with the colour and the opacity in force */
  shapes: Array<{ n: number; canvas: HTMLCanvasElement; style: unknown; alpha: number }>;
}

/**
 * Starts logging the colour and opacity of every `fillRect`, `drawImage` and `fill` on every canvas created from here on
 * (the recording context only keeps the arguments). The log stops when mocks are restored, which the harness does after each test.
 */
export function recordPaints(): PaintRecord {
  const log: PaintRecord = { fills: [], images: [], shapes: [] };
  let sequence = 0;
  const original = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => CanvasRenderingContext2D | null;
  const seen = new WeakSet<object>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const ctx = original.call(this, type, ...rest);
    if (ctx && !seen.has(ctx)) {
      seen.add(ctx);
      const calls = (ctx as unknown as { calls: Array<{ name: string; args: unknown[] }> }).calls;
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the methods below name the canvas they paint on
      const canvas = this;
      ctx.fillRect = (...args: number[]) => {
        calls.push({ name: "fillRect", args });
        log.fills.push({ n: ++sequence, canvas, style: ctx.fillStyle, rect: args, alpha: ctx.globalAlpha });
      };
      ctx.drawImage = (...args: unknown[]) => {
        calls.push({ name: "drawImage", args });
        log.images.push({ n: ++sequence, canvas, source: args[0], args, alpha: ctx.globalAlpha });
      };
      ctx.fill = (...args: unknown[]) => {
        calls.push({ name: "fill", args });
        log.shapes.push({ n: ++sequence, canvas, style: ctx.fillStyle, alpha: ctx.globalAlpha });
      };
    }
    return ctx as never;
  } as never);
  return log;
}

/* ---------- downloads and other browser side effects ---------- */

/** Catches the file names of downloads started through an `<a download>` click (jsdom cannot navigate). */
export function captureDownloads(): string[] {
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return names;
}

/** Collects the events of one type dispatched on `window` until the test ends. */
export function listenOnWindow(type: string): Event[] {
  const events: Event[] = [];
  const handler = (e: Event) => events.push(e);
  window.addEventListener(type, handler);
  onTestFinished(() => window.removeEventListener(type, handler));
  return events;
}
