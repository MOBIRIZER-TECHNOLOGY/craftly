/**
 * The one check of a comment, wherever one comes in (a project file, a backup, a room that is made, a welcome, every comment
 * operation), and the small rules the editor keeps about comments: where a pin is, what a page that goes takes with it, and what
 * a step of undo does not take back.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "./factory";
import type { CommentReply, Design, DesignComment } from "./types";
import {
  carryComments,
  cleanCommentText,
  commentPosition,
  commentsForCopy,
  commentsProblem,
  MAX_COMMENT_TEXT,
  MAX_COMMENTS,
  MAX_REPLIES,
  readComment,
  readCommentPatch,
  readReply,
  readReplyPatch,
  settleComments,
  usableComments,
  withoutComments,
} from "./comments";

const author = { name: "Ann", colorIndex: 2 };
const reply = (id: string, extra: Partial<CommentReply> = {}): CommentReply => ({ id, author, createdAt: 2, text: "Agreed", ...extra });
const comment = (id: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 10, y: 20 },
  author,
  createdAt: 1,
  text: "Make this bigger",
  resolved: false,
  replies: [],
  ...extra,
});
const rect = (id: string, x: number, y: number) => createShape("rect", { id, x, y, width: 100, height: 50 });
const design = (comments?: DesignComment[], pages = [createPage({ id: "p", elements: [rect("a", 100, 100)] }), createPage({ id: "q", elements: [] })]): Design => {
  const made = createDesign({ title: "Notes", width: 800, height: 600, pages });
  return comments ? { ...made, comments } : made;
};

describe("a comment that comes in", () => {
  it("is taken whole when it has the form it should, with an anchor that follows an element, replies and an edit", () => {
    const full = comment("c_1", { anchor: { x: 1, y: 2, elementId: "a", dx: 3, dy: 4 }, editedAt: 5, resolved: true, replies: [reply("r_1", { editedAt: 3 })] });
    expect(readComment(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });

  it("is a fresh object: nothing of what came in is kept by reference", () => {
    const raw = comment("c_1", { replies: [reply("r_1")] });
    const read = readComment(raw) as DesignComment;
    expect(read).not.toBe(raw);
    expect(read.replies[0]).not.toBe(raw.replies[0]);
    expect(read.anchor).not.toBe(raw.anchor);
  });

  it.each<[string, unknown]>([
    ["not an object", "c"],
    ["a list", [comment("c")]],
    ["an id with a space", comment("c 1")],
    ["an id with markup", comment("<b>")],
    ["an empty id", comment("")],
    ["an id that is too long", comment("c".repeat(65))],
    ["an id that is a number", { ...comment("c"), id: 5 }],
    ["a page that is no id", { ...comment("c"), pageId: "" }],
    ["a page id that is far too long", { ...comment("c"), pageId: "p".repeat(201) }],
    ["a field that a comment does not have", { ...comment("c"), html: "<b>x</b>" }],
    [
      "__proto__ as a field",
      JSON.parse(`{"id":"c","pageId":"p","anchor":{"x":1,"y":1},"author":{"name":"A","colorIndex":0},"createdAt":1,"text":"t","resolved":false,"replies":[],"__proto__":{"x":1}}`),
    ],
    ["text that is too long", comment("c", { text: "x".repeat(MAX_COMMENT_TEXT + 1) })],
    ["no text", comment("c", { text: "" })],
    ["text that is not text", { ...comment("c"), text: { html: "x" } }],
    ["text with a control character", comment("c", { text: "a\u0007b" })],
    ["text with a mark that turns the direction of text around", comment("c", { text: "abc‮def" })],
    ["resolved that is not true or false", { ...comment("c"), resolved: "yes" }],
    ["a time that is not finite", { ...comment("c"), createdAt: Infinity }],
    ["a time below nothing", { ...comment("c"), createdAt: -1 }],
    ["an edit time that is text", { ...comment("c"), editedAt: "now" }],
    ["an anchor that is no place", { ...comment("c"), anchor: { x: "1", y: 2 } }],
    ["an anchor that is not finite", { ...comment("c"), anchor: { x: NaN, y: 2 } }],
    ["an anchor far away", { ...comment("c"), anchor: { x: 2_000_000, y: 2 } }],
    ["an anchor with a field it does not have", { ...comment("c"), anchor: { x: 1, y: 2, href: "javascript:1" } }],
    ["an anchor on an element with no offset", { ...comment("c"), anchor: { x: 1, y: 2, elementId: "a" } }],
    ["an anchor with an offset and no element", { ...comment("c"), anchor: { x: 1, y: 2, dx: 1, dy: 1 } }],
    ["an author that is not an object", { ...comment("c"), author: "Ann" }],
    ["an author with a colour of its own", { ...comment("c"), author: { name: "Ann", colorIndex: 1, color: "red" } }],
    ["an author whose colour is not in the list", { ...comment("c"), author: { name: "Ann", colorIndex: 12 } }],
    ["an author whose colour is half", { ...comment("c"), author: { name: "Ann", colorIndex: 1.5 } }],
    ["an author whose name is too long", { ...comment("c"), author: { name: "A".repeat(41), colorIndex: 1 } }],
    ["an author whose name has a line break", { ...comment("c"), author: { name: "A\nB", colorIndex: 1 } }],
    ["replies that are not a list", { ...comment("c"), replies: {} }],
    ["too many replies", comment("c", { replies: Array.from({ length: MAX_REPLIES + 1 }, (_, i) => reply(`r${i}`)) })],
    ["two replies with one id", comment("c", { replies: [reply("r"), reply("r")] })],
    ["a reply with a field it does not have", comment("c", { replies: [{ ...reply("r"), style: "color:red" } as CommentReply] })],
    ["a reply with no text", comment("c", { replies: [reply("r", { text: "" })] })],
    ["a reply that is not an object", { ...comment("c"), replies: ["yes"] }],
    ["a reply whose author has no name", comment("c", { replies: [{ ...reply("r"), author: { name: 5, colorIndex: 1 } } as never] })],
    ["a reply whose time is not one", comment("c", { replies: [{ ...reply("r"), createdAt: "now" } as never] })],
    ["a reply whose edit time is not one", comment("c", { replies: [{ ...reply("r"), editedAt: -3 }] })],
    ["an anchor that is a list", { ...comment("c"), anchor: [1, 2] }],
  ])("is refused: %s", (_name, value) => {
    expect(typeof readComment(value)).toBe("string");
  });

  it("keeps markup in the text as the text it is", () => {
    const text = `<img src=x onerror="alert(1)"> & <script>alert(2)</script>`;
    expect((readComment(comment("c", { text })) as DesignComment).text).toBe(text);
  });

  it("reads a reply on its own the same way", () => {
    expect(readReply(reply("r_1"))).toEqual(reply("r_1"));
    expect(typeof readReply({ ...reply("r_1"), id: "r 1" })).toBe("string");
    expect(typeof readReply({ ...reply("r_1"), resolved: true })).toBe("string");
  });
});

describe("a change of a comment that comes in", () => {
  it("may change its text, when it was changed, whether it is resolved, and its pin", () => {
    expect(readCommentPatch({ text: "New", editedAt: 9 })).toEqual({ text: "New", editedAt: 9 });
    expect(readCommentPatch({ resolved: true })).toEqual({ resolved: true });
    expect(readCommentPatch({ anchor: { x: 1, y: 2 } })).toEqual({ anchor: { x: 1, y: 2 } });
  });

  it.each<[string, unknown]>([
    ["nothing at all", {}],
    ["not an object", "text"],
    ["its id", { id: "other" }],
    ["its page", { pageId: "q" }],
    ["its author", { author: { name: "Eve", colorIndex: 1 } }],
    ["its replies", { replies: [] }],
    ["text that is too long", { text: "x".repeat(MAX_COMMENT_TEXT + 1) }],
    ["resolved as text", { resolved: "true" }],
    ["a pin that is no place", { anchor: { x: 1 } }],
    ["an edit time that is not one", { editedAt: Infinity }],
  ])("is refused: %s", (_name, value) => {
    expect(typeof readCommentPatch(value)).toBe("string");
  });

  it("of a reply may change its text and when, nothing else", () => {
    expect(readReplyPatch({ text: "Better", editedAt: 4 })).toEqual({ text: "Better", editedAt: 4 });
    expect(readReplyPatch({ editedAt: 4 })).toEqual({ editedAt: 4 });
    expect(typeof readReplyPatch({ author: author })).toBe("string");
    expect(typeof readReplyPatch({})).toBe("string");
    expect(typeof readReplyPatch("text")).toBe("string");
    expect(typeof readReplyPatch({ text: "" })).toBe("string");
    expect(typeof readReplyPatch({ editedAt: "now" })).toBe("string");
  });
});

describe("the comments of a design that arrives whole", () => {
  it("are fine when there are none, or when each is a comment and no id is there twice", () => {
    expect(commentsProblem(undefined)).toBeNull();
    expect(commentsProblem([])).toBeNull();
    expect(commentsProblem([comment("a"), comment("b")])).toBeNull();
  });

  it("are refused when they are not a list, too many, one is not a comment, or an id is there twice", () => {
    expect(commentsProblem({})).toMatch(/list/);
    expect(commentsProblem(Array.from({ length: MAX_COMMENTS + 1 }, (_, i) => comment(`c${i}`)))).toMatch(/too many/);
    expect(commentsProblem([comment("a"), { ...comment("b"), text: 5 }])).toMatch(/text/);
    expect(commentsProblem([comment("a"), comment("a")])).toMatch(/twice/);
  });
});

describe("the comments of a file", () => {
  it("keep what is usable, on pages that are there, and count what is left out", () => {
    const report = { skipped: 0 };
    const kept = usableComments(
      [comment("a"), comment("b", { pageId: "gone" }), { nonsense: true }, comment("a"), comment("c", { anchor: { x: 5_000_000, y: -5_000_000 } })],
      new Set(["p"]),
      report,
    );
    expect(kept.map((c) => c.id)).toEqual(["a", "c"]);
    expect(kept[1].anchor).toEqual({ x: 1_000_000, y: -1_000_000 });
    expect(report).toEqual({ skipped: 0, comments: 3 });
  });

  it("are none for anything that is no list, and at most as many as a design may hold", () => {
    expect(usableComments("x", new Set(["p"]))).toEqual([]);
    expect(usableComments([{ ...comment("a"), anchor: { x: "far", y: Infinity } }], new Set(["p"]))).toEqual([]);
    expect(usableComments(undefined, new Set(["p"]))).toEqual([]);
    const many = Array.from({ length: MAX_COMMENTS + 3 }, (_, i) => comment(`c${i}`));
    expect(usableComments(many, new Set(["p"]))).toHaveLength(MAX_COMMENTS);
  });
});

describe("what a person types", () => {
  it("is plain text without control characters or direction marks, trimmed and cut to the limit; line breaks stay", () => {
    expect(cleanCommentText("  one\r\ntwo\u0007 ‮ ")).toBe("one\ntwo");
    expect(cleanCommentText("x".repeat(MAX_COMMENT_TEXT + 50))).toHaveLength(MAX_COMMENT_TEXT);
  });
});

describe("where a pin is", () => {
  it("is its place, or where its element is now plus the offset, or its last place when the element is gone", () => {
    const d = design();
    const page = d.pages[0];
    expect(commentPosition(page, comment("c"))).toEqual({ x: 10, y: 20 });
    expect(commentPosition(page, comment("c", { anchor: { x: 1, y: 2, elementId: "a", dx: 5, dy: 6 } }))).toEqual({ x: 105, y: 106 });
    expect(commentPosition(page, comment("c", { anchor: { x: 1, y: 2, elementId: "gone", dx: 5, dy: 6 } }))).toEqual({ x: 1, y: 2 });
  });
});

describe("a step of the editor", () => {
  it("takes the comments of a page that goes with it", () => {
    const base = design([comment("a"), comment("b", { pageId: "q" })]);
    const next = { ...base, pages: [base.pages[0]] };
    expect(settleComments(base, next).comments!.map((c) => c.id)).toEqual(["a"]);
  });

  it("leaves a pin where its element was when the element is deleted, and puts it back on the element when that returns", () => {
    const base = design([comment("a", { anchor: { x: 0, y: 0, elementId: "a", dx: 5, dy: 6 } })]);
    const next = { ...base, pages: [{ ...base.pages[0], elements: [] }, base.pages[1]] };
    const settled = settleComments(base, next);
    expect(settled.comments![0].anchor).toEqual({ x: 105, y: 106, elementId: "a", dx: 5, dy: 6 });
    expect(commentPosition(settled.pages[0], settled.comments![0])).toEqual({ x: 105, y: 106 });
    // undo brings the element back, somewhere else by now: the pin is on it again
    const back = { ...settled, pages: [{ ...settled.pages[0], elements: [rect("a", 300, 300)] }, settled.pages[1]] };
    const again = settleComments(settled, back);
    expect(commentPosition(again.pages[0], again.comments![0])).toEqual({ x: 305, y: 306 });
  });

  it("changes nothing, and gives the same design, when no comment needs it", () => {
    const base = design([comment("a", { anchor: { x: 0, y: 0, elementId: "a", dx: 5, dy: 6 } })]);
    const moved = { ...base, pages: [{ ...base.pages[0], elements: [rect("a", 300, 300)] }, base.pages[1]] };
    expect(settleComments(base, moved)).toBe(moved);
    const none = design();
    expect(settleComments(none, { ...none, title: "x" })).toEqual({ ...none, title: "x" });
  });
});

describe("undo of a step that is no comment", () => {
  it("keeps the comments as they are now, takes away those whose page goes, and brings back those of a page that comes back", () => {
    const before = design([comment("old", { pageId: "q" })]);
    const now = { ...design([comment("new")]), pages: [before.pages[0]] };
    const carried = carryComments(now, before);
    expect(carried.pages).toBe(before.pages);
    expect(carried.comments!.map((c) => c.id)).toEqual(["new", "old"]);
    const pageOnly = { ...before, pages: [before.pages[1]] };
    expect(carryComments(now, pageOnly).comments!.map((c) => c.id)).toEqual(["old"]);
  });

  it("gives the restored design itself when neither has comments", () => {
    const restored = design();
    expect(carryComments(design(), restored)).toBe(restored);
  });
});

describe("the comments of a copy of the design", () => {
  it("are on the copies of their pages and elements; a pin on an element without a copy stays on the page, and a page without one takes its comments", () => {
    const from = design().pages;
    const to = [createPage({ id: "p2", elements: [rect("a2", 100, 100)] })];
    const copied = commentsForCopy(
      [
        comment("on", { anchor: { x: 1, y: 2, elementId: "a", dx: 3, dy: 4 } }),
        comment("lost", { anchor: { x: 5, y: 6, elementId: "gone", dx: 0, dy: 0 } }),
        comment("q", { pageId: "q" }),
      ],
      from,
      to,
    );
    expect(copied.map((c) => [c.id, c.pageId, c.anchor])).toEqual([
      ["on", "p2", { x: 1, y: 2, elementId: "a2", dx: 3, dy: 4 }],
      ["lost", "p2", { x: 5, y: 6 }],
    ]);
    expect(commentsForCopy(undefined, from, to)).toEqual([]);
  });
});

describe("a design without its comments", () => {
  it("is the same design when it has none, and one without the field when it has", () => {
    const none = design();
    expect(withoutComments(none)).toBe(none);
    expect("comments" in withoutComments(design([comment("a")]))).toBe(false);
  });
});
