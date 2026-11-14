/**
 * Comments as operations: each one touches one comment or one reply by its id, so that two people who comment at the same moment
 * never take each other's words away, and the server's order decides only what one comment or reply ends up as.
 */
import { describe, expect, it } from "vitest";
import { MAX_COMMENTS, MAX_REPLIES } from "@/core/comments";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { CommentReply, Design, DesignComment } from "@/core/types";
import { applyOps, designsEqual, diffDesign, isCommentOp, type Op } from "./ops";

const author = { name: "Ann", colorIndex: 1 };
const reply = (id: string, extra: Partial<CommentReply> = {}): CommentReply => ({ id, author, createdAt: 2, text: `reply ${id}`, ...extra });
const comment = (id: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author,
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [],
  ...extra,
});
const start = (comments?: DesignComment[]): Design => {
  const made = createDesign({ title: "Shared", width: 800, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] }), createPage({ id: "q" })] });
  return comments ? { ...made, comments } : made;
};
const withComments = (d: Design, comments: DesignComment[]): Design => ({ ...d, comments });
const roundTrip = (before: Design, after: Design): Op[] => {
  const ops = JSON.parse(JSON.stringify(diffDesign(before, after))) as Op[];
  expect(designsEqual(applyOps(before, ops), after)).toBe(true);
  expect(applyOps(before, ops).comments ?? []).toEqual(after.comments ?? []);
  return ops;
};

describe("what a change of the comments sends", () => {
  it("adds a comment whole, at its place in the list", () => {
    const before = start([comment("a")]);
    const after = withComments(before, [comment("a"), comment("b")]);
    expect(roundTrip(before, after)).toEqual([{ k: "comment.add", comment: comment("b"), index: 1 }]);
  });

  it("adds the first comment of a design that had none", () => {
    const before = start();
    expect(roundTrip(before, withComments(before, [comment("a")]))).toEqual([{ k: "comment.add", comment: comment("a"), index: 0 }]);
  });

  it("sends a reply as a reply, never the whole thread", () => {
    const before = start([comment("a", { replies: [reply("r1")] })]);
    const after = withComments(before, [comment("a", { replies: [reply("r1"), reply("r2")] })]);
    expect(roundTrip(before, after)).toEqual([{ k: "reply.add", comment: "a", reply: reply("r2"), index: 1 }]);
  });

  it("sends resolving, editing and moving the pin as the properties that changed", () => {
    const before = start([comment("a")]);
    expect(roundTrip(before, withComments(before, [comment("a", { resolved: true })]))).toEqual([{ k: "comment.set", id: "a", set: { resolved: true } }]);
    expect(roundTrip(before, withComments(before, [comment("a", { text: "better", editedAt: 9 })]))).toEqual([{ k: "comment.set", id: "a", set: { text: "better", editedAt: 9 } }]);
    expect(roundTrip(before, withComments(before, [comment("a", { anchor: { x: 5, y: 6 } })]))).toEqual([{ k: "comment.set", id: "a", set: { anchor: { x: 5, y: 6 } } }]);
  });

  it("sends an edit and a deletion of a reply, and a deletion of a comment", () => {
    const before = start([comment("a", { replies: [reply("r1"), reply("r2")] }), comment("b")]);
    const after = withComments(before, [comment("a", { replies: [reply("r2", { text: "changed", editedAt: 4 })] })]);
    expect(roundTrip(before, after)).toEqual([
      { k: "comment.del", id: "b" },
      { k: "reply.del", comment: "a", id: "r1" },
      { k: "reply.set", comment: "a", id: "r2", set: { text: "changed", editedAt: 4 } },
    ]);
  });

  it("takes away the time of an edit when it went, and sends nothing for comments that did not change", () => {
    const before = start([comment("a", { editedAt: 3, replies: [reply("r", { editedAt: 3 })] })]);
    const after = withComments(before, [comment("a", { replies: [reply("r")] })]);
    expect(roundTrip(before, after)).toEqual([
      { k: "comment.set", id: "a", unset: ["editedAt"] },
      { k: "reply.set", comment: "a", id: "r", unset: ["editedAt"] },
    ]);
    expect(diffDesign(before, withComments(before, JSON.parse(JSON.stringify(before.comments))))).toEqual([]);
  });

  it("puts the comments after the pages, so that a page that comes back is there before its comments", () => {
    const before = start([comment("a", { pageId: "q" })]);
    const after = { ...before, pages: [before.pages[0]], comments: [] };
    const forward = roundTrip(before, after);
    expect(forward.map((op) => op.k)).toEqual(["page.del", "comment.del"]);
    const back = roundTrip(after, before);
    expect(back.map((op) => op.k)).toEqual(["page.add", "comment.add"]);
  });

  it("is told apart from the other operations", () => {
    expect(isCommentOp({ k: "comment.del", id: "a" })).toBe(true);
    expect(isCommentOp({ k: "reply.del", comment: "a", id: "r" })).toBe(true);
    expect(isCommentOp({ k: "page.del", id: "p" })).toBe(false);
  });
});

describe("two people who comment at the same moment", () => {
  it("both keep their comment, whichever the server applies first", () => {
    const base = start();
    const ann: Op = { k: "comment.add", comment: comment("ann"), index: 0 };
    const bob: Op = { k: "comment.add", comment: comment("bob", { author: { name: "Bob", colorIndex: 2 } }), index: 0 };
    expect(
      applyOps(base, [ann, bob])
        .comments!.map((c) => c.id)
        .sort(),
    ).toEqual(["ann", "bob"]);
    expect(
      applyOps(base, [bob, ann])
        .comments!.map((c) => c.id)
        .sort(),
    ).toEqual(["ann", "bob"]);
  });

  it("keep both a reply and a resolve made at the same moment", () => {
    const base = start([comment("a")]);
    const answered: Op = { k: "reply.add", comment: "a", reply: reply("r"), index: 0 };
    const resolved: Op = { k: "comment.set", id: "a", set: { resolved: true } };
    for (const order of [
      [answered, resolved],
      [resolved, answered],
    ]) {
      const [made] = applyOps(base, order).comments!;
      expect(made.resolved).toBe(true);
      expect(made.replies.map((r) => r.id)).toEqual(["r"]);
    }
  });

  it("both keep their reply to one comment", () => {
    const base = start([comment("a")]);
    const out = applyOps(base, [
      { k: "reply.add", comment: "a", reply: reply("r1"), index: 0 },
      { k: "reply.add", comment: "a", reply: reply("r2"), index: 0 },
    ]);
    expect(out.comments![0].replies.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("a comment operation that cannot be placed", () => {
  it("changes nothing and gives the same design", () => {
    const base = start([comment("a", { replies: [reply("r")] })]);
    const nothing: Op[] = [
      { k: "comment.add", comment: comment("a"), index: 0 }, // the id is there
      { k: "comment.add", comment: comment("z", { pageId: "gone" }), index: 0 }, // no such page
      { k: "comment.set", id: "gone", set: { resolved: true } },
      { k: "comment.set", id: "a", set: { resolved: false } }, // as it is
      { k: "comment.del", id: "gone" },
      { k: "reply.add", comment: "gone", reply: reply("x"), index: 0 },
      { k: "reply.add", comment: "a", reply: reply("r"), index: 0 }, // the id is there
      { k: "reply.set", comment: "a", id: "gone", set: { text: "x" } },
      { k: "reply.set", comment: "gone", id: "r", set: { text: "x" } },
      { k: "reply.set", comment: "a", id: "r", set: { text: "reply r" } }, // as it is
      { k: "reply.del", comment: "a", id: "gone" },
      { k: "reply.del", comment: "gone", id: "r" },
    ];
    for (const op of nothing) expect(applyOps(base, [op]), op.k).toBe(base);
  });

  it("does not take a design past the most comments, or a thread past the most replies", () => {
    const full = start(Array.from({ length: MAX_COMMENTS }, (_, i) => comment(`c${i}`)));
    expect(applyOps(full, [{ k: "comment.add", comment: comment("more"), index: 0 }])).toBe(full);
    const long = start([comment("a", { replies: Array.from({ length: MAX_REPLIES }, (_, i) => reply(`r${i}`)) })]);
    expect(applyOps(long, [{ k: "reply.add", comment: "a", reply: reply("more"), index: 0 }])).toBe(long);
  });

  it("never sets what is not a property a change may set, nor anything by a name that would change what an object is", () => {
    const base = start([comment("a", { replies: [reply("r")] })]);
    const forced = applyOps(base, [
      { k: "comment.set", id: "a", set: { id: "b", pageId: "q", replies: [], __proto__: { bad: 1 } } as never },
      { k: "reply.set", comment: "a", id: "r", set: { id: "x", author: { name: "Eve", colorIndex: 0 } } as never },
    ]);
    expect(forced).toBe(base);
  });

  it("clamps an index that is out of range", () => {
    const base = start([comment("a")]);
    expect(applyOps(base, [{ k: "comment.add", comment: comment("b"), index: -5 }]).comments!.map((c) => c.id)).toEqual(["b", "a"]);
    expect(applyOps(base, [{ k: "comment.add", comment: comment("b"), index: 99 }]).comments!.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("a page that is deleted", () => {
  it("takes its comments with it, on every copy", () => {
    const base = start([comment("a"), comment("b", { pageId: "q" })]);
    expect(applyOps(base, [{ k: "page.del", id: "q" }]).comments!.map((c) => c.id)).toEqual(["a"]);
  });

  it("leaves the comments alone when it is the last page, which is never deleted", () => {
    const base = { ...start([comment("a")]), pages: [start().pages[0]] };
    expect(applyOps(base, [{ k: "page.del", id: "p" }])).toBe(base);
  });
});

describe("whether two designs are the same", () => {
  it("counts their comments, and none is the same as an empty list", () => {
    expect(designsEqual(start(), start([]))).toBe(true);
    expect(designsEqual(start(), start([comment("a")]))).toBe(false);
  });
});
