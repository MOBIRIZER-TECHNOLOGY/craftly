/**
 * scripts/budgets.mjs, on a small build written here: what each screen counts (its chunk, what that imports statically, its
 * CSS) and what it does not (dynamic imports, what an earlier screen fetched already), and that it fails when it cannot find
 * what it measures instead of measuring nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error: a script of plain JavaScript, without types
import { BUDGETS, measure } from "../../scripts/budgets.mjs";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function build(files: Record<string, string>, precache: string[] = []) {
  const dist = mkdtempSync(join(tmpdir(), "craftly-budgets-"));
  made.push(dist);
  mkdirSync(join(dist, "assets"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text);
  writeFileSync(join(dist, "precache.json"), JSON.stringify({ buildId: "x", files: precache }));
  return dist;
}
const gz = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length;
const filler = (n: number) => Array.from({ length: n }, (_, i) => `const v${i}=${i * 7919};`).join("");

const measured = (dist: string) => measure(dist) as { first: number; dashboard: number; editor: number; precache: number };

describe("the size budgets", () => {
  it("count each screen's chunk, its static imports and its CSS, once, and leave dynamic imports out", () => {
    const entry = `import{a}from"./shared-1.js";const l=()=>import("./Dashboard-1.js");${filler(50)}`;
    const shared = `export const a=1;${filler(80)}`;
    const dashboard = `import{a}from"./shared-1.js";import"./ui-1.js";const e=()=>import("./Editor-1.js");${filler(40)}`;
    const ui = `export const u=2;${filler(30)}`;
    const editor = `import{u}from"./ui-1.js";import{h}from"./heavy-1.js";${filler(60)}`;
    const heavy = `export const h=3;${filler(200)}`;
    const lazy = `export const later=4;${filler(500)}`;
    const css = `.editor{color:red}${".x{margin:0}".repeat(40)}`;
    const dist = build(
      {
        "index.html": '<script type="module" src="/assets/index-1.js"></script>',
        "assets/index-1.js": entry,
        "assets/shared-1.js": shared,
        "assets/Dashboard-1.js": dashboard,
        "assets/ui-1.js": ui,
        "assets/Editor-1.js": editor + `;const z=()=>import("./lazy-1.js")`,
        "assets/Editor-1.css": css,
        "assets/heavy-1.js": heavy,
        "assets/lazy-1.js": lazy,
      },
      ["assets/index-1.js", "assets/lazy-1.js"],
    );
    const sizes = measured(dist);
    expect(sizes.first).toBe(gz(entry) + gz(shared));
    // shared was fetched with the first load already
    expect(sizes.dashboard).toBe(gz(dashboard) + gz(ui));
    // ui was fetched with the dashboard; lazy is loaded on demand only
    expect(sizes.editor).toBe(gz(editor + `;const z=()=>import("./lazy-1.js")`) + gz(heavy) + gz(css));
    expect(sizes.precache).toBe(Buffer.byteLength(entry) + Buffer.byteLength(lazy));
  });

  it("stop with a message when the page names nothing, or a screen's chunk is not there", () => {
    expect(() => measured(build({ "index.html": "<p>nothing</p>" }))).toThrow(/names no script/);
    const noEditor = build({
      "index.html": '<script type="module" src="/assets/index-1.js"></script>',
      "assets/index-1.js": "1",
      "assets/Dashboard-1.js": "2",
    });
    expect(() => measured(noEditor)).toThrow(/Editor-\*\.js/);
  });

  it("have a budget for everything they measure", () => {
    expect(Object.keys(BUDGETS).sort()).toEqual(["dashboard", "editor", "first", "precache"]);
  });
});
