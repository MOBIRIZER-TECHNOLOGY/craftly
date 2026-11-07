/**
 * Helpers of the "contextual UI" tests (the panels that replace the side panel for a selection, and the toolbars around
 * it): open a design with known elements, select by id, host the context panel the store asks for, and mount the whole
 * editor together with the overlays the app shell normally provides.
 */
import { act, createEvent, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import { saveDesign } from "@/core/library";
import { findElement } from "@/core/ops";
import { getActivePage, useEditor, type ContextPanelState } from "@/core/store";
import type { Design, DesignElement, ID, Page } from "@/core/types";
import { Editor } from "@/editor/Editor";
import { ContextPanel } from "@/editor/panels/context";
import { ContextMenuHost } from "@/ui";
import { flush } from "./helpers";

export const store = () => useEditor.getState();

/** Opens a design whose first page holds `elements` (more pages after it) and selects `selected` (elements or ids). */
export function openElements(elements: DesignElement[], opts: { selected?: Array<DesignElement | ID>; pages?: Page[]; width?: number; height?: number } = {}): Design {
  const design = createDesign({ title: "ctx design", width: opts.width ?? 1000, height: opts.height ?? 600, pages: [createPage({ elements }), ...(opts.pages ?? [])] });
  act(() => {
    store().actions.openDesign(design);
    if (opts.selected) store().actions.select(opts.selected.map((e) => (typeof e === "string" ? e : e.id)));
  });
  return design;
}

/** Select these elements (ids or elements) in the open design. */
export function selectElements(...items: Array<DesignElement | ID>): void {
  act(() => store().actions.select(items.map((e) => (typeof e === "string" ? e : e.id))));
}

/** The live version of an element of the active page, also when it sits inside a group. */
export function live<T extends DesignElement = DesignElement>(item: DesignElement | ID): T {
  const id = typeof item === "string" ? item : item.id;
  const page = getActivePage(store());
  const el = page ? findElement(page, id) : null;
  if (!el) throw new Error(`element ${id} is not on the active page`);
  return el as T;
}

/** Ids of the active page's elements in paint order (the last one is on top). */
export const paintOrder = (): ID[] => (getActivePage(store())?.elements ?? []).map((e) => e.id);

/** Shows whatever context panel the store asks for, like the side panel does. */
export function ContextHost() {
  const context = useEditor((s) => s.context);
  return context ? <ContextPanel state={context} /> : null;
}

/** Renders the context host and opens `panel` in it. */
export function showPanel(panel: ContextPanelState): RenderResult {
  const view = render(<ContextHost />);
  act(() => store().actions.openContext(panel));
  return view;
}

/** Mounts the whole editor on a saved design, with the context menu host the app shell would add. */
export async function mountEditorOn(design: Design): Promise<RenderResult> {
  await saveDesign(design);
  const view = render(
    <>
      <Editor designId={design.id} />
      <ContextMenuHost />
    </>,
  );
  await waitFor(() => expect(useEditor.getState().design?.id).toBe(design.id), { timeout: 10_000 });
  await flush();
  return view;
}

/** Types `text` into a number field the way a person does: focus, replace the text, press Enter. */
export async function typeNumber(user: UserEvent, input: HTMLElement, text: string): Promise<void> {
  await user.click(input);
  await user.clear(input);
  await user.type(input, `${text}{Enter}`);
}

/** Drag-and-drop events carry a DataTransfer that jsdom does not have: a plain stand-in records what the code sets. */
export function fakeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    data,
    effectAllowed: "",
    dropEffect: "",
    types: ["text/plain"],
    files: [] as File[],
    setData: (type: string, value: string) => void (data[type] = value),
    getData: (type: string) => data[type] ?? "",
    setDragImage: () => undefined,
  };
}

/** One drag event with a DataTransfer stand-in; jsdom has no DragEvent, so `clientY` is attached by hand. */
export function dragEvent(
  type: "dragStart" | "dragOver" | "dragEnter" | "dragLeave" | "drop" | "dragEnd",
  target: Element,
  dataTransfer: ReturnType<typeof fakeDataTransfer>,
  clientY = 0,
  relatedTarget: Node | null = null,
): void {
  const event = createEvent[type](target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
  fireEvent(target, event);
}

/** Fires a drag gesture from `grip` onto `target` (a list row): start, over (at `clientY`), drop, end. */
export function dragOnto(grip: Element, target: Element, clientY: number): void {
  const dataTransfer = fakeDataTransfer();
  dragEvent("dragStart", grip, dataTransfer);
  dragEvent("dragOver", target, dataTransfer, clientY);
  dragEvent("drop", target, dataTransfer, clientY);
  dragEvent("dragEnd", grip, dataTransfer);
}

/** jsdom has no `DOMMatrix`, which the pattern painter uses to scale a pattern. Pair with `vi.unstubAllGlobals()`. */
export function stubDomMatrix(): void {
  class FakeMatrix {
    factor = 1;
    scale(factor: number): this {
      this.factor = factor;
      return this;
    }
  }
  vi.stubGlobal("DOMMatrix", FakeMatrix);
}
