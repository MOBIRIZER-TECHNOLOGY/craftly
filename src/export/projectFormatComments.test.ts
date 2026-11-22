/**
 * Comments in a project file and in a backup: they travel with the design, are read as strictly as on the wire (src/core/comments.ts),
 * and what is not usable is left out and counted.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import type { Design, DesignComment } from "@/core/types";
import { buildProjectFile, parseProjectFile, parseStoredDesign, serializeProjectFile, type ImportReport } from "./projectFormat";

const comment = (id: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author: { name: "Ann", colorIndex: 1 },
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [{ id: "r", author: { name: "Bob", colorIndex: 2 }, createdAt: 2, text: "ok" }],
  ...extra,
});
const design = (comments?: unknown[]): Design => {
  const made = createDesign({ title: "Noted", width: 400, height: 300, pages: [createPage({ id: "p" })] });
  return (comments ? { ...made, comments } : made) as Design;
};
const throughFile = (d: Design, report: ImportReport = { skipped: 0 }) => parseProjectFile(serializeProjectFile(buildProjectFile(d, {})), report).design;

describe("comments in a project file", () => {
  it("come back as they were", () => {
    expect(throughFile(design([comment("a"), comment("b", { resolved: true, editedAt: 9 })])).comments).toEqual([comment("a"), comment("b", { resolved: true, editedAt: 9 })]);
  });

  it("are left out, and counted, when they are damaged, carry markup fields, or are on a page that is not there", () => {
    const report: ImportReport = { skipped: 0 };
    const read = throughFile(design([comment("a"), { ...comment("b"), style: "x" }, comment("c", { pageId: "elsewhere" }), "nonsense"]), report);
    expect(read.comments!.map((c) => c.id)).toEqual(["a"]);
    expect(report.comments).toBe(3);
  });

  it("are no field at all in a design that has none, or none that could be used", () => {
    expect("comments" in throughFile(design())).toBe(false);
    expect("comments" in throughFile(design([{ id: 5 }]))).toBe(false);
  });
});

describe("comments in a backup", () => {
  it("are kept with a stored design, and checked the same way", () => {
    const stored = JSON.parse(JSON.stringify(design([comment("a"), { ...comment("b"), text: "" }]))) as Record<string, unknown>;
    expect(parseStoredDesign(stored).comments!.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("the review in a project file (docs/REVIEW.md)", () => {
  const review = { v: 1 as const, state: "approved" as const, revision: "r1-abc", by: { name: "Ann", colorIndex: 1, id: "u_0123456789abcdef" }, at: 4 };

  it("comes back as it was, with the account of its author", () => {
    expect(throughFile({ ...design(), review }).review).toEqual(review);
  });

  it("is left out when it is not one, and is no field in a design that has none", () => {
    expect("review" in throughFile({ ...design(), review: { ...review, v: 2 } } as unknown as Design)).toBe(false);
    expect("review" in throughFile(design())).toBe(false);
  });
});
