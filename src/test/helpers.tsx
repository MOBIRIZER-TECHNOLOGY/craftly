/**
 * Shared helpers for the component tests: a clean store, a realistic sample design, a fake layout and a way to mount
 * the whole editor on a design that lives in the (fake) IndexedDB.
 */
import { act, render, waitFor, type RenderResult } from "@testing-library/react";
import { expect, vi } from "vitest";
import { openDb } from "@/core/persistence";
import { saveDesign } from "@/core/library";
import { createDesign, createGroup, createImage, createPage, createShape, createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { Editor } from "@/editor/Editor";

/** Put the editor store back to how it is when the app starts (no design open). */
export function resetEditor(): void {
  useEditor.setState(useEditor.getInitialState(), true);
}

/** Empty every IndexedDB store the app uses. */
export async function clearLibrary(): Promise<void> {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const req = db.transaction(name, "readwrite").objectStore(name).clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        }),
    ),
  );
}

/** A two page design with text, a shape, an image and a group: enough to give every panel something to show. */
export function sampleDesign(overrides: Partial<Pick<Design, "id" | "title" | "width" | "height">> = {}): Design {
  const title = createText({ text: "Hello Craftly", fontSize: 96, x: 80, y: 60, width: 700 });
  const box = createShape("rect", { x: 100, y: 300, width: 300, height: 200 });
  const photo = createImage({ src: "https://example.test/photo.jpg", x: 500, y: 300, width: 320, height: 240, naturalWidth: 640, naturalHeight: 480 });
  const group = createGroup([createShape("ellipse", { x: 0, y: 0, width: 120, height: 120 }), createText({ text: "Inside", x: 10, y: 130, width: 200 })], { x: 900, y: 80 });
  const first = createPage({ name: "Cover", elements: [title, box, photo, group] });
  const second = createPage({ name: "Details", elements: [createText({ text: "Page two", x: 80, y: 80, width: 600 })] });
  return { ...createDesign({ title: "Sample", width: 1280, height: 720, pages: [first, second] }), ...overrides };
}

/** Give every element a box: jsdom lays nothing out, so rects are 0 x 0 unless a test says otherwise. */
export function stubLayout(width = 1000, height = 700): () => void {
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) } as DOMRect;
  });
  const w = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  const h = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
  return () => {
    spy.mockRestore();
    w.mockRestore();
    h.mockRestore();
  };
}

/** Let pending promises, microtasks and effects settle. */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => void (await Promise.resolve()));
}

/**
 * Save `design` to the library and mount the whole editor on it, resolving once it has loaded.
 * Remember to `stubLayout()` first when the test needs a workspace with a size.
 */
export async function mountEditor(design: Design = sampleDesign()): Promise<RenderResult & { design: Design }> {
  await saveDesign(design);
  const view = render(<Editor designId={design.id} />);
  await waitFor(() => expect(useEditor.getState().design?.id).toBe(design.id), { timeout: 10_000 });
  await flush();
  return Object.assign(view, { design });
}
