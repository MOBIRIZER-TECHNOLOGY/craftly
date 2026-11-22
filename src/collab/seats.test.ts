/** What a seat may do beyond what its batch looks like (src/collab/seats.ts, docs/REVIEW.md): rule by rule. */
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { contentRevision } from "@/core/review";
import type { CommentAuthor, CommentReply, Design, DesignComment, DesignReview } from "@/core/types";
import { applyOps, type Op } from "./ops";
import { seatProblem, type Seat } from "./seats";

const ANN = { id: "u_ann_0123456789ab", name: "Ann", owner: false };
const BOB = { id: "u_bob_0123456789ab", name: "Bob", owner: false };
const OWEN = { id: "u_owen_0123456789a", name: "Owen", owner: true };
const by = (who: { id: string; name: string }): CommentAuthor => ({ name: who.name, colorIndex: 1, id: who.id });
const reply = (id: string, author: CommentAuthor): CommentReply => ({ id, author, createdAt: 2, text: `reply ${id}` });
const comment = (id: string, author: CommentAuthor, replies: CommentReply[] = []): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author,
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies,
});
const start = (comments: DesignComment[] = []): Design => ({
  ...createDesign({ title: "Shared", width: 800, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] }),
  comments,
});
/** What the seat is told of the batch, on the design `before`. */
const ask = (before: Design, ops: Op[], seat: Seat) => seatProblem(before, applyOps(before, ops), ops, seat);
const editor = (who = ANN): Seat => ({ role: "edit", account: who });
const commenter = (who = BOB): Seat => ({ role: "comment", account: who });
const link: Seat = { role: "edit" };
const move: Op = { k: "el.set", page: "p", id: "a", set: { x: 5 } };
const review = (state: DesignReview["state"], who: CommentAuthor, revision: string): Op => ({ k: "review.set", review: { v: 1, state, revision, by: who, at: 9 } });

describe("a seat that may only comment", () => {
  it("sends comments and the review, and nothing else", () => {
    const d = start();
    expect(ask(d, [{ k: "comment.add", comment: comment("c", by(BOB)), index: 0 }], commenter())).toBeNull();
    expect(ask(d, [move], commenter())).toBe("this seat may only comment");
    expect(ask(d, [{ k: "comment.add", comment: comment("c", by(BOB)), index: 0 }, move], commenter())).toBe("this seat may only comment");
  });

  it("leaves a batch without comments to the checks that were there before", () => {
    expect(ask(start(), [move], editor())).toBeNull();
    expect(ask(start(), [move], link)).toBeNull();
  });
});

describe("comments in a team's room", () => {
  it("are written in the seat's own name: its account's id and name", () => {
    const d = start();
    expect(ask(d, [{ k: "comment.add", comment: comment("c", by(ANN)), index: 0 }], editor())).toBeNull();
    expect(ask(d, [{ k: "comment.add", comment: comment("c", by(BOB)), index: 0 }], editor())).toBe("comment.add: a comment is written in your own name");
    expect(ask(d, [{ k: "comment.add", comment: comment("c", { ...by(ANN), name: "Not Ann" }), index: 0 }], editor())).toBe("comment.add: a comment is written in your own name");
    expect(ask(d, [{ k: "comment.add", comment: comment("c", { name: "Ann", colorIndex: 1 }), index: 0 }], editor())).toBe("comment.add: a comment is written in your own name");
    expect(ask(d, [{ k: "comment.add", comment: comment("c", by(ANN), [reply("r", by(BOB))]), index: 0 }], editor())).toBe("comment.add: a comment is written in your own name");
    expect(ask(d, [{ k: "reply.add", comment: "c", reply: reply("r", by(BOB)), index: 0 }], editor())).toBe("reply.add: a reply is written in your own name");
    expect(ask(start([comment("c", by(BOB))]), [{ k: "reply.add", comment: "c", reply: reply("r", by(ANN)), index: 0 }], editor())).toBeNull();
  });

  it("come back with their page, whoever wrote them, for a seat that may edit", () => {
    const d = start();
    const page = createPage({ id: "q" });
    const back: Op[] = [
      { k: "page.add", page, index: 1 },
      { k: "comment.add", comment: { ...comment("c", by(BOB), [reply("r", by(OWEN))]), pageId: "q" }, index: 0 },
    ];
    expect(ask(d, back, editor())).toBeNull();
    // (not on a page that is already there, and not for a seat that may only comment, which cannot add a page anyway)
    expect(ask(d, [back[1]], editor())).toBe("comment.add: a comment is written in your own name");
  });

  it("have their words and pin changed by their author only; resolving is anybody's", () => {
    const d = start([comment("c", by(BOB))]);
    expect(ask(d, [{ k: "comment.set", id: "c", set: { text: "mine now" } }], editor())).toBe("comment.set: only its author changes a comment");
    expect(ask(d, [{ k: "comment.set", id: "c", set: { anchor: { x: 9, y: 9 } } }], editor())).toBe("comment.set: only its author changes a comment");
    expect(ask(d, [{ k: "comment.set", id: "c", unset: ["editedAt"] }], editor())).toBe("comment.set: only its author changes a comment");
    expect(ask(d, [{ k: "comment.set", id: "c", set: { resolved: true } }], editor())).toBeNull();
    expect(ask(d, [{ k: "comment.set", id: "c", set: { text: "better" } }], commenter())).toBeNull();
    // the owner moderates by deleting, never by changing somebody's words
    expect(ask(d, [{ k: "comment.set", id: "c", set: { text: "better" } }], editor(OWEN))).toBe("comment.set: only its author changes a comment");
    // (a comment that is not there is changed by nobody: there is nothing to refuse)
    expect(ask(d, [{ k: "comment.set", id: "gone", set: { text: "x" } }], editor())).toBeNull();
  });

  it("are deleted by their author or an owner", () => {
    const d = start([comment("c", by(BOB), [reply("r", by(BOB))])]);
    expect(ask(d, [{ k: "comment.del", id: "c" }], editor())).toBe("comment.del: only its author or an owner deletes a comment");
    expect(ask(d, [{ k: "comment.del", id: "c" }], commenter())).toBeNull();
    expect(ask(d, [{ k: "comment.del", id: "c" }], editor(OWEN))).toBeNull();
    expect(ask(d, [{ k: "reply.del", comment: "c", id: "r" }], editor())).toBe("reply.del: only its author or an owner deletes a reply");
    expect(ask(d, [{ k: "reply.del", comment: "c", id: "r" }], editor(OWEN))).toBeNull();
    expect(ask(d, [{ k: "reply.set", comment: "c", id: "r", set: { text: "x" } }], editor())).toBe("reply.set: only its author changes a reply");
    expect(ask(d, [{ k: "reply.set", comment: "c", id: "r", set: { text: "x" } }], editor(OWEN))).toBe("reply.set: only its author changes a reply");
    expect(ask(d, [{ k: "reply.set", comment: "c", id: "r", set: { text: "x" } }], commenter())).toBeNull();
  });

  it("are the seat's own once added in the same batch", () => {
    const d = start();
    const ops: Op[] = [
      { k: "comment.add", comment: comment("c", by(ANN)), index: 0 },
      { k: "comment.set", id: "c", set: { text: "typo fixed" } },
      { k: "reply.add", comment: "c", reply: reply("r", by(ANN)), index: 0 },
      { k: "reply.set", comment: "c", id: "r", set: { text: "also" } },
    ];
    expect(ask(d, ops, editor())).toBeNull();
  });

  it("without an account's id (written before, or by a link) are changed by nobody and deleted by an owner", () => {
    const d = start([comment("c", { name: "Bob", colorIndex: 2 })]);
    expect(ask(d, [{ k: "comment.set", id: "c", set: { text: "x" } }], commenter())).toBe("comment.set: only its author changes a comment");
    expect(ask(d, [{ k: "comment.del", id: "c" }], commenter())).toBe("comment.del: only its author or an owner deletes a comment");
    expect(ask(d, [{ k: "comment.del", id: "c" }], editor(OWEN))).toBeNull();
  });
});

describe("comments in a room of a link", () => {
  it("are anybody's to change, as before, and nobody writes as an account there", () => {
    const d = start([comment("c", { name: "Bob", colorIndex: 2 })]);
    expect(ask(d, [{ k: "comment.set", id: "c", set: { text: "x" } }], link)).toBeNull();
    expect(ask(d, [{ k: "comment.del", id: "c" }], link)).toBeNull();
    expect(ask(d, [{ k: "comment.add", comment: comment("n", { name: "Ann", colorIndex: 1 }), index: 0 }], link)).toBeNull();
    expect(ask(d, [{ k: "comment.add", comment: comment("n", by(ANN)), index: 0 }], link)).toBe("comment.add: a comment is written in your own name");
    expect(ask(d, [review("approved", by(ANN), contentRevision(d))], link)).toBe("review.set: a review is set in your own name");
    expect(ask(d, [review("approved", { name: "Ann", colorIndex: 1 }, contentRevision(d))], link)).toBeNull();
  });
});

describe("the review", () => {
  it("is asked for by a seat that may edit, and approved or sent back by one that may comment", () => {
    const d = start();
    const now = contentRevision(d);
    expect(ask(d, [review("requested", by(ANN), now)], editor())).toBeNull();
    expect(ask(d, [review("requested", by(BOB), now)], commenter())).toBe("review.set: a review is asked for by somebody who may edit");
    expect(ask(d, [review("approved", by(BOB), now)], commenter())).toBeNull();
    expect(ask(d, [review("changes", by(BOB), now)], commenter())).toBeNull();
    expect(ask(d, [review("approved", by(ANN), now)], commenter())).toBe("review.set: a review is set in your own name");
  });

  it("is about the content as the batch leaves it, never one the seat has not seen", () => {
    const d = start();
    expect(ask(d, [review("approved", by(BOB), "r1-something-older")], commenter())).toBe("review.set: the design has changed since; look at it again");
    // an editor who edits and asks in one batch asks about what the batch makes
    const after = applyOps(d, [move]);
    expect(ask(d, [move, review("requested", by(ANN), contentRevision(after))], editor())).toBeNull();
    expect(ask(d, [move, review("requested", by(ANN), contentRevision(d))], editor())).toBe("review.set: the design has changed since; look at it again");
  });
});
