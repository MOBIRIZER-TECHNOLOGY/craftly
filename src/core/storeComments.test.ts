/**
 * Comments in the editor store: adding, answering, editing, resolving and deleting them; that they are no steps of undo (they are
 * what people said, and in a shared design what others answered), alone and in a shared design; and that a page that goes takes
 * its comments with it, and an element that goes leaves the pins on it where it was, until undo brings it back.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffDesign } from "@/collab/ops";
import { MAX_COMMENTS, commentPosition } from "./comments";
import { createDesign, createPage, createShape } from "./factory";
import { useEditor, type LiveBridge } from "./store";
import type { Design, DesignComment, DesignElement } from "./types";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const comments = () => s().design!.comments ?? [];
const rect = (id: string, x = 0, y = 0) => createShape("rect", { id, x, y, width: 100, height: 50 });
const ann = { name: "Ann", colorIndex: 2 };

function open(elements: DesignElement[] = [rect("a", 100, 100)]) {
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(createDesign({ title: "Notes", width: 1000, height: 600, pages: [createPage({ id: "p1", elements }), createPage({ id: "p2" })] }));
}
const note = (text = "Bigger, please", pageId = "p1") => a().addComment({ pageId, anchor: { x: 10, y: 20 }, text, author: ann });

beforeEach(() => open());
afterEach(() => a().stopLive());

describe("adding a comment", () => {
  it("pins it to the page with the author, the time and the text, open, with no replies", () => {
    const id = note();
    expect(id).toMatch(/^c_/);
    const [made] = comments();
    expect(made).toMatchObject({ id, pageId: "p1", anchor: { x: 10, y: 20 }, author: ann, text: "Bigger, please", resolved: false, replies: [] });
    expect(made.createdAt).toBeGreaterThan(0);
    expect(s().saveState).toBe("unsaved");
  });

  it("anchors it to an element at its place on the element", () => {
    const id = a().addComment({ pageId: "p1", anchor: { x: 120, y: 130, elementId: "a", dx: 20, dy: 30 }, text: "Here", author: ann });
    expect(comments().find((c) => c.id === id)!.anchor).toEqual({ x: 120, y: 130, elementId: "a", dx: 20, dy: 30 });
  });

  it("keeps plain text only, trimmed, and adds nothing for a text that is empty once cleaned", () => {
    note("  two\u0007 lines\r\nhere  ");
    expect(comments()[0].text).toBe("two lines\nhere");
    expect(note(" ‮ ")).toBe("");
    expect(comments()).toHaveLength(1);
  });

  it("adds nothing on a page that is not there, while the design is only looked at, or past the most a design may hold", () => {
    expect(note("x", "nowhere")).toBe("");
    a().setMode("view");
    expect(note()).toBe("");
    a().setMode("edit");
    useEditor.setState({
      design: {
        ...s().design!,
        comments: Array.from(
          { length: MAX_COMMENTS },
          (_, i) => ({ ...comments()[0], id: `c${i}`, pageId: "p1", anchor: { x: 0, y: 0 }, author: ann, createdAt: 1, text: "t", resolved: false, replies: [] }) as DesignComment,
        ),
      },
    });
    expect(note()).toBe("");
  });

  it("holds a pin that is placed far outside the page at the furthest a pin may be", () => {
    a().addComment({ pageId: "p1", anchor: { x: 9e9, y: -9e9 }, text: "far", author: ann });
    expect(comments()[0].anchor).toEqual({ x: 1_000_000, y: -1_000_000 });
  });
});

describe("the thread of a comment", () => {
  it("takes replies, edits of a comment and of a reply with the time of the edit, resolving and reopening, and deletions", () => {
    const id = note();
    const r = a().replyToComment(id, "On it", { name: "Bob", colorIndex: 4 });
    expect(comments()[0].replies).toMatchObject([{ id: r, text: "On it", author: { name: "Bob", colorIndex: 4 } }]);
    a().editComment(id, "Much bigger");
    expect(comments()[0]).toMatchObject({ text: "Much bigger" });
    expect(comments()[0].editedAt).toBeGreaterThan(0);
    a().editComment(id, "Done", r);
    expect(comments()[0].replies[0]).toMatchObject({ text: "Done" });
    expect(comments()[0].replies[0].editedAt).toBeGreaterThan(0);
    a().setCommentResolved(id, true);
    expect(comments()[0].resolved).toBe(true);
    a().setCommentResolved(id, false);
    expect(comments()[0].resolved).toBe(false);
    a().deleteComment(id, r);
    expect(comments()[0].replies).toEqual([]);
    a().deleteComment(id);
    expect(comments()).toEqual([]);
  });

  it("does nothing for a comment or reply that is not there, an empty text, or a text that did not change", () => {
    const id = note();
    const before = s().design;
    expect(a().replyToComment("gone", "x", ann)).toBe("");
    expect(a().replyToComment(id, "   ", ann)).toBe("");
    a().editComment(id, "Bigger, please");
    a().editComment(id, "");
    a().editComment(id, "x", "gone");
    a().deleteComment("gone");
    a().deleteComment(id, "gone");
    a().setCommentResolved("gone", true);
    expect(s().design).toBe(before);
  });
});

describe("comments and undo, in a design of one's own", () => {
  it("are no step of undo: undoing the step before a comment takes that step back and leaves the comment", () => {
    a().updateElements(["a"], { x: 300 });
    note();
    a().undo();
    expect(s().design!.pages[0].elements[0].x).toBe(100);
    expect(comments()).toHaveLength(1);
    a().redo();
    expect(s().design!.pages[0].elements[0].x).toBe(300);
    expect(comments()).toHaveLength(1);
  });

  it("do not make undo possible by themselves", () => {
    note();
    expect(s().canUndo).toBe(false);
  });

  it("go with the page they are on, and come back with it when its deletion is undone", () => {
    note("on two", "p2");
    note("on one");
    a().deletePage("p2");
    expect(comments().map((c) => c.text)).toEqual(["on one"]);
    a().undo();
    expect(
      comments()
        .map((c) => c.text)
        .sort(),
    ).toEqual(["on one", "on two"]);
  });

  it("stay where their element was when it is deleted, and are on it again when undo brings it back", () => {
    a().addComment({ pageId: "p1", anchor: { x: 0, y: 0, elementId: "a", dx: 20, dy: 30 }, text: "Here", author: ann });
    a().deleteElements(["a"]);
    expect(comments()[0].anchor).toEqual({ x: 120, y: 130, elementId: "a", dx: 20, dy: 30 });
    expect(commentPosition(s().design!.pages[0], comments()[0])).toEqual({ x: 120, y: 130 });
    a().undo();
    a().updateElements(["a"], { x: 400, y: 300 });
    expect(commentPosition(s().design!.pages[0], comments()[0])).toEqual({ x: 420, y: 330 });
  });
});

describe("comments in a shared design", () => {
  let told: Array<{ before: Design; after: Design }>;
  let shares = true;
  const bridge: LiveBridge = { change: (before, after) => void told.push({ before, after }), sharesComments: () => shares };
  beforeEach(() => {
    told = [];
    shares = true;
    a().startLive(bridge);
  });

  it("are told to the connection like every change, and are no step of this person's undo", () => {
    a().updateElements(["a"], { x: 300 });
    const id = note();
    expect(diffDesign(told[1].before, told[1].after).map((op) => op.k)).toEqual(["comment.add"]);
    a().undo();
    expect(s().design!.pages[0].elements[0].x).toBe(100);
    expect(comments().map((c) => c.id)).toEqual([id]);
    expect(s().canUndo).toBe(false);
  });

  it("take what the others did to the comments when the server shares them, and keep this person's own when it does not", () => {
    note("mine");
    const theirs = { ...s().design!, comments: [{ ...comments()[0], id: "c_theirs", text: "theirs" }] };
    a().applyShared(theirs);
    expect(comments().map((c) => c.text)).toEqual(["theirs"]);
    shares = false;
    a().applyShared({ ...theirs, title: "Renamed", comments: [] });
    expect(s().design!.title).toBe("Renamed");
    expect(comments().map((c) => c.text)).toEqual(["theirs"]);
  });

  it("are kept as they are by a connection that does not say whether it shares comments", () => {
    a().stopLive();
    a().startLive({ change: () => undefined });
    note("mine");
    a().applyShared({ ...s().design!, title: "Renamed", comments: [] });
    expect(comments().map((c) => c.text)).toEqual(["mine"]);
  });
});
