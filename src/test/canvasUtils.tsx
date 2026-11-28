/**
 * Helpers for the canvas tests (controller gestures, overlays, rulers): mount the workspace on a known layout and turn
 * design coordinates into pointer events, so a test reads like a person using the mouse ("drag from here to there")
 * and asserts on the document in the store.
 *
 * `stubLayout()` makes the workspace 1000 x 700. A design of 856 x 604 therefore fits at exactly 100 % zoom, with the
 * page 72 px from the left and 48 px from the top, so design px and screen px only differ by that fixed offset.
 */
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { createDesign, createPage } from "@/core/factory";
import { findElement } from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { Design, DesignElement, ID } from "@/core/types";
import { setContextMenuHandler } from "@/editor/canvas/controller";
import { useGesture } from "@/editor/canvas/gestureStore";
import { usePreview } from "@/editor/canvas/preview";
import { designToScreen, initialMetrics, useView } from "@/editor/canvas/viewStore";
import { Workspace } from "@/editor/canvas/Workspace";
import { useTableCellEditor } from "@/editor/canvas/tableCellEditing";
import { flush, resetEditor, stubLayout } from "./helpers";

/** A one page design that fits the stubbed 1000 x 700 workspace at 100 % zoom. */
export function canvasDesign(elements: DesignElement[] = [], extra: Partial<Design> = {}): Design {
  return { ...createDesign({ title: "Canvas test", width: 856, height: 604, pages: [createPage({ elements })] }), ...extra };
}

/** The module level stores the canvas keeps outside the document store; tests start from their initial values. */
export function resetCanvasStores(): void {
  useView.setState({ ...initialMetrics });
  useGesture.setState({ marquee: null, hud: null, drawPath: null, connector: null, pen: null, active: false });
  usePreview.setState({ preview: null });
  useTableCellEditor.setState({ editing: null });
  setContextMenuHandler(null);
}

export interface PointerOptions {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  button?: number;
  pointerId?: number;
  /** element that receives the event (default: the workspace); events bubble up to the controller either way */
  target?: Element;
}

export interface CanvasRig extends RenderResult {
  host: HTMLElement;
  scroller: HTMLElement;
  /** client coordinates of a point of the page given in design px */
  client(x: number, y: number): { clientX: number; clientY: number };
  /** Each of these returns false when the controller called preventDefault on the event. */
  down(x: number, y: number, opts?: PointerOptions): boolean;
  move(x: number, y: number, opts?: PointerOptions): boolean;
  up(x: number, y: number, opts?: PointerOptions): boolean;
  cancel(x: number, y: number, opts?: PointerOptions): boolean;
  /** press at `from`, move in a few steps and release at `to` */
  drag(from: [number, number], to: [number, number], opts?: PointerOptions): void;
  dblclick(x: number, y: number, opts?: PointerOptions): boolean;
  contextMenu(x: number, y: number, opts?: PointerOptions): boolean;
  /** Ctrl + wheel zooms; `deltaMode` 1 means lines instead of pixels */
  wheel(x: number, y: number, deltaY: number, opts?: PointerOptions & { deltaMode?: number }): boolean;
  /** a pointer event at raw client coordinates, for gestures that care about screen distance rather than design px */
  pointerAt(type: "pointerDown" | "pointerMove" | "pointerUp", clientX: number, clientY: number, opts?: PointerOptions): boolean;
  /** drag and drop events (jsdom has no DragEvent: a mouse event carries `dataTransfer`); false when preventDefault was called */
  dragOver(x: number, y: number, dataTransfer: Record<string, unknown>): boolean;
  drop(x: number, y: number, dataTransfer: Record<string, unknown>): boolean;
  /** the selection handle with this `data-cf-handle` value, e.g. "resize:se", "rotate", "move", "line:1" */
  handle(name: string): HTMLElement;
}

/** Open `design` in the store and mount the workspace (only the canvas, no toolbars or panels) on it. */
export async function mountWorkspace(design: Design = canvasDesign(), children?: ReactNode, options: { strict?: boolean } = {}): Promise<CanvasRig> {
  resetEditor();
  resetCanvasStores();
  stubLayout();
  getActions().openDesign(design);
  const workspace = <Workspace>{children}</Workspace>;
  const view = render(options.strict ? <StrictMode>{workspace}</StrictMode> : workspace);
  await flush();
  const host = view.container.querySelector("[data-cf-workspace]") as HTMLElement;
  const scroller = host.querySelector(".cf-workspace__scroll") as HTMLElement;
  // jsdom never clamps scroll offsets, so the first layout leaves an arbitrary one: start from the top left corner
  scroller.scrollLeft = 0;
  scroller.scrollTop = 0;
  fireEvent.scroll(scroller);

  const client = (x: number, y: number) => {
    const p = designToScreen({ ...useView.getState(), scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop }, x, y);
    return { clientX: p.x, clientY: p.y };
  };
  const init = (x: number, y: number, o: PointerOptions, buttons: number) => ({
    ...client(x, y),
    pointerId: o.pointerId ?? 1,
    pointerType: "mouse",
    button: o.button ?? 0,
    buttons,
    shiftKey: !!o.shift,
    ctrlKey: !!o.ctrl,
    altKey: !!o.alt,
    metaKey: !!o.meta,
  });
  const fire = (type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", x: number, y: number, o: PointerOptions = {}) =>
    fireEvent[type](o.target ?? host, init(x, y, o, type === "pointerUp" || type === "pointerCancel" ? 0 : 1));

  const fireDrag = (type: "dragover" | "drop", x: number, y: number, dataTransfer: Record<string, unknown>) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...client(x, y) });
    const defaults: Record<string, unknown> = { types: [], files: [], getData: () => "" };
    for (const key of Object.keys(defaults)) if (!(key in dataTransfer)) dataTransfer[key] = defaults[key];
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    return fireEvent(host, event);
  };

  const rig: CanvasRig = {
    ...view,
    host,
    scroller,
    client,
    down: (x, y, o) => fire("pointerDown", x, y, o),
    move: (x, y, o) => fire("pointerMove", x, y, o),
    up: (x, y, o) => fire("pointerUp", x, y, o),
    cancel: (x, y, o) => fire("pointerCancel", x, y, o),
    dblclick: (x, y, o = {}) => fireEvent.doubleClick(o.target ?? host, init(x, y, o, 0)),
    contextMenu: (x, y, o = {}) => fireEvent.contextMenu(o.target ?? host, init(x, y, o, 2)),
    wheel: (x, y, deltaY, o = {}) => fireEvent.wheel(o.target ?? host, { ...init(x, y, o, 0), deltaY, deltaMode: o.deltaMode ?? 0 }),
    pointerAt: (type, clientX, clientY, o = {}) => fireEvent[type](o.target ?? host, { ...init(0, 0, o, type === "pointerUp" ? 0 : 1), clientX, clientY }),
    dragOver: (x, y, dataTransfer) => fireDrag("dragover", x, y, dataTransfer),
    drop: (x, y, dataTransfer) => fireDrag("drop", x, y, dataTransfer),
    drag(from, to, o) {
      rig.down(from[0], from[1], o);
      const mid = [from[0] + (to[0] - from[0]) / 2, from[1] + (to[1] - from[1]) / 2] as const;
      rig.move(mid[0], mid[1], o);
      rig.move(to[0], to[1], o);
      rig.up(to[0], to[1], o);
    },
    handle(name) {
      const el = host.querySelector<HTMLElement>(`[data-cf-handle="${name}"]`);
      if (!el) throw new Error(`no selection handle "${name}" is shown`);
      return el;
    },
  };
  return rig;
}

/** The active page of the open design. */
export const currentPage = () => getActivePage(useEditor.getState())!;

/** The element with this id in the open design (as it is now, not as it was when the test began). */
export function elementOf<T extends DesignElement = DesignElement>(id: ID): T {
  const el = findElement(currentPage(), id);
  if (!el) throw new Error(`element ${id} is not on the page`);
  return el as T;
}

/** Select elements the way a click would, outside any gesture. */
export const selectIds = (...ids: ID[]) => act(() => getActions().select(ids));

/** A bounding box of the element as [x, y, width, height]: handy for toEqual checks. */
export const boxOf = (id: ID): [number, number, number, number] => {
  const e = elementOf(id);
  return [e.x, e.y, e.width, e.height];
};
