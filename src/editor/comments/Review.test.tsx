/**
 * Review and approval in the editor (docs/REVIEW.md): the review at the top of the Comments panel (its state, who and when,
 * whether it is about this version, and the buttons each role is offered), the store's action that sets it, a team's commenter
 * who comments in the read-only mode (the panel, the Comment tool on the page), Edit for one's own and Delete for an owner too, and
 * what a comment is signed with in a team's room.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { contentRevision } from "@/core/review";
import { useEditor, type LiveBridge } from "@/core/store";
import type { CommentAuthor, Design, DesignComment, DesignReview } from "@/core/types";
import { canvasDesign, mountWorkspace } from "@/test/canvasUtils";
import { resetEditor } from "@/test/helpers";
import { useLiveStatus } from "../live/connection";
import { usePresence } from "../live/presence";
import { CommentsPanel } from "./CommentsPanel";
import { announceArrivals, isMine, mayDelete, myAuthor, resetMine, useComments } from "./commentsStore";

const a = () => useEditor.getState().actions;
const design = () => useEditor.getState().design!;
const CORA = { id: "u_cora_0123456789a", owner: false };
const OWEN = { id: "u_owen_0123456789a", owner: true };
const cora: CommentAuthor = { name: "Cora", colorIndex: 2, id: CORA.id };
const eddie: CommentAuthor = { name: "Eddie", colorIndex: 5, id: "u_eddie_0123456789" };
const note = (id: string, author: CommentAuthor, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 100, y: 60 },
  author,
  createdAt: Date.UTC(2026, 10, 22, 9, 30),
  text: `Note ${id}`,
  resolved: false,
  replies: [],
  ...extra,
});
const open = (extra: { comments?: DesignComment[]; review?: DesignReview } = {}) => {
  const made = createDesign({ title: "Poster", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "box" })] })] });
  a().openDesign({ ...made, ...extra });
};
/** The design shared live as this role, as the connection leaves it (src/editor/live/connection.ts). */
const live = (role: "edit" | "comment" | "view", account: typeof CORA | null = null, shared?: () => Design | null) => {
  const sent: unknown[] = [];
  const bridge: LiveBridge = {
    change: (before, after) => sent.push([before, after]),
    sharesComments: () => true,
    sharesReview: () => true,
    commentsOnly: () => role === "comment",
    ...(shared ? { shared } : {}),
  };
  a().startLive(bridge);
  if (role !== "edit") a().setMode("view");
  useLiveStatus.setState({ status: "live", reason: null, role, stopped: false });
  useComments.setState({ sharing: "shared", reviews: true, commenting: role === "comment", account, panelOpen: true });
  usePresence.setState({ me: 3, fixedName: account ? (account.owner ? "Owen" : "Cora") : null });
  return sent;
};
const reviewOfState = (state: DesignReview["state"], by: CommentAuthor, revision = contentRevision(design())): DesignReview => ({
  v: 1,
  state,
  revision,
  by,
  at: Date.UTC(2026, 10, 22, 10),
});

beforeEach(() => {
  localStorage.clear();
  resetMine();
  resetEditor();
  useComments.setState(useComments.getInitialState(), true);
  useLiveStatus.setState({ status: "off", reason: null, role: null, stopped: false });
  usePresence.setState({ name: "", me: null, fixedName: null, people: [] });
});
afterEach(() => useComments.setState(useComments.getInitialState(), true));

describe("the review in the Comments panel", () => {
  it("is not there while the review is not shared", () => {
    open();
    useComments.setState({ panelOpen: true });
    render(<CommentsPanel />);
    expect(screen.queryByRole("heading", { name: "Review" })).toBeNull();
  });

  it("offers an editor to ask for a review, and to approve or ask for changes, about the design as it is", async () => {
    open();
    const sent = live("edit");
    render(<CommentsPanel />);
    const section = screen.getByRole("region", { name: "Review" });
    expect(within(section).getByRole("status").textContent).toBe("No review has been asked for.");
    await userEvent.click(within(section).getByRole("button", { name: "Request review" }));
    expect(design().review).toMatchObject({ v: 1, state: "requested", revision: contentRevision(design()), by: { name: "Guest 3" } });
    expect(sent).toHaveLength(1);
    expect(within(section).getByRole("status").textContent).toMatch(/^Guest 3 asked for a review on /);
    expect(within(section).getByText("This is about the design as it is now.")).toBeTruthy();
    // the state it is in is not offered again; the others are
    expect(within(section).queryByRole("button", { name: "Request review" })).toBeNull();
    expect(within(section).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Request changes" })).toBeTruthy();
  });

  it("says when it is about an earlier version, and offers its state again", () => {
    open();
    live("edit");
    act(() => void useEditor.setState({ design: { ...design(), review: reviewOfState("approved", cora, "r1-earlier") } }));
    render(<CommentsPanel />);
    const section = screen.getByRole("region", { name: "Review" });
    expect(within(section).getByRole("status").textContent).toMatch(/^Approved by Cora on /);
    expect(within(section).getByText("This is about an earlier version: the design has been edited since.").className).toContain("is-stale");
    // approved again, about the design as it is now
    act(() => within(section).getByRole("button", { name: "Approve" }).click());
    expect(design().review).toMatchObject({ state: "approved", revision: contentRevision(design()) });
    expect(within(section).getByText("This is about the design as it is now.")).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("offers a commenter to approve and ask for changes, and never to ask for a review", async () => {
    open();
    const sent = live("comment", CORA);
    render(<CommentsPanel />);
    const section = screen.getByRole("region", { name: "Review" });
    expect(within(section).queryByRole("button", { name: "Request review" })).toBeNull();
    await userEvent.click(within(section).getByRole("button", { name: "Request changes" }));
    expect(design().review).toMatchObject({ state: "changes", by: { name: "Cora", id: CORA.id } });
    expect(within(section).getByRole("status").textContent).toMatch(/^Cora asked for changes on /);
    expect(sent).toHaveLength(1);
  });

  it("offers a viewer nothing to press", () => {
    open({ review: { v: 1, state: "requested", revision: "r1-x", by: cora, at: 1 } });
    live("view");
    render(<CommentsPanel />);
    const section = screen.getByRole("region", { name: "Review" });
    expect(within(section).queryAllByRole("button")).toEqual([]);
  });
});

describe("the store's review", () => {
  it("is set about the content as it is, is no step of undo, and is not set in the read-only mode of somebody who may edit", () => {
    open();
    expect(a().setReview("requested", cora)).toBe(true);
    expect(design().review?.revision).toBe(contentRevision(design()));
    useEditor.setState({ selection: ["box"] });
    a().nudge(5, 0);
    expect(useEditor.getState().canUndo).toBe(true);
    a().undo();
    expect(design().review?.state).toBe("requested");
    a().setMode("view");
    expect(a().setReview("approved", cora)).toBe(false);
    a().closeDesign();
    expect(a().setReview("approved", cora)).toBe(false);
  });

  it("and the comments are changed by a commenter in the read-only mode, and nothing else", () => {
    open();
    live("comment", CORA);
    expect(a().addComment({ pageId: "p", anchor: { x: 1, y: 1 }, text: "hello", author: myAuthor() })).not.toBe("");
    expect(design().comments?.[0].author).toEqual({ name: "Cora", colorIndex: 3, id: CORA.id });
    const before = design().pages;
    useEditor.setState({ selection: ["box"] });
    a().nudge(5, 0);
    expect(design().pages).toBe(before);
  });
});

describe("the revision a review is about, in a shared design", () => {
  it("is that of the shared copy, not of the one here, whose text sizes this device works out with its own fonts", async () => {
    open();
    // the server's copy, and the one here with the size of a text worked out again (a font this device does not have)
    const server: Design = { ...design(), pages: [{ ...design().pages[0], elements: [{ ...design().pages[0].elements[0], width: 120 }] }] };
    act(() => useEditor.setState({ design: { ...server, pages: [{ ...server.pages[0], elements: [{ ...server.pages[0].elements[0], width: 133 }] }] } }));
    let shared: Design = server;
    live("comment", CORA, () => shared);
    expect(contentRevision(design())).not.toBe(contentRevision(server));
    expect(a().contentRevisionNow()).toBe(contentRevision(server));
    render(<CommentsPanel />);
    const section = screen.getByRole("region", { name: "Review" });
    await userEvent.click(within(section).getByRole("button", { name: "Approve" }));
    expect(design().review?.revision).toBe(contentRevision(server));
    // about the design as it is now, although the copy here hashes otherwise
    expect(within(section).getByText("This is about the design as it is now.")).toBeTruthy();
    // and out of date once the shared copy moves on (an edit of somebody else, which the store hears of)
    shared = { ...server, width: 801, review: design().review };
    act(() => a().applyShared(shared));
    expect(within(section).getByText("This is about an earlier version: the design has been edited since.")).toBeTruthy();
  });

  it("is that of the design here while it is not shared, and none without a design", () => {
    open();
    expect(a().contentRevisionNow()).toBe(contentRevision(design()));
    a().closeDesign();
    expect(a().contentRevisionNow()).toBe("");
  });
});

describe("a commenter in the Comments panel", () => {
  it("is told what they can do, and Add a comment takes the Comment tool", async () => {
    open();
    live("comment", CORA);
    render(<CommentsPanel />);
    expect(screen.getByText(/You comment on this design and can approve it or ask for changes/)).toBeTruthy();
    expect(screen.queryByText(/This link only lets you look/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add a comment" }));
    expect(useEditor.getState().tool).toBe("comment");
  });

  it("answers, edits their own comment, and is offered nothing on somebody else's but Resolve", async () => {
    open({ comments: [note("mine", cora), note("theirs", eddie)] });
    live("comment", CORA);
    render(<CommentsPanel />);
    const [mineThread, theirThread] = screen.getAllByRole("article");
    expect(within(mineThread).getByRole("button", { name: "Edit comment" })).toBeTruthy();
    expect(within(mineThread).getByRole("button", { name: "Delete comment" })).toBeTruthy();
    expect(within(theirThread).queryByRole("button", { name: "Edit comment" })).toBeNull();
    expect(within(theirThread).queryByRole("button", { name: "Delete comment" })).toBeNull();
    await userEvent.click(within(theirThread).getByRole("button", { name: "Resolve" }));
    expect(design().comments?.[1].resolved).toBe(true);
    await userEvent.type(within(mineThread).getByRole("textbox", { name: /^Reply to comment 1/ }), "Agreed{Enter}");
    expect(design().comments?.[0].replies[0]).toMatchObject({ text: "Agreed", author: { id: CORA.id } });
  });

  it("is an owner who deletes anybody's comment but edits only their own", () => {
    open({ comments: [note("theirs", eddie)] });
    live("edit", OWEN);
    render(<CommentsPanel />);
    const thread = screen.getByRole("article");
    expect(within(thread).queryByRole("button", { name: "Edit comment" })).toBeNull();
    expect(within(thread).getByRole("button", { name: "Delete comment" })).toBeTruthy();
  });
});

describe("whose a comment is in a team's room", () => {
  it("is the account that wrote it, as the server checks it; one with no account is nobody's but an owner's to delete", () => {
    open();
    useComments.setState({ account: CORA });
    expect(isMine(note("a", cora), design())).toBe(true);
    expect(isMine(note("b", eddie), design())).toBe(false);
    expect(isMine(note("c", { name: "Cora", colorIndex: 2 }), design())).toBe(false);
    expect(mayDelete(note("c", { name: "Cora", colorIndex: 2 }), design())).toBe(false);
    useComments.setState({ account: OWEN });
    expect(mayDelete(note("c", { name: "Cora", colorIndex: 2 }), design())).toBe(true);
  });

  it("is not announced to its own author", () => {
    open();
    useComments.setState({ account: CORA });
    announceArrivals({ ...design(), comments: [] }, { ...design(), comments: [note("a", cora)] });
    expect(useComments.getState().announcement.text).toBe("");
    announceArrivals({ ...design(), comments: [] }, { ...design(), comments: [note("b", eddie)] });
    expect(useComments.getState().announcement.text).toBe("New comment from Eddie: Note b");
  });
});

describe("the Comment tool of a commenter", () => {
  it("places a pin in the read-only mode, where nothing else can be done on the page", async () => {
    const rig = await mountWorkspace(canvasDesign());
    live("comment", CORA);
    act(() => a().setTool("comment"));
    rig.down(200, 450);
    rig.up(200, 450);
    expect(useComments.getState().draft).toMatchObject({ anchor: { x: 200, y: 450 } });
  });

  it("places nothing for somebody who only looks", async () => {
    const rig = await mountWorkspace(canvasDesign());
    live("view");
    act(() => a().setTool("comment"));
    rig.down(200, 450);
    rig.up(200, 450);
    expect(useComments.getState().draft).toBeNull();
  });
});
