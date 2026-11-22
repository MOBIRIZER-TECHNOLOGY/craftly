/**
 * Reviews and the commenter's seat between a room and its browsers, wired by hand (as comments.sync.test.ts does): the review on
 * the wire, a commenter who comments and approves and may do nothing else, an approval that goes out of date, an older browser in
 * a room with newer ones, and a newer browser with an older server (docs/REVIEW.md).
 */
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { contentRevision } from "@/core/review";
import type { CommentAuthor, Design, DesignComment, DesignReview } from "@/core/types";
import { applyOps, diffDesign, designsEqual, isReviewOp, type Op } from "./ops";
import { canComment, canEdit, checkDesign, checkOps, parseServerMsg, type ClientMsg, type Feature, type Role, type ServerMsg } from "./protocol";
import { Room, type Peer, type SeatAccount } from "./room";
import { Session, withShared } from "./session";

const BOB: SeatAccount = { id: "u_bob_0123456789ab", owner: false };
const bob: CommentAuthor = { name: "Bob", colorIndex: 2, id: BOB.id };
const start = (extra: Partial<Design> = {}): Design => ({
  ...createDesign({ title: "Shared", width: 800, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] }),
  ...extra,
});
const review = (state: DesignReview["state"], d: Design, by: CommentAuthor = { name: "Ann", colorIndex: 1 }): DesignReview => ({
  v: 1,
  state,
  revision: contentRevision(d),
  by,
  at: 7,
});
const comment = (id: string, author: CommentAuthor): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author,
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [],
});
const xOf = (d: Design) => d.pages[0].elements[0].x;

/** A browser with a manual wire, as in comments.sync.test.ts, with the role and the account its seat is given. */
class Browser {
  session: Session;
  shown: Design;
  up: ClientMsg[] = [];
  down: ServerMsg[] = [];
  ended = false;
  rejected: string[] = [];
  peer: Peer = { send: (m) => this.down.push(JSON.parse(JSON.stringify(m)) as ServerMsg) };
  constructor(
    readonly room: Room,
    readonly id: string,
    readonly opts: { features?: Feature[]; role?: Role; account?: SeatAccount; name?: string; server?: "new" | "old" } = {},
  ) {
    this.session = new Session({ client: id, key: "k", send: (m) => this.up.push(m), features: opts.features ?? ["comments", "review"] });
    this.shown = start();
    this.session.open();
    this.flush();
  }
  edit(fn: (d: Design) => Design) {
    const next = fn(this.shown);
    this.session.edit(this.shown, next);
    this.shown = next;
  }
  flush() {
    for (let guard = 0; guard < 100 && (this.up.length || this.down.length); guard++) {
      while (this.up.length) {
        const m = this.up.shift()!;
        const said = m.t === "join" ? (m.features ?? []) : [];
        const features = this.opts.server === "old" ? { comments: said.includes("comments") } : { comments: said.includes("comments"), review: said.includes("review") };
        if (m.t === "join") this.room.join(this.peer, this.id, this.opts.role ?? "edit", features, this.opts.name, this.opts.account);
        else void this.room.receive(this.peer, m);
      }
      while (this.down.length) {
        const out = this.session.receive(this.down.shift()!);
        if (out.ended) this.ended = true;
        if (out.rejected) this.rejected.push(out.rejected);
        if (out.changed) this.shown = withShared(this.shown, this.session.design!, this.session.sharesComments, this.session.sharesReview);
      }
    }
  }
}

const setReview = (state: DesignReview["state"], by?: CommentAuthor) => (d: Design) => ({ ...d, review: review(state, d, by) });
const move = (x: number) => (d: Design) => ({ ...d, pages: [{ ...d.pages[0], elements: [{ ...d.pages[0].elements[0], x }] }] });

describe("the review on the wire", () => {
  it("is one operation, made when the review changed and replayed on any copy", () => {
    const d = start();
    const reviewed = setReview("requested")(d);
    const ops = diffDesign(d, reviewed);
    expect(ops).toEqual([{ k: "review.set", review: reviewed.review }]);
    expect(ops.every(isReviewOp)).toBe(true);
    expect(applyOps(d, ops).review).toEqual(reviewed.review);
    // the same again changes nothing; taking the review away is no operation (a review is set, never removed)
    expect(applyOps(reviewed, ops)).toBe(reviewed);
    expect(diffDesign(reviewed, { ...reviewed, review: { ...reviewed.review! } })).toEqual([]);
    expect(diffDesign(reviewed, d)).toEqual([]);
    expect(designsEqual(d, reviewed)).toBe(false);
  });

  it("is read strictly by both ends, and in a design that arrives whole", () => {
    const d = start();
    const good = { k: "review.set", review: review("approved", d) };
    expect(checkOps([good])).toEqual([good]);
    expect(checkOps([{ ...good, extra: 1 }])).toBe("review.set: a field that this operation does not have (extra)");
    expect(checkOps([{ k: "review.set", review: { ...good.review, v: 2 } }])).toBe("review.set: a review of a format this version does not know");
    expect(checkOps([{ k: "review.set" }])).toBe("review.set: a review is an object");
    expect(checkDesign({ ...d, review: review("approved", d) })).toBeNull();
    expect(checkDesign({ ...d, review: { state: "approved" } })).toBe("the review: a review of a format this version does not know");
  });

  it("names the role of a commenter in a welcome, and what each role may do", () => {
    const welcome = (role: string) => parseServerMsg({ t: "welcome", role, rev: 0, lastSeq: 0, design: start(), features: ["comments", "review"] });
    expect(welcome("comment")).toMatchObject({ role: "comment", features: ["comments", "review"] });
    expect(welcome("owner")).toBe("welcome: the role is edit, comment or view");
    expect([canEdit("edit"), canEdit("comment"), canEdit("view")]).toEqual([true, false, false]);
    expect([canComment("edit"), canComment("comment"), canComment("view")]).toEqual([true, true, false]);
  });
});

describe("a commenter", () => {
  it("comments in their own name and approves the design as it is; their edits of it never leave their browser", () => {
    const room = new Room(start());
    const ann = new Browser(room, "ann");
    const b = new Browser(room, "bob", { role: "comment", account: BOB, name: "Bob" });
    expect(b.session.role).toBe("comment");
    ann.edit(setReview("requested"));
    ann.flush();
    b.flush();
    expect(b.shown.review?.state).toBe("requested");
    b.edit((d) => ({ ...d, comments: [comment("c", bob)] }));
    b.edit(setReview("approved", bob));
    // (an edit of the design itself is taken out of what a commenter sends: the server would refuse the whole batch)
    b.edit(move(300));
    b.flush();
    ann.flush();
    expect(b.rejected).toEqual([]);
    expect(room.design.comments?.map((c) => c.id)).toEqual(["c"]);
    expect(room.design.review).toMatchObject({ state: "approved", by: bob });
    expect(xOf(room.design)).not.toBe(300);
    expect(ann.shown.review).toEqual(room.design.review);
    expect(b.session.pending).toBe(0);
  });

  it("is refused a batch that edits the design, or a comment in somebody else's name", () => {
    const room = new Room(start());
    const peer: Peer & { heard: ServerMsg[] } = { heard: [], send: (m) => peer.heard.push(m) };
    room.join(peer, "bob", "comment", { comments: true, review: true }, "Bob", BOB);
    void room.receive(peer, { t: "ops", seq: 1, ops: [{ k: "el.set", page: "p", id: "a", set: { x: 9 } }] });
    void room.receive(peer, { t: "ops", seq: 2, ops: [{ k: "comment.add", comment: comment("c", { name: "Ann", colorIndex: 1 }), index: 0 }] });
    void room.receive(peer, { t: "ops", seq: 3, ops: [{ k: "comment.add", comment: comment("c", bob), index: 0 }] });
    expect(peer.heard.slice(1)).toEqual([
      { t: "rejected", seq: 1, reason: "this seat may only comment" },
      { t: "rejected", seq: 2, reason: "comment.add: a comment is written in your own name" },
      { t: "ack", seq: 3, rev: 1 },
    ]);
  });

  it("whose browser does not understand reviews only looks: it would refuse a role it does not know", () => {
    const room = new Room(start());
    const old = new Browser(room, "old", { features: ["comments"], role: "comment", account: BOB, name: "Bob" });
    expect(old.ended).toBe(false);
    expect(old.session.role).toBe("view");
    expect(old.session.sharesReview).toBe(false);
  });
});

describe("an approval", () => {
  it("is of the design as it is now, and is out of date after an edit, on every copy", () => {
    const room = new Room(start());
    const ann = new Browser(room, "ann");
    const b = new Browser(room, "bob", { role: "comment", account: BOB, name: "Bob" });
    b.edit(setReview("approved", bob));
    b.flush();
    ann.flush();
    expect(ann.shown.review?.revision).toBe(contentRevision(ann.shown));
    ann.edit(move(321));
    ann.flush();
    b.flush();
    for (const d of [room.design, ann.shown, b.shown]) {
      expect(d.review?.state).toBe("approved");
      expect(d.review?.revision).not.toBe(contentRevision(d));
    }
  });

  it("made while an edit it had not seen was on its way is refused, and the commenter sees the newer design", () => {
    const room = new Room(start());
    const ann = new Browser(room, "ann");
    const b = new Browser(room, "bob", { role: "comment", account: BOB, name: "Bob" });
    ann.edit(move(55));
    b.edit(setReview("approved", bob));
    // the edit reaches the server first
    ann.flush();
    b.flush();
    ann.flush();
    expect(b.rejected).toEqual(["review.set: the design has changed since; look at it again"]);
    expect(room.design.review).toBeUndefined();
    expect(b.shown.review).toBeUndefined();
    expect(xOf(b.shown)).toBe(55);
  });
});

describe("an older browser in a room with newer ones", () => {
  it("is welcomed without the review and sent no review operation, and stays in step", () => {
    const room = new Room(start());
    const ann = new Browser(room, "ann");
    ann.edit(setReview("requested"));
    ann.flush();
    const heard: Op[][] = [];
    const old = new Browser(room, "old", { features: ["comments"] });
    expect(old.session.server?.review).toBeUndefined();
    const send = old.peer.send;
    old.peer.send = (m) => {
      if (m.t === "ops") heard.push(m.ops);
      send(m);
    };
    ann.edit(setReview("approved"));
    ann.edit(move(10));
    ann.flush();
    old.flush();
    expect(heard).toEqual([[], [{ k: "el.set", page: "p", id: "a", set: { x: 10 } }]]);
    expect(old.ended).toBe(false);
    expect(old.session.rev).toBe(room.rev);
  });
});

describe("a newer browser with an older server", () => {
  it("shares no review: none is sent, and none the server holds is shown or replaces this person's own", () => {
    const room = new Room(start({ review: { v: 1, state: "approved", revision: "r1-old", by: { name: "Ann", colorIndex: 1 }, at: 1 } }));
    const b = new Browser(room, "b", { server: "old" });
    expect(b.session.sharesReview).toBe(false);
    expect(b.session.server?.review).toBeUndefined();
    const before = room.rev;
    b.edit(setReview("requested"));
    b.flush();
    expect(room.rev).toBe(before);
    expect(b.shown.review?.state).toBe("requested");
    // what arrives of the server keeps this person's own review
    expect(withShared(b.shown, b.session.design!, true, false).review?.state).toBe("requested");
  });
});
