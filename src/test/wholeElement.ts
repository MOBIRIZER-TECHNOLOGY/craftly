/**
 * An element as the editor makes one, as it looks after a trip over the wire, with one thing or another changed. What arrives
 * from a browser or a server is refused when an element lacks what its kind needs (src/core/usableElement.ts), so a test that
 * wants to show that something else is refused (a script for a picture, a blend mode that does not exist) has to start from an
 * element that is whole: otherwise it is refused for what is missing, and the test says nothing about what it names.
 */
import { createChart, createGraphic, createGroup, createImage, createLine, createShape, createTable, createText, createVideo } from "@/core/factory";
import type { DesignElement, ElementType } from "@/core/types";

const MAKE: Record<ElementType, () => DesignElement> = {
  text: () => createText({ text: "Text" }),
  shape: () => createShape("rect"),
  line: () => createLine(),
  image: () => createImage({ src: null }),
  graphic: () => createGraphic({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>' }),
  group: () => createGroup([]),
  table: () => createTable(),
  chart: () => createChart(),
  video: () => createVideo({ src: "asset:clip", naturalWidth: 640, naturalHeight: 360, duration: 4 }),
};

/** One element of each kind, as the factory makes it. */
export const oneOfEach = (): DesignElement[] => (Object.keys(MAKE) as ElementType[]).map((type) => MAKE[type]());

/**
 * The element of the kind `type` (a shape when none is named) with the given properties laid over it, as plain JSON. The children
 * of a group are made whole the same way. A property given as `undefined` is taken out, which is how a test says "without this".
 */
export function whole(given: Record<string, unknown> = {}): Record<string, unknown> {
  const type = typeof given.type === "string" && Object.hasOwn(MAKE, given.type) ? (given.type as ElementType) : "shape";
  const made = JSON.parse(JSON.stringify(MAKE[type]())) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...made, ...given };
  if (Array.isArray(given.children)) out.children = given.children.map((child) => whole(child as Record<string, unknown>));
  for (const name of Object.keys(out)) if (out[name] === undefined) delete out[name];
  return out;
}
