/**
 * Comments on the wire: what the server accepts of a comment operation, what a browser accepts of one and of a design with
 * comments, and how the two ends say that they understand comments (`features` in the join and in the welcome).
 */
import { describe, expect, it } from "vitest";
import { MAX_COMMENT_TEXT } from "@/core/comments";
import { createDesign, createPage } from "@/core/factory";
import type { CommentReply, Design, DesignComment } from "@/core/types";
import { checkDesign, checkOps, joinFeatures, parseServerMsg } from "./protocol";

const author = { name: "Ann", colorIndex: 0 };
const reply = (id: string, extra: Partial<CommentReply> = {}): CommentReply => ({ id, author, createdAt: 2, text: "yes", ...extra });
const comment = (id: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author,
  createdAt: 1,
  text: "note",
  resolved: false,
  replies: [],
  ...extra,
});
const design = (comments?: unknown): Design => {
  const made = createDesign({ title: "T", width: 100, height: 100, pages: [createPage({ id: "p" })] });
  return (comments === undefined ? made : { ...made, comments }) as Design;
};

describe("the comment operations the server accepts", () => {
  it("accepts each kind in the form it should have", () => {
    const ops = [
      { k: "comment.add", comment: comment("c1"), index: 0 },
      { k: "comment.set", id: "c1", set: { resolved: true } },
      { k: "comment.set", id: "c1", set: { text: "edited", editedAt: 5 } },
      { k: "comment.set", id: "c1", unset: ["editedAt"] },
      { k: "comment.del", id: "c1" },
      { k: "reply.add", comment: "c1", reply: reply("r1"), index: 3 },
      { k: "reply.set", comment: "c1", id: "r1", set: { text: "better", editedAt: 6 } },
      { k: "reply.set", comment: "c1", id: "r1", unset: ["editedAt"] },
      { k: "reply.del", comment: "c1", id: "r1" },
    ];
    expect(checkOps(ops)).toEqual(ops);
  });

  it("accepts code-like text as the text it is: it is shown as text and goes nowhere else", () => {
    const text = `<script>alert(1)</script><img src=x onerror=alert(2)> javascript:alert(3) {{constructor}}`;
    expect(checkOps([{ k: "comment.add", comment: comment("c", { text }), index: 0 }])).not.toBeTypeOf("string");
  });

  it.each<[string, unknown]>([
    ["an addition without a comment", { k: "comment.add", index: 0 }],
    ["an addition without an index", { k: "comment.add", comment: comment("c") }],
    ["an addition with an index that is not finite", { k: "comment.add", comment: comment("c"), index: Infinity }],
    ["an addition of text that is too long", { k: "comment.add", comment: comment("c", { text: "x".repeat(MAX_COMMENT_TEXT + 1) }), index: 0 }],
    ["an addition with an id that is not one", { k: "comment.add", comment: comment("c/../x"), index: 0 }],
    ["an addition with a field a comment does not have", { k: "comment.add", comment: { ...comment("c"), onclick: "x" }, index: 0 }],
    ["an addition with a colour on the wire", { k: "comment.add", comment: { ...comment("c"), author: { name: "A", colorIndex: 0, color: "url(x)" } }, index: 0 }],
    ["an addition with a field the operation does not have", { k: "comment.add", comment: comment("c"), index: 0, extra: 1 }],
    ["a change without an id", { k: "comment.set", set: { resolved: true } }],
    ["a change with an id that is not one", { k: "comment.set", id: "a b", set: { resolved: true } }],
    ["a change that changes nothing", { k: "comment.set", id: "c" }],
    ["a change of the author", { k: "comment.set", id: "c", set: { author } }],
    ["a change that takes the text away", { k: "comment.set", id: "c", unset: ["text"] }],
    ["a change whose removals are not a list", { k: "comment.set", id: "c", unset: "editedAt" }],
    ["a change of text that is too long", { k: "comment.set", id: "c", set: { text: "x".repeat(MAX_COMMENT_TEXT + 1) } }],
    ["a deletion with an id that is not one", { k: "comment.del", id: "" }],
    ["a reply to no comment", { k: "reply.add", reply: reply("r"), index: 0 }],
    ["a reply that is no reply", { k: "reply.add", comment: "c", reply: { id: "r" }, index: 0 }],
    ["a reply with no index", { k: "reply.add", comment: "c", reply: reply("r") }],
    ["a change of a reply's author", { k: "reply.set", comment: "c", id: "r", set: { author } }],
    ["a change of a reply with an id that is not one", { k: "reply.set", comment: "c", id: "<r>", set: { text: "x" } }],
    ["a change of a reply that takes its text away", { k: "reply.set", comment: "c", id: "r", unset: ["text"] }],
    ["a deletion of a reply without its comment", { k: "reply.del", id: "r" }],
  ])("refuses %s", (_name, op) => {
    expect(checkOps([op])).toBeTypeOf("string");
  });
});

describe("a design with comments that arrives whole", () => {
  it("is accepted with comments that are comments, and with none", () => {
    expect(checkDesign(design([comment("a", { replies: [reply("r")] })]))).toBeNull();
    expect(checkDesign(design())).toBeNull();
  });

  it("is refused with comments that are not", () => {
    expect(checkDesign(design("lots"))).toMatch(/list/);
    expect(checkDesign(design([comment("a", { text: "x".repeat(MAX_COMMENT_TEXT + 1) })]))).toMatch(/too long/);
    expect(checkDesign(design([comment("a"), comment("a")]))).toMatch(/twice/);
  });

  it("is refused as a welcome with comments that are not, and the welcome keeps those that are", () => {
    expect(parseServerMsg({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: design([{ id: "x" }]) })).toMatch(/^welcome: /);
    const ok = parseServerMsg({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: design([comment("a")]) }) as { design: Design };
    expect(ok.design.comments).toEqual([comment("a")]);
  });
});

describe("saying that comments are understood", () => {
  it("is read from a join that lists them, and from nothing else", () => {
    expect(joinFeatures({ t: "join", client: "c", key: "k", features: ["comments"] })).toEqual({ comments: true });
    expect(joinFeatures({ t: "join", client: "c", key: "k", features: ["later", "comments"] })).toEqual({ comments: true });
    expect(joinFeatures({ t: "join", client: "c", key: "k" })).toEqual({ comments: false });
    expect(joinFeatures({ t: "join", client: "c", key: "k", features: "comments" })).toEqual({ comments: false });
    expect(joinFeatures({ t: "join", client: "c", key: "k", features: [1, "comments"] })).toEqual({ comments: false });
    expect(joinFeatures({ t: "join", client: "c", key: "k", features: Array.from({ length: 40 }, () => "comments") })).toEqual({ comments: false });
    expect(joinFeatures(null)).toEqual({ comments: false });
  });

  it("is kept from a welcome that says it, without names this version does not know", () => {
    const heard = parseServerMsg({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: design(), features: ["comments", "something-newer"] });
    expect(heard).toMatchObject({ t: "welcome", features: ["comments"] });
    const none = parseServerMsg({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: design() }) as object;
    expect("features" in none).toBe(false);
  });

  it("ends the session when a welcome says it in a form it cannot have", () => {
    for (const features of ["comments", [5], ["x".repeat(41)], Array.from({ length: 17 }, () => "comments")]) {
      expect(parseServerMsg({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: design(), features })).toMatch(/^welcome: /);
    }
  });
});
