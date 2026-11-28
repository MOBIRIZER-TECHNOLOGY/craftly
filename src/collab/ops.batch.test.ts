/**
 * applyOps on big batches: a run of property changes or of deletions is applied in one walk of each page, and must come out
 * exactly as the same operations applied one by one (applyOp); and a batch that would take too much work is refused whole
 * (`limits.work`), so that one message cannot hold the server still.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createGroup, createPage, createShape } from "@/core/factory";
import type { Design, DesignElement } from "@/core/types";
import { applyOp, applyOps, TooMuchWork, type Op } from "./ops";

/** A small seeded generator, so that a failure can be run again. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** A design of two or three pages (two of them may share an id) with groups in groups and, now and then, an id used twice. */
function messyDesign(r: () => number): { design: Design; ids: string[]; pages: string[] } {
  const ids: string[] = [];
  let n = 0;
  const id = () => {
    // one in eight takes an id that is there already: a design that came with two of one id
    const reuse = ids.length && r() < 0.125;
    const out = reuse ? ids[Math.floor(r() * ids.length)] : `e${n++}`;
    ids.push(out);
    return out;
  };
  const elements = (depth: number): DesignElement[] =>
    Array.from({ length: 2 + Math.floor(r() * 5) }, () =>
      depth < 3 && r() < 0.3 ? createGroup(elements(depth + 1), { id: id() }) : createShape("rect", { id: id(), x: Math.floor(r() * 100) }),
    );
  const pageIds = r() < 0.3 ? ["p1", "p1", "p2"] : ["p1", "p2", "p3"];
  const design = { ...createDesign({ width: 800, height: 600 }), pages: pageIds.map((pid) => ({ ...createPage(), id: pid, elements: elements(0) })) };
  return { design, ids, pages: pageIds };
}

function randomRun(r: () => number, ids: string[], pages: string[], kind: "el.set" | "el.del"): Op[] {
  return Array.from({ length: 1 + Math.floor(r() * 12) }, (): Op => {
    const page = r() < 0.1 ? "nowhere" : pages[Math.floor(r() * pages.length)];
    const target = r() < 0.1 ? "missing" : ids[Math.floor(r() * ids.length)];
    if (kind === "el.del") return { k: "el.del", page, id: target };
    const which = r();
    // a change of a property, one that sets what is there already, one that takes a property away, or one that tries a fixed field
    if (which < 0.6) return { k: "el.set", page, id: target, set: { x: Math.floor(r() * 50), opacity: r() < 0.5 ? 1 : 0.5 } };
    if (which < 0.8) return { k: "el.set", page, id: target, unset: ["name"], set: { name: r() < 0.5 ? "a" : "b" } };
    if (which < 0.9) return { k: "el.set", page, id: target, unset: ["name"] };
    return { k: "el.set", page, id: target, set: { id: "stolen", type: "text", children: [] } };
  });
}

const oneByOne = (design: Design, ops: readonly Op[]) => ops.reduce(applyOp, design);

describe("a run of changes or deletions applied in one walk", () => {
  it("comes out as the same operations one by one, on 3,000 messy designs and batches", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rng(seed);
      const { design, ids, pages } = messyDesign(r);
      // runs of both kinds, one after the other, and now and then another operation between them, which ends a run
      const ops: Op[] = [];
      for (let k = 0; k < 4; k++) {
        ops.push(...randomRun(r, ids, pages, r() < 0.5 ? "el.set" : "el.del"));
        if (r() < 0.3) ops.push({ k: "design", set: { title: `t${k}` } });
      }
      const batched = applyOps(design, ops);
      const single = oneByOne(design, ops);
      expect(batched, `seed ${seed}`).toEqual(single);
    }
  });

  it("gives back the very same design when nothing in the run changes anything", () => {
    const { design } = messyDesign(rng(7));
    expect(applyOps(design, [{ k: "el.set", page: "p1", id: "missing", set: { x: 1 } }])).toBe(design);
    expect(applyOps(design, [{ k: "el.del", page: "nowhere", id: "e1" }])).toBe(design);
  });

  it("keeps the pages and elements it did not touch as they were (structural sharing)", () => {
    const { design } = messyDesign(rng(11));
    const first = design.pages[0].elements[0];
    const out = applyOps(design, [{ k: "el.set", page: design.pages[0].id, id: first.id, set: { x: 999 } }]);
    expect(out.pages[0].elements[0]).not.toBe(first);
    expect(out.pages[0].elements.slice(1)).toEqual(design.pages[0].elements.slice(1));
    for (let i = 1; i < design.pages[0].elements.length; i++) expect(out.pages[0].elements[i]).toBe(design.pages[0].elements[i]);
    expect(out.pages[2]).toBe(design.pages[2]);
  });

  it("lets an addition later in the batch take an id that a deletion of the run freed", () => {
    const design = { ...createDesign({ width: 800, height: 600 }), pages: [{ ...createPage(), id: "p", elements: [createShape("rect", { id: "a" })] }] };
    const ops: Op[] = [
      { k: "el.add", page: "p", parent: null, index: 1, el: createShape("rect", { id: "b" }) },
      { k: "el.del", page: "p", id: "a" },
      { k: "el.add", page: "p", parent: null, index: 0, el: createShape("rect", { id: "a", x: 5 }) },
    ];
    expect(applyOps(design, ops)).toEqual(oneByOne(design, ops));
    expect(applyOps(design, ops).pages[0].elements.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("the work a batch may take", () => {
  const N = 100_000;
  const big = (): Design => ({
    ...createDesign({ width: 1920, height: 1080 }),
    pages: [{ ...createPage(), id: "p", elements: Array.from({ length: N }, (_, i) => createShape("rect", { id: `e${i}` })) }],
  });

  it("is cheap for a whole selection dragged on a page of 100,000 elements, one change for each", () => {
    const design = big();
    const ops: Op[] = Array.from({ length: 10_000 }, (_, i) => ({ k: "el.set", page: "p", id: `e${i * 10}`, set: { x: i } }));
    const t = performance.now();
    const out = applyOps(design, ops, { work: 2_000_000 });
    expect(performance.now() - t).toBeLessThan(500);
    expect((out.pages[0].elements[10] as { x: number }).x).toBe(1);
  });

  it("is cheap for 10,000 changes to the last element of that page, the hostile case", () => {
    const design = big();
    const ops: Op[] = Array.from({ length: 10_000 }, (_, i) => ({ k: "el.set", page: "p", id: `e${N - 1}`, set: { x: i + 1 } }));
    const out = applyOps(design, ops, { work: 2_000_000 });
    expect((out.pages[0].elements[N - 1] as { x: number }).x).toBe(10_000);
  });

  it("refuses a batch that moves the last element back and forth until it would take seconds, and changes nothing", () => {
    const design = big();
    const ops: Op[] = Array.from({ length: 2000 }, (_, i) => ({ k: "el.move", page: "p", id: `e${N - 1}`, parent: null, index: i % 2 ? 0 : N }));
    const t = performance.now();
    expect(() => applyOps(design, ops, { work: 20_000_000 })).toThrow(TooMuchWork);
    const stopped = performance.now() - t;
    expect(design.pages[0].elements[N - 1].id).toBe(`e${N - 1}`);
    // it stopped at the limit, long before the whole batch would have finished (measured on the same machine, so that a slow
    // one, such as CI's with coverage, is weighed against itself)
    const w = performance.now();
    applyOps(big(), ops);
    expect(stopped).toBeLessThan((performance.now() - w) / 2);
  }, 30_000);

  it("refuses 2,000 additions at the front of that page the same way", () => {
    const design = big();
    const ops: Op[] = Array.from({ length: 2000 }, (_, i) => ({ k: "el.add", page: "p", parent: null, index: 0, el: createShape("rect", { id: `n${i}` }) }));
    expect(() => applyOps(design, ops, { work: 20_000_000 })).toThrow(TooMuchWork);
  });

  it("does not hold a limit over to the next batch, or to one given none", () => {
    const design = big();
    const heavy: Op[] = Array.from({ length: 300 }, (_, i) => ({ k: "el.add", page: "p", parent: null, index: 0, el: createShape("rect", { id: `m${i}` }) }));
    expect(() => applyOps(design, heavy, { work: 1000 })).toThrow(TooMuchWork);
    expect(applyOps(design, heavy).pages[0].elements).toHaveLength(N + 300);
  });
});
