/** The review record and the revision of a design's content (src/core/review.ts, docs/REVIEW.md). */
import { describe, expect, it } from "vitest";
import { carryComments, readAuthor } from "./comments";
import { createDesign, createPage, createShape } from "./factory";
import { contentRevision, readReview, reviewOf, reviewProblem, usableReview, withoutReview } from "./review";
import type { Design, DesignReview } from "./types";

const start = (): Design => createDesign({ title: "Poster", width: 800, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] });
const review = (extra: Partial<DesignReview> & Record<string, unknown> = {}): DesignReview =>
  ({ v: 1, state: "approved", revision: "r1-abc", by: { name: "Ann", colorIndex: 3 }, at: 5, ...extra }) as DesignReview;

describe("the review record", () => {
  it("reads every state, with an author who has an account and one who has none, as a fresh object", () => {
    for (const state of ["requested", "approved", "changes"] as const) expect(readReview(review({ state }))).toEqual(review({ state }));
    const signed = review({ by: { name: "Ann", colorIndex: 3, id: "u_0123456789abcdef" } });
    const read = readReview(signed);
    expect(read).toEqual(signed);
    expect(read).not.toBe(signed);
  });

  it.each([
    ["not an object", null, "a review is an object"],
    ["a list", [], "a review is an object"],
    ["a field it does not have", review({ extra: 1 }), "a field that a review does not have (extra)"],
    ["another format", review({ v: 2 as never }), "a review of a format this version does not know"],
    ["no format", review({ v: undefined }), "a review of a format this version does not know"],
    ["a state nobody has", review({ state: "maybe" as never }), "a review is requested, approved or changes"],
    ["no revision", review({ revision: undefined }), "a review is about a revision"],
    ["a revision with a space", review({ revision: "r1 abc" }), "a review is about a revision"],
    ["a revision too long", review({ revision: "r".repeat(81) }), "a review is about a revision"],
    ["no author", review({ by: undefined }), "an author is an object"],
    ["a time that is not a number", review({ at: "now" as never }), "a time is a number"],
    ["a time before 1970", review({ at: -1 }), "a time is a number"],
    ["a time that is not finite", review({ at: Infinity }), "a time is a number"],
  ])("refuses %s", (_what, value, problem) => {
    expect(readReview(value)).toBe(problem);
  });

  it("is checked in a design that arrives whole, and read kindly from a file", () => {
    expect(reviewProblem(undefined)).toBeNull();
    expect(reviewProblem(review())).toBeNull();
    expect(reviewProblem(review({ v: 2 as never }))).toBe("a review of a format this version does not know");
    expect(usableReview(review())).toEqual(review());
    expect(usableReview({ v: 1 })).toBeUndefined();
    expect(usableReview(undefined)).toBeUndefined();
  });

  it("comes off a design for whoever does not share reviews", () => {
    const d = start();
    expect(withoutReview(d)).toBe(d);
    const reviewed = { ...d, review: review() };
    expect(withoutReview(reviewed)).toEqual(d);
    expect("review" in withoutReview(reviewed)).toBe(false);
  });
});

describe("an author's account", () => {
  it("is an id of an account, or nothing", () => {
    expect(readAuthor({ name: "Ann", colorIndex: 1, id: "u_0123456789abcdef" })).toEqual({ name: "Ann", colorIndex: 1, id: "u_0123456789abcdef" });
    expect(readAuthor({ name: "Ann", colorIndex: 1 })).toEqual({ name: "Ann", colorIndex: 1 });
    for (const id of ["short", "x".repeat(65), "u 0123456789abcdef", 12, null])
      expect(readAuthor({ name: "Ann", colorIndex: 1, id })).toBe("the id of an author is the id of an account");
  });
});

describe("the revision of the content", () => {
  it("is the same for the same content, whatever order its keys are in, and on a copy that went through JSON", () => {
    const d = start();
    const copy = JSON.parse(JSON.stringify(d)) as Design;
    const el = copy.pages[0].elements[0] as unknown as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(el).reverse());
    copy.pages[0].elements[0] = reordered as never;
    expect(contentRevision(copy)).toBe(contentRevision(d));
    expect(contentRevision(d)).toMatch(/^r1-[0-9a-z]{22}$/);
  });

  it("changes with what is drawn: an element, a page, the size", () => {
    const d = start();
    const was = contentRevision(d);
    const moved = { ...d, pages: [{ ...d.pages[0], elements: [{ ...d.pages[0].elements[0], x: d.pages[0].elements[0].x + 1 }] }] };
    expect(contentRevision(moved)).not.toBe(was);
    expect(contentRevision({ ...d, pages: [...d.pages, createPage({ id: "q" })] })).not.toBe(was);
    expect(contentRevision({ ...d, width: 801 })).not.toBe(was);
    expect(contentRevision({ ...d, height: 601 })).not.toBe(was);
    // the size is asked again of pages it has seen: the same pages at another size are another revision
    expect(contentRevision({ ...d, width: 801 })).toBe(contentRevision({ ...d, pages: [...d.pages], width: 801 }));
  });

  it("does not change with the title, the guides, the comments, the review or the library's details", () => {
    const d = start();
    const was = contentRevision(d);
    const other: Design = { ...d, title: "Other", unit: "mm", guides: { vertical: [1], horizontal: [] }, starred: true, folderId: "f" };
    expect(contentRevision(other)).toBe(was);
    const commented: Design = { ...d, review: review(), comments: [] };
    expect(contentRevision(commented)).toBe(was);
  });

  it("writes values as JSON does: what is not there in a list is null, a number that is not finite is null, a missing key is none", () => {
    const base = start();
    const withEl = (extra: Record<string, unknown>) => ({ ...base, pages: [{ ...base.pages[0], elements: [{ ...base.pages[0].elements[0], ...extra }] }] }) as Design;
    expect(contentRevision(withEl({ list: [undefined, () => 1, Symbol("s")] }))).toBe(contentRevision(withEl({ list: [null, null, null] })));
    expect(contentRevision(withEl({ n: NaN }))).toBe(contentRevision(withEl({ n: null })));
    expect(contentRevision(withEl({ gone: undefined, fn: () => 1 }))).toBe(contentRevision(base));
    expect(contentRevision(withEl({ big: 10n as never }))).toBe(contentRevision(withEl({ big: null })));
    expect(contentRevision(withEl({ text: 'a "quoted"\nline' }))).not.toBe(contentRevision(withEl({ text: "a quoted line" })));
  });
});

describe("where a design stands", () => {
  it("is nothing without a review, current while the content is the one it is about, and earlier after an edit", () => {
    const d = start();
    expect(reviewOf(null)).toBeNull();
    expect(reviewOf(d)).toBeNull();
    const reviewed = { ...d, review: review({ revision: contentRevision(d) }) };
    expect(reviewOf(reviewed)).toEqual({ review: reviewed.review, current: true });
    const edited = { ...reviewed, width: 900 };
    expect(reviewOf(edited)?.current).toBe(false);
  });

  it("is no step of undo: undo leaves the review as it is now", () => {
    const d = start();
    const now = { ...d, review: review({ state: "changes" }) };
    expect(carryComments(now, d).review).toEqual(review({ state: "changes" }));
    expect(carryComments(d, now).review).toBeUndefined();
    const same = { ...d, review: now.review };
    expect(carryComments(now, same)).toBe(same);
  });
});
