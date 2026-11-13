/**
 * What an element must have for the renderer to draw it without throwing: a place and a size that are numbers, and what its kind
 * needs (a text its paragraphs and font, a line its stroke, a chart its series). Everything that brings an element in from outside
 * asks here: a project file, a backup, the clipboard and a drop (src/export/projectFormat.ts), and a shared design, on the server
 * and in the browser (src/collab/protocol.ts). It is one table so that the two cannot drift apart: an element that a file may
 * hold is one that people editing together may send, and the other way round.
 *
 * It is a cheap check of the form, not of the content: what an address, a colour or a blend mode may be is checked where the
 * content is walked. A property that is not in the table is not looked at. No DOM and no Node API: the server bundles this.
 */
import { svgProblem } from "./svgSafety";
import type { DesignElement, ElementType } from "./types";

/** What a property that an element needs must be. */
export type PropertyKind = "number" | "string" | "string or null" | "list" | "list that is not empty" | "object";

const PLACE = { x: "number", y: "number", width: "number", height: "number", rotation: "number", opacity: "number" } as const;

/** For every kind of element, the properties it cannot be drawn without, and what each must be. */
export const REQUIRED_PROPERTIES: Readonly<Record<ElementType, Readonly<Record<string, PropertyKind>>>> = {
  text: { ...PLACE, paragraphs: "list", fontFamily: "string", fontSize: "number", fontWeight: "number", lineHeight: "number", effect: "object" },
  shape: { ...PLACE, shape: "string" },
  line: { ...PLACE, stroke: "object" },
  image: { ...PLACE, crop: "object", filter: "object", src: "string or null", mask: "string" },
  graphic: { ...PLACE, svg: "string", viewW: "number", viewH: "number", colors: "object" },
  group: { ...PLACE, children: "list" },
  table: { ...PLACE, cells: "list", colWidths: "list", rowHeights: "list", fontFamily: "string" },
  chart: { ...PLACE, labels: "list", series: "list", palette: "list that is not empty" },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const IS: Record<PropertyKind, (v: unknown) => boolean> = {
  number: isNum,
  string: (v) => typeof v === "string",
  "string or null": (v) => v === null || typeof v === "string",
  list: Array.isArray,
  "list that is not empty": (v) => Array.isArray(v) && v.length > 0,
  object: isObject,
};

const A: Record<PropertyKind, string> = {
  number: "a number",
  string: "text",
  "string or null": "text or nothing",
  list: "a list",
  "list that is not empty": "a list that is not empty",
  object: "an object",
};

/**
 * What is wrong with an element, in a few words that name the property, or null when the renderer can draw it. It looks at the
 * element itself: what a group holds is asked about one by one, by whoever walks the group.
 */
export function elementProblem(el: unknown): string | null {
  if (!isObject(el)) return "an element is an object";
  if (typeof el.id !== "string") return "an element needs an id";
  if (typeof el.type !== "string" || !Object.hasOwn(REQUIRED_PROPERTIES, el.type)) return "an element needs a kind that exists";
  const type = el.type as ElementType;
  for (const [name, kind] of Object.entries(REQUIRED_PROPERTIES[type])) {
    if (!IS[kind](el[name])) return `${name} of a ${type} must be ${A[kind]}`;
  }
  // (a stroke was found to be an object by the table)
  if (type === "line" && !isNum((el.stroke as Record<string, unknown>).width)) return "the width of the stroke of a line must be a number";
  // The markup is drawn and written into exported files as it is, so only plain drawing comes in (every graphic the app makes is
  // that). One with no markup at all draws nothing and is let through.
  if (type === "graphic" && el.svg !== "") {
    const problem = svgProblem(el.svg as string);
    if (problem) return `svg of a graphic must be plain drawing (${problem})`;
  }
  return null;
}

/** Cheap structural check so a hand edited / foreign file cannot crash the renderer. */
export function isUsableElement(el: unknown): el is DesignElement {
  return elementProblem(el) === null;
}
