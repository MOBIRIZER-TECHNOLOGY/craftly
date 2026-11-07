import { describe, expect, it } from "vitest";
import { createDesign, createGraphic, createImage, createLine, createPage, createShape, createText, solid } from "./factory";
import { flatten } from "./ops";
import { useEditor } from "./store";
import type { Design } from "./types";

/** Small deterministic PRNG so failures are reproducible from the seed. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const strip = (d: Design) => JSON.stringify({ ...d, updatedAt: 0 });

function seedDesign(): Design {
  const mk = () =>
    createPage({
      elements: [
        createShape("rect", { x: 100, y: 100, width: 300, height: 200, fill: solid("#7c3aed") }),
        createShape("ellipse", { x: 500, y: 200, width: 200, height: 200 }),
        createText({ text: "Hello world", x: 200, y: 450, width: 400, autoWidth: false, fontSize: 40 }),
        createLine({ x: 100, y: 700, width: 500 }),
        createImage({ src: "builtin:sunset-hills", naturalWidth: 1600, naturalHeight: 1067, x: 800, y: 100, width: 400, height: 300 }),
        createGraphic({
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ff0000"/></svg>',
          x: 900,
          y: 500,
          width: 100,
          height: 100,
        }),
      ],
    });
  return createDesign({ width: 1920, height: 1080, pages: [mk(), mk()] });
}

function run(seed: number, steps: number) {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const a = () => useEditor.getState().actions;
  const s = () => useEditor.getState();

  const initial = seedDesign();
  a().openDesign(initial);
  const baseline = strip(s().design!);

  const page = () => s().design!.pages.find((p) => p.id === s().activePageId)!;
  const ids = () => page().elements.map((e) => e.id);
  const randomSelection = () => {
    const all = ids();
    if (!all.length) return [];
    const n = 1 + Math.floor(rnd() * Math.min(3, all.length));
    return Array.from(new Set(Array.from({ length: n }, () => pick(all))));
  };

  const ops: Array<() => void> = [
    () => a().select(randomSelection()),
    () => a().updateSelection({ x: Math.round(rnd() * 1500), y: Math.round(rnd() * 800) }),
    () => a().updateSelection({ opacity: Math.round(rnd() * 100) / 100 }, { coalesce: "opacity" }),
    () => a().updateSelection({ rotation: Math.round(rnd() * 360) }),
    () => a().nudge(Math.round(rnd() * 20 - 10), Math.round(rnd() * 20 - 10)),
    () => a().duplicateSelection(),
    () => a().deleteElements(),
    () => a().groupSelection(),
    () => a().ungroupSelection(),
    () => a().arrange(pick(["forward", "backward", "front", "back"] as const)),
    () => a().align(pick(["left", "center", "right", "top", "middle", "bottom"] as const), pick(["page", "selection"] as const)),
    () => a().flip(pick(["horizontal", "vertical"] as const)),
    () => a().setLocked(randomSelection(), rnd() > 0.5),
    () => a().setHidden(randomSelection(), rnd() > 0.7),
    () => {
      const t = page().elements.find((e) => e.type === "text");
      if (t) a().setTextParagraphs(t.id, [{ runs: [{ text: "x".repeat(1 + Math.floor(rnd() * 40)) }] }, { runs: [{ text: "second", bold: true }] }]);
    },
    () => a().setTextProps(randomSelection(), { fontSize: 20 + Math.round(rnd() * 60), align: pick(["left", "center", "right"] as const) }),
    () => a().addElement(createShape(pick(["star", "heart", "rect", "hexagon"]), { width: 100 + Math.round(rnd() * 100), height: 100 })),
    () => a().addPage(),
    () => a().duplicatePage(),
    () => a().deletePage(),
    () => a().setActivePage(pick(s().design!.pages).id),
    () => a().movePage(pick(s().design!.pages).id, Math.floor(rnd() * 3)),
    () => a().copy(),
    () => a().paste(),
    () => a().cut(),
    () => a().resizeDesign(1000 + Math.round(rnd() * 1000), 600 + Math.round(rnd() * 800), rnd() > 0.5),
    () =>
      a().setPageBackground(
        solid(
          "#" +
            Math.floor(rnd() * 0xffffff)
              .toString(16)
              .padStart(6, "0"),
        ),
      ),
    () => {
      a().beginTransaction();
      for (let i = 0; i < 5; i++) a().updateSelection({ x: Math.round(rnd() * 1000) });
      a().endTransaction();
    },
  ];

  let performed = 0;
  for (let i = 0; i < steps; i++) {
    pick(ops)();
    performed++;
    // invariants after every step
    const d = s().design!;
    const seen = new Set<string>();
    for (const p of d.pages) {
      for (const e of flatten(p.elements)) {
        if (seen.has(e.id)) throw new Error(`seed ${seed} step ${i}: duplicate element id ${e.id}`);
        seen.add(e.id);
        if (!Number.isFinite(e.x + e.y + e.width + e.height + e.rotation)) throw new Error(`seed ${seed} step ${i}: non-finite geometry on ${e.id}`);
      }
    }
    if (new Set(d.pages.map((p) => p.id)).size !== d.pages.length) throw new Error(`seed ${seed} step ${i}: duplicate page ids`);
    if (!d.pages.some((p) => p.id === s().activePageId)) throw new Error(`seed ${seed} step ${i}: active page missing`);
    const present = new Set(flatten(page().elements).map((e) => e.id));
    for (const id of s().selection) if (!present.has(id)) throw new Error(`seed ${seed} step ${i}: selected id ${id} not on the page`);
  }

  const final = strip(s().design!);
  // undo everything: the document must return to the opened state, exactly
  let guard = 0;
  while (s().canUndo && guard++ < 5000) a().undo();
  expect(strip(s().design!) === baseline, `seed ${seed}: undoing every step must restore the opened document`).toBe(true);
  // redo everything: the document must return to the final state, exactly
  guard = 0;
  while (s().canRedo && guard++ < 5000) a().redo();
  expect(strip(s().design!) === final, `seed ${seed}: redoing every step must restore the final document`).toBe(true);
  return performed;
}

describe("store fuzz", () => {
  for (const seed of [1, 2, 3, 7, 11, 42, 99, 2024]) {
    it(`keeps invariants and a perfect history over 100 random edits (seed ${seed})`, () => {
      // stay within the 120-entry history cap so "undo everything" is well defined
      expect(run(seed, 100)).toBe(100);
    });
  }
});
