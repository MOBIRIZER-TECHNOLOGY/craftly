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
import syncRecord from "@/test/fixtures/schema/sync-record-v2.json";
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
/** A line's `start` and `end` (2026-11-09, src/core/connectors.ts): the elements that an end is attached to. Optional for good: an older design has free ends. */
const LINE_ATTACHMENTS = [
  "$.pages[].elements[].children[].end.anchor: string",
  "$.pages[].elements[].children[].end.elementId: string",
  "$.pages[].elements[].children[].end: object",
  "$.pages[].elements[].children[].start.anchor: string",
  "$.pages[].elements[].children[].start.elementId: string",
  "$.pages[].elements[].children[].start: object",
  "$.pages[].elements[].end.anchor: string",
  "$.pages[].elements[].end.elementId: string",
  "$.pages[].elements[].end: object",
  "$.pages[].elements[].start.anchor: string",
  "$.pages[].elements[].start.elementId: string",
  "$.pages[].elements[].start: object",
];
/** An element's `blend` (2026-11-10, src/core/blend.ts): how it mixes with what is under it. Optional for good: an element with none is Normal. */
const BLEND = ["$.pages[].elements[].blend: string", "$.pages[].elements[].children[].blend: string"];
/** A design's `live` (2026-11-09, docs/COLLABORATION.md): where it is shared with other people, kept on this device only. Optional for good: a design that is not shared has none. `ownerKey` (2026-11-10) is the key that ends the sharing; a link without it only leaves the room on this device. */
const LIVE_LINK = [
  "$.live.key: string",
  "$.live.ownerKey: string",
  "$.live.role: string",
  "$.live.room: string",
  "$.live.server: string",
  "$.live.viewKey: string",
  "$.live: object",
];
/**
 * A design's `comments` (2026-11-14, src/core/comments.ts, docs/COLLABORATION.md "Comments"): notes pinned to places of the pages.
 * Optional for good: an older design has none, which every reader takes as an empty list, and an older release that reads a design
 * with them keeps the field as it is (a file's other fields pass through `portableDesign`) and draws nothing of it.
 */
const COMMENTS = [
  "$.comments: array",
  "$.comments[].anchor.dx: number",
  "$.comments[].anchor.dy: number",
  "$.comments[].anchor.elementId: string",
  "$.comments[].anchor.x: number",
  "$.comments[].anchor.y: number",
  "$.comments[].anchor: object",
  "$.comments[].author.colorIndex: number",
  "$.comments[].author.name: string",
  "$.comments[].author: object",
  "$.comments[].createdAt: number",
  "$.comments[].editedAt: number",
  "$.comments[].id: string",
  "$.comments[].pageId: string",
  "$.comments[].replies: array",
  "$.comments[].replies[].author.colorIndex: number",
  "$.comments[].replies[].author.name: string",
  "$.comments[].replies[].author: object",
  "$.comments[].replies[].createdAt: number",
  "$.comments[].replies[].editedAt: number",
  "$.comments[].replies[].id: string",
  "$.comments[].replies[].text: string",
  "$.comments[].replies[]: object",
  "$.comments[].resolved: boolean",
  "$.comments[].text: string",
  "$.comments[]: object",
];
/**
 * A design's `review` and an author's `id` (2026-11-22, src/core/review.ts, docs/REVIEW.md): where the design stands in a review,
 * about one revision of its content, and the account that wrote a comment, a reply or a review in a team's room. Optional for good:
 * an older design has no review and its authors no id (nobody's, in a team's room). The review carries its own format (`v`), so
 * that a later shape of it needs no new design version; a file's review that is not one is left out (`usableReview`).
 */
const REVIEW = [
  "$.comments[].author.id: string",
  "$.comments[].replies[].author.id: string",
  "$.review.at: number",
  "$.review.by.colorIndex: number",
  "$.review.by.id: string",
  "$.review.by.name: string",
  "$.review.by: object",
  "$.review.revision: string",
  "$.review.state: string",
  "$.review.v: number",
  "$.review: object",
];
/**
 * A summary's `revision` (2026-11-10, src/core/library.ts): a new one with every write of the design, so that a tab that holds an
 * older copy does not write over a newer one. Optional for good: a summary stored before it has none, which is read as `null`.
 */
const REVISION = ["$.revision: string"];
/**
 * The `space` of a summary, a folder and an upload (2026-11-17, database step 2, docs/ACCOUNTS.md): the space of an account
 * server that it belongs to. Optional for good: a record without one is on this device only, which every record before accounts is.
 */
const SPACE = ["$.space: string"];
const ADDED: Record<string, string[]> = {
  // (in the order a shape is written, sorted: the ids of authors fall among the lines of the comments)
  design: [...COMMENTS, ...LIVE_LINK, ...BLEND, ...LINE_ATTACHMENTS, ...REVIEW].sort(),
  summary: [...REVISION, ...SPACE],
  folder: SPACE,
  brandKit: [],
  version: [],
  upload: SPACE,
};
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

  it("a record of the sync store (database step 2) is what the frozen one is", () => {
    // the store came with step 2, so its record has a frozen file of its own; it belongs to the device and is in no backup
    expect(shapeOf(written.sync), `a sync record is now written in another shape:${WHAT_NEXT}`).toEqual(shapeOf(syncRecord));
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
