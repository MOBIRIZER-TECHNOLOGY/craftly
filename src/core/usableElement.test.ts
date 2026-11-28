/**
 * What an element must have for the renderer to draw it: the one check that a project file, a backup, the clipboard, a drop and a
 * shared design all go through. Whatever the app itself makes has to pass it, or a design of the app's own would be refused.
 */
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/data/templates";
import { completeDesign, minimalDesign } from "@/test/schema/complete";
import { oneOfEach, whole } from "@/test/wholeElement";
import type { DesignElement } from "./types";
import { elementProblem, isUsableElement, REQUIRED_PROPERTIES } from "./usableElement";

const every = (elements: readonly DesignElement[], visit: (el: DesignElement) => void): void => {
  for (const el of elements) {
    visit(el);
    if (el.type === "group") every(el.children, visit);
  }
};

describe("what the app makes", () => {
  it("is usable: one element of each kind, as the factory makes it", () => {
    for (const el of oneOfEach()) expect(elementProblem(JSON.parse(JSON.stringify(el))), el.type).toBeNull();
  });

  it("is usable: every element of the design that has every field, and of the smallest design", () => {
    let seen = 0;
    for (const design of [completeDesign() as unknown as { pages: { elements: DesignElement[] }[] }, minimalDesign()]) {
      for (const page of design.pages)
        every(page.elements, (el) => {
          seen++;
          expect(elementProblem(el), el.id).toBeNull();
        });
    }
    expect(seen).toBeGreaterThan(8);
  });

  it("is usable: every element of every template", () => {
    let seen = 0;
    const kinds = new Set<string>();
    for (const template of TEMPLATES) {
      for (const page of template.pages)
        every(page.elements, (el) => {
          seen++;
          kinds.add(el.type);
          const problem = elementProblem(el);
          if (problem) throw new Error(`${template.id}, element ${el.id}: ${problem}`);
        });
    }
    expect(seen).toBeGreaterThan(1000);
    expect(kinds.size).toBeGreaterThan(3);
  });
});

describe("what is wrong with an element", () => {
  const BAD: Record<string, unknown[]> = {
    number: ["1", null, undefined, Number.NaN, Infinity, [1], {}],
    string: [5, null, undefined, ["a"], {}],
    "string or null": [5, undefined, {}, false],
    list: [5, "a", null, undefined, {}],
    "list that is not empty": [5, "a", null, undefined, {}, []],
    object: [5, "a", null, undefined, [1]],
  };

  it("has a table that names every kind of element, and the place and size of each", () => {
    expect(Object.keys(REQUIRED_PROPERTIES).sort()).toEqual(["chart", "graphic", "group", "image", "line", "shape", "table", "text", "video"]);
    for (const needs of Object.values(REQUIRED_PROPERTIES))
      expect(needs).toMatchObject({ x: "number", y: "number", width: "number", height: "number", rotation: "number", opacity: "number" });
  });

  it("names the property that is missing or of the wrong kind, for every property an element of each kind needs", () => {
    let tried = 0;
    for (const [type, needs] of Object.entries(REQUIRED_PROPERTIES)) {
      for (const [name, kind] of Object.entries(needs)) {
        for (const bad of BAD[kind]) {
          tried++;
          const el = whole({ type, [name]: bad });
          if (bad === undefined) expect(Object.hasOwn(el, name)).toBe(false);
          expect(elementProblem(el), `${type}.${name} = ${JSON.stringify(bad)}`).toMatch(new RegExp(`\\b${name}\\b`));
          expect(isUsableElement(el)).toBe(false);
        }
      }
    }
    expect(tried).toBeGreaterThan(200);
  });

  it.each<[string, unknown]>([
    ["nothing", null],
    ["a number", 5],
    ["a list", [whole()]],
    ["an element with no id", whole({ id: undefined })],
    ["an element whose id is a number", whole({ id: 5 })],
    ["an element of no kind", whole({ type: undefined })],
    ["an element of a kind that does not exist", { ...whole(), type: "script" }],
    ["an element of a kind that every object has", { ...whole(), type: "constructor" }],
    ["a line whose stroke has no width", whole({ type: "line", stroke: { color: "#000" } })],
    ["a line whose stroke has a width that is text", whole({ type: "line", stroke: { color: "#000", width: "6" } })],
    ["a graphic whose markup runs code", whole({ type: "graphic", svg: '<svg/onload="alert(1)"/>' })],
    ["a graphic whose markup is not markup", whole({ type: "graphic", svg: "hello" })],
  ])("refuses %s", (_what, el) => {
    expect(typeof elementProblem(el)).toBe("string");
    expect(isUsableElement(el)).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a frame with no picture yet", whole({ type: "image", src: null })],
    ["a graphic with no markup yet", whole({ type: "graphic", svg: "" })],
    ["a shape with no fill and no outline", whole({ fill: null, stroke: null })],
    ["a group with nothing in it", whole({ type: "group", children: [] })],
    ["an element with a property nobody knows", whole({ somethingNew: { a: [1, 2] } })],
    ["a text with no paragraphs in its list", whole({ type: "text", paragraphs: [] })],
  ])("accepts %s", (_what, el) => {
    expect(elementProblem(el)).toBeNull();
    expect(isUsableElement(el)).toBe(true);
  });

  it("looks at the element itself and not at what a group holds: each child is asked about on its own", () => {
    expect(elementProblem(whole({ type: "group", children: [{ type: "shape", x: "a" }] }))).toBeNull();
  });
});
