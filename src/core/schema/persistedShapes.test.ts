/**
 * Tripwires for "a stored shape changed". They do not decide anything: they make a change to what Craftly stores impossible
 * to make by accident, and say what to do next (docs/MIGRATIONS.md has the reasons and the recipe).
 *
 *   1. the shape of a design the code writes, with every optional field set (`completeDesign`, which the compiler checks
 *      against the types), is compared with the frozen design of the current version: a field the code writes now and the
 *      frozen design does not have, or the other way round, has to be named below, on purpose
 *   2. the same for the records beside designs: summary, folder, brand kit, saved version, upload
 *   3. nobody opens the library's database, or writes a format version, anywhere but where the steps are
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import records from "@/test/fixtures/schema/records-v1.json";
import { completeDesign, completeRecords } from "@/test/schema/complete";
import { CURRENT_DESIGN_VERSION } from "./design";

/** Every path of a document with the kinds of value found there ("$.pages[].elements[].fill: null|object"). Arrays are folded into `[]`. */
function shapeOf(value: unknown, skip: readonly string[] = []): string[] {
  const kinds = new Map<string, Set<string>>();
  const visit = (node: unknown, path: string) => {
    if (skip.includes(path)) return;
    const kind = node === null ? "null" : Array.isArray(node) ? "array" : typeof node;
    (kinds.get(path) ?? kinds.set(path, new Set()).get(path)!).add(kind);
    if (Array.isArray(node)) node.forEach((item) => visit(item, `${path}[]`));
    else if (kind === "object") for (const [key, child] of Object.entries(node as object)) visit(child, `${path}.${key}`);
  };
  visit(value, "$");
  return [...kinds].map(([path, set]) => `${path}: ${[...set].sort().join("|")}`).sort();
}

const difference = (a: string[], b: string[]) => a.filter((line) => !b.includes(line));

/**
 * What differs on purpose between the code and the frozen documents, and nothing else. Empty at the first version.
 * A line here is a decision for a review: a field that the code writes now and the frozen document lacks is optional for good
 * (older designs never get it), so everything that reads it needs a default; one that the code stopped writing may still be in
 * what is stored. Whatever is not optional is not a line here but a new version and a migration step.
 */
const ADDED: Record<string, string[]> = { design: [], summary: [], folder: [], brandKit: [], version: [], upload: [] };
const DROPPED: Record<string, string[]> = { design: [], summary: [], folder: [], brandKit: [], version: [], upload: [] };

const WHAT_NEXT =
  "\nIf the field is optional and every reader copes without it, name it in ADDED / DROPPED (src/core/schema/persistedShapes.test.ts).\n" +
  "If it is required, was renamed, or means something else, raise the version and add a migration step, with frozen documents of the new version (docs/MIGRATIONS.md).";

describe("the shape of a design", () => {
  const fixtures = import.meta.glob<Record<string, unknown>>("../../test/fixtures/schema/design-v*-full.json", { eager: true, import: "default" });
  const frozen = fixtures[`../../test/fixtures/schema/design-v${CURRENT_DESIGN_VERSION}-full.json`];
  const written = shapeOf(completeDesign());

  it("has a frozen design with every field for the current version", () => {
    expect(frozen, `raising CURRENT_DESIGN_VERSION needs src/test/fixtures/schema/design-v${CURRENT_DESIGN_VERSION}-full.json (src/test/fixtures/schema/README.md)`).toBeDefined();
  });

  it("is the shape the frozen design has, apart from what is named as added on purpose", () => {
    expect(difference(written, shapeOf(frozen)), `a design is now written with something the frozen design does not have:${WHAT_NEXT}`).toEqual(ADDED.design);
  });

  it("keeps everything the frozen design has, apart from what is named as dropped on purpose", () => {
    expect(difference(shapeOf(frozen), written), `a design is no longer written with something the frozen design has:${WHAT_NEXT}`).toEqual(DROPPED.design);
  });

  it("covers every kind of element, of page background and of fill", () => {
    const text = JSON.stringify(completeDesign());
    for (const type of ["text", "shape", "line", "image", "graphic", "group", "table", "chart"]) expect(text).toContain(`"type":"${type}"`);
    for (const type of ["solid", "linear", "radial", "pattern", "image"]) expect(text).toContain(`"type":"${type}"`);
  });
});

describe("the shape of the records beside designs", () => {
  const written = completeRecords();
  // the upload's picture is not JSON, and a saved version holds a design, which the tests above cover
  const { blob: _blob, ...uploadFields } = written.asset;

  it.each([
    ["summary", written.summary, records.summary, []],
    ["folder", written.folder, records.folder, []],
    ["brandKit", written.brandKit, records.brandKit, []],
    ["version", written.version, records.version, ["$.design"]],
    ["upload", uploadFields, records.asset, []],
  ])("%s is what the frozen record is, apart from what is named on purpose", (name, now, frozen, skip) => {
    const code = shapeOf(now, skip as string[]);
    const stored = shapeOf(frozen, skip as string[]);
    expect(difference(code, stored), `a ${name} record is now written with something the frozen one does not have:${WHAT_NEXT}`).toEqual(ADDED[name]);
    expect(difference(stored, code), `a ${name} record is no longer written with something the frozen one has:${WHAT_NEXT}`).toEqual(DROPPED[name]);
  });
});

describe("where formats and the database are touched", () => {
  /** Every source file that ships: not tests, not the test helpers, not the development pages. */
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return entry === "test" || entry === "dev" ? [] : sources(path);
      return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts") ? [path] : [];
    });
  }
  const code = (path: string) =>
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  const files = sources(join(process.cwd(), "src"));
  const here = (path: string) => relative(join(process.cwd(), "src"), path).split(sep).join("/");

  it("keeps the number of a format in one place: nothing else writes `version: <n>`, `craftly: <n>` or `craftlyBackup: <n>`", () => {
    const hardCoded = files.flatMap((path) =>
      code(path)
        .filter((line) => /\b(version|craftly|craftlyBackup):\s*\d/.test(line))
        .map((line) => `${here(path)}: ${line.trim()}`),
    );
    expect(hardCoded).toEqual([]);
  });

  it("opens the library's database in one place, the one that runs its steps (the model cache has its own database and is rebuilt from the network)", () => {
    const opening = files.filter((path) => code(path).some((line) => /indexedDB\.open\(/.test(line))).map(here);
    expect(opening.sort()).toEqual(["core/schema/database.ts", "ml/modelStore.ts"]);
  });
});
