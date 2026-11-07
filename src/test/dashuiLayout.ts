/**
 * Layout stand-ins for the UI-kit and dashboard tests. jsdom lays nothing out: every box is 0 x 0, `offsetWidth` is 0 and
 * `getClientRects()` is empty. These helpers give chosen elements a box (no heavy imports, so pure tests can use them).
 */
import { vi } from "vitest";

/** A DOMRect-like box. */
export function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

/**
 * Gives chosen elements a box. `resolve` returns the box of an element (or null for "no box": 0 x 0). Everything else
 * stays 0 x 0, which is what jsdom reports. Returns a function that undoes the stub.
 */
export function stubRects(resolve: (el: Element) => DOMRect | null): () => void {
  const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return resolve(this) ?? rect(0, 0, 0, 0);
  });
  return () => spy.mockRestore();
}

/**
 * `getTabbables` treats an element with no `offsetWidth` / `offsetHeight` and no client rects as hidden, which is every
 * element in jsdom. This makes elements count as visible. Returns an undo function.
 */
export function stubOffsets(width = 100, height = 24): () => void {
  const w = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
  const h = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
  return () => {
    w.mockRestore();
    h.mockRestore();
  };
}

/**
 * Gives every element the same size, for components that wait for a measured width before they draw (the template
 * masonry). `getBoundingClientRect`, `clientWidth` and `clientHeight` all report it. Returns an undo function.
 */
export function stubBox(width: number, height = 700): () => void {
  const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => rect(0, 0, width, height));
  const w = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  const h = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
  return () => {
    rectSpy.mockRestore();
    w.mockRestore();
    h.mockRestore();
  };
}
