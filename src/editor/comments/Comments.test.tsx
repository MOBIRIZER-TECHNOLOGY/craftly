/**
 * What a person sees and does with comments: pins on the page (real buttons, numbered, in the author's colour, following the zoom
 * and their element), the editor of a new pin (Enter posts, Esc cancels, the keyboard goes in and comes back), the Comments panel
 * (threads of this page first, the filter, replies, resolving, editing and deleting one's own, which asks first; what it says to a
 * viewer and with a server that does not share comments), the button of the top bar with its count, the tool and its key, and the
 * one sentence a screen reader is told when somebody else comments. Texts are shown as text, never as markup.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { DesignComment } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { ShortcutsDialog } from "../dialogs/ShortcutsDialog";
import { installHotkeys } from "../hotkeys";
import { useLiveStatus } from "../live/connection";
import { PRESENCE_COLORS, usePresence } from "../live/presence";
import { ToolsPalette } from "../panels/tabs/ToolsPalette";
import { CommentsButton } from "./CommentsButton";
import { CommentsOverlay, pinName } from "./CommentsOverlay";
import { CommentsAnnouncer, CommentsPanel } from "./CommentsPanel";
import { announceArrivals, firstWords, isMine, myAuthor, placeDraft, rememberMine, resetMine, useComments } from "./commentsStore";

const a = () => useEditor.getState().actions;
const comments = () => useEditor.getState().design!.comments ?? [];
const ann = { name: "Ann", colorIndex: 1 };
const note = (id: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 100, y: 60 },
  author: ann,
  createdAt: Date.UTC(2026, 10, 14, 9, 30),
  text: `Note ${id}`,
  resolved: false,
  replies: [],
  ...extra,
});
const open = (list: DesignComment[] = []) => {
  const made = createDesign({
    title: "Poster",
    width: 1000,
    height: 600,
    pages: [createPage({ id: "p", elements: [createShape("rect", { id: "box", x: 200, y: 100, width: 100, height: 100 })] }), createPage({ id: "q", name: "Back" })],
  });
  a().openDesign({ ...made, comments: list });
  useEditor.setState({ zoom: 0.5 });
};
const mountCanvas = () =>
  render(
    <div data-cf-workspace tabIndex={0} data-testid="workspace">
      <div className="cf-pageframe">
        <CommentsOverlay />
      </div>
    </div>,
  );

beforeEach(() => {
  localStorage.clear();
  resetMine();
  resetEditor();
  useComments.setState(useComments.getInitialState(), true);
  useLiveStatus.setState({ status: "off", reason: null, role: null });
  usePresence.setState({ name: "", me: null, people: [] });
});
afterEach(() => useComments.setState(useComments.getInitialState(), true));

describe("the pins on the page", () => {
  it("are buttons named by number, author and first words, at their place at this zoom, in the author's colour from the list", () => {
    open([note("a"), note("b", { anchor: { x: 400, y: 200 }, text: "A rather long remark about the colour of the heading and more" })]);
    mountCanvas();
    const pins = screen.getAllByRole("button");
    expect(pins.map((p) => p.getAttribute("aria-label"))).toEqual(["Comment 1 by Ann: Note a", "Comment 2 by Ann: A rather long remark about the colour…"]);
    expect(pins[1].style.left).toBe("200px");
    expect(pins[1].style.top).toBe("100px");
    expect(pins[0].style.getPropertyValue("--cf-comment")).toBe(PRESENCE_COLORS[1]);
    expect(pins[0].hasAttribute("data-cf-ui")).toBe(true);
  });

  it("follow the element they are on, and stay where it was when it is gone", () => {
    open([note("a", { anchor: { x: 210, y: 110, elementId: "box", dx: 10, dy: 10 } })]);
    mountCanvas();
    act(() => a().updateElements(["box"], { x: 500 }));
    expect(screen.getByRole("button").style.left).toBe(`${510 * 0.5}px`);
    act(() => a().deleteElements(["box"]));
    expect(screen.getByRole("button").style.left).toBe(`${510 * 0.5}px`);
  });

  it("hide resolved comments unless Show resolved is on, and show only the comments of the open page", () => {
    open([note("a"), note("b", { resolved: true }), note("c", { pageId: "q" })]);
    mountCanvas();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    act(() => useComments.setState({ showResolved: true }));
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Comment 1 by Ann: Note a", "Comment 2 by Ann: Note b (resolved)"]);
  });

  it("put what people wrote on the page as text: markup in a comment is never markup", () => {
    open([note("a", { text: `<img src=x onerror="window.__hit=1">` })]);
    mountCanvas();
    expect(document.querySelector(".cf-comments-layer img")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("<img src=x");
  });

  it("are not there while presenting", () => {
    open([note("a")]);
    useEditor.setState({ presenting: true });
    mountCanvas();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("open the thread in the panel when clicked, and mark it", async () => {
    open([note("a")]);
    mountCanvas();
    await userEvent.click(screen.getByRole("button"));
    expect(useComments.getState()).toMatchObject({ panelOpen: true, focusThread: "a", highlight: "a" });
  });
});

describe("placing a pin", () => {
  it("is done where the page is pressed, on the element there if there is one, and not outside the page", () => {
    open();
    const design = useEditor.getState().design!;
    expect(placeDraft(design, "p", { x: 50, y: 40 }, null)).toBe(true);
    expect(useComments.getState().draft).toEqual({ pageId: "p", anchor: { x: 50, y: 40 } });
    placeDraft(design, "p", { x: 230, y: 150 }, { id: "box", x: 200, y: 100 });
    expect(useComments.getState().draft!.anchor).toEqual({ x: 230, y: 150, elementId: "box", dx: 30, dy: 50 });
    expect(placeDraft(design, "p", { x: -5, y: 40 }, null)).toBe(false);
    expect(placeDraft(design, "p", { x: 5, y: 4000 }, null)).toBe(false);
  });

  it("opens an editor that takes the keyboard; Enter posts, and the keyboard goes to the new pin", async () => {
    open();
    mountCanvas();
    act(() => void placeDraft(useEditor.getState().design!, "p", { x: 50, y: 40 }, null));
    const box = screen.getByRole("textbox", { name: "Comment" });
    expect(document.activeElement).toBe(box);
    await userEvent.type(box, "Bigger{Shift>}{Enter}{/Shift}please{Enter}");
    expect(comments()).toMatchObject([{ text: "Bigger\nplease", author: { name: "You" }, anchor: { x: 50, y: 40 } }]);
    const pin = screen.getByRole("button", { name: /^Comment 1 by You/ });
    expect(document.activeElement).toBe(pin);
    expect(useComments.getState().draft).toBeNull();
    expect(isMine(comments()[0].id, { ...useEditor.getState().design!, live: { server: "s", room: "r", key: "k", role: "edit" } })).toBe(true);
  });

  it("posts with the Post button too, and posts nothing that is empty", async () => {
    open();
    mountCanvas();
    act(() => void placeDraft(useEditor.getState().design!, "p", { x: 50, y: 40 }, null));
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(comments()).toEqual([]);
    await userEvent.type(screen.getByRole("textbox", { name: "Comment" }), "Here");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(comments()).toHaveLength(1);
  });

  it("is cancelled with Esc or Cancel: the pin goes, nothing is added, and the keyboard is back on the canvas", async () => {
    open();
    mountCanvas();
    act(() => void placeDraft(useEditor.getState().design!, "p", { x: 50, y: 40 }, null));
    await userEvent.type(screen.getByRole("textbox", { name: "Comment" }), "Never mind{Escape}");
    expect(useComments.getState().draft).toBeNull();
    expect(comments()).toEqual([]);
    expect(document.activeElement).toBe(screen.getByTestId("workspace"));
    act(() => void placeDraft(useEditor.getState().design!, "p", { x: 50, y: 40 }, null));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useComments.getState().draft).toBeNull();
  });

  it("signs with the name given for working together, and in a shared design with the colour of the connection", () => {
    usePresence.setState({ name: "Ann" });
    expect(myAuthor().name).toBe("Ann");
    usePresence.setState({ name: "", me: 14 });
    expect(myAuthor()).toEqual({ name: "Guest 14", colorIndex: 2 });
  });
});

describe("the Comments panel", () => {
  const mountPanel = () => render(<CommentsPanel />);
  beforeEach(() => useComments.setState({ panelOpen: true }));

  it("is not there while it is closed", () => {
    open([note("a")]);
    useComments.setState({ panelOpen: false });
    mountPanel();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("lists the open threads of this page first, then of the other pages, with author, time and text as text", () => {
    open([note("other", { pageId: "q", text: "On the back" }), note("here", { text: "<b>bold?</b>" }), note("done", { resolved: true })]);
    mountPanel();
    const panel = screen.getByRole("complementary", { name: "Comments" });
    const sections = within(panel)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(sections).toEqual(["On this page", "On other pages"]);
    const threads = within(panel).getAllByRole("article");
    expect(threads.map((t) => within(t).getByRole("heading", { level: 4 }).textContent)).toEqual(["Comment 1", "Comment 1, Page 2: Back"]);
    expect(within(threads[0]).getByText("<b>bold?</b>")).toBeTruthy();
    expect(panel.querySelector("b")).toBeNull();
    expect(within(threads[0]).getByText("Ann")).toBeTruthy();
    expect(within(threads[0]).getByText("Ann").closest(".cf-comment__byline")!.querySelector("time")!.getAttribute("datetime")).toBe("2026-11-14T09:30:00.000Z");
  });

  it("filters Open, Resolved and All", async () => {
    open([note("a"), note("b", { resolved: true })]);
    mountPanel();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await userEvent.click(screen.getByRole("radio", { name: "Resolved" }));
    expect(screen.getAllByRole("article").map((t) => t.textContent)).toEqual([expect.stringContaining("Note b")]);
    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    act(() => a().deleteComment("a"));
    act(() => a().deleteComment("b"));
    expect(screen.getByText("No comments yet.")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Resolved" }));
    expect(screen.getByText("No resolved comments.")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Open" }));
    expect(screen.getByText("No open comments.")).toBeTruthy();
  });

  it("shows the pins of resolved comments when asked", async () => {
    open([note("a")]);
    mountPanel();
    await userEvent.click(screen.getByRole("checkbox", { name: "Show resolved pins on the page" }));
    expect(useComments.getState().showResolved).toBe(true);
  });

  it("answers, resolves and reopens a thread", async () => {
    open([note("a")]);
    mountPanel();
    await userEvent.type(screen.getByRole("textbox", { name: "Reply to comment 1 by Ann" }), "On it{Enter}");
    expect(comments()[0].replies).toMatchObject([{ text: "On it", author: { name: "You" } }]);
    expect(screen.getByRole("list", { name: "Replies to comment 1" }).textContent).toContain("On it");
    await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(comments()[0].resolved).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(comments()[0].resolved).toBe(false);
  });

  it("edits this person's own comment and reply, and keeps a reply box that sends nothing empty", async () => {
    open([note("a")]);
    mountPanel();
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(comments()[0].replies).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const box = screen.getByRole("textbox", { name: "Edit your comment" });
    expect(document.activeElement).toBe(box);
    await userEvent.clear(box);
    await userEvent.type(box, "Changed{Enter}");
    expect(comments()[0]).toMatchObject({ text: "Changed" });
    expect(screen.getByText("(edited)")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Reply to comment 1 by Ann" }), "Mine");
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit reply" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Edit your reply" }), " too{Escape}");
    expect(comments()[0].replies[0].text).toBe("Mine");
    await userEvent.click(screen.getByRole("button", { name: "Edit reply" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit reply" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Edit your reply" }), " too");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(comments()[0].replies[0].text).toBe("Mine too");
  });

  it("asks before it deletes, and Keep keeps", async () => {
    open([note("a", { replies: [{ id: "r", author: ann, createdAt: 1, text: "Reply" }] })]);
    mountPanel();
    await userEvent.click(screen.getByRole("button", { name: "Delete reply" }));
    const ask = screen.getByRole("group", { name: "Delete this reply" });
    // the keyboard is on the safe answer
    expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Keep" }));
    await userEvent.click(within(ask).getByRole("button", { name: "Keep" }));
    expect(comments()[0].replies).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Delete reply" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Delete this reply" })).getByRole("button", { name: "Delete" }));
    expect(comments()[0].replies).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    expect(screen.getByRole("group", { name: "Delete this comment" }).textContent).toContain("cannot be undone");
    await userEvent.click(within(screen.getByRole("group", { name: "Delete this comment" })).getByRole("button", { name: "Delete" }));
    expect(comments()).toEqual([]);
  });

  it("offers Edit and Delete in a shared design only for this person's own messages", () => {
    open([note("theirs"), note("mine")]);
    useEditor.setState({ design: { ...useEditor.getState().design!, live: { server: "https://s.example", room: "r", key: "k", role: "edit" } } });
    rememberMine("mine");
    mountPanel();
    const [theirs, mine] = screen.getAllByRole("article");
    expect(within(theirs).queryByRole("button", { name: "Edit comment" })).toBeNull();
    expect(within(mine).getByRole("button", { name: "Edit comment" })).toBeTruthy();
  });

  it("goes to the page of a thread and marks its pin", async () => {
    open([note("back", { pageId: "q" })]);
    mountPanel();
    await userEvent.click(screen.getByRole("button", { name: "Show on page" }));
    expect(useEditor.getState().activePageId).toBe("q");
    expect(useComments.getState().highlight).toBe("back");
  });

  it("brings a thread whose pin was clicked into view and puts the keyboard on it", () => {
    open([note("a")]);
    useComments.setState({ focusThread: "a" });
    mountPanel();
    expect(document.activeElement).toBe(screen.getByRole("article"));
    expect(useComments.getState().focusThread).toBeNull();
  });

  it("says plainly that a server does not share comments", () => {
    open([note("a")]);
    useComments.setState({ sharing: "unsupported" });
    mountPanel();
    expect(screen.getByRole("note").textContent).toContain("This server does not share comments");
  });

  it("tells a viewer that they can read comments but not add them, and offers no box to write in", () => {
    open([note("a")]);
    useEditor.setState({ mode: "view" });
    useLiveStatus.setState({ status: "live", reason: null, role: "view" });
    mountPanel();
    expect(screen.getByRole("note").textContent).toContain("only lets you look");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
    useLiveStatus.setState({ status: "off", reason: null, role: null });
  });

  it("tells somebody in the Viewing mode how to comment", () => {
    open([note("a")]);
    useEditor.setState({ mode: "view" });
    mountPanel();
    expect(screen.getByRole("note").textContent).toContain("Switch to Editing");
  });

  it("closes with Esc or Close, and the keyboard goes back to the Comments button", async () => {
    open([note("a")]);
    render(
      <>
        <CommentsButton />
        <CommentsPanel />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });
    expect(useComments.getState().panelOpen).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Comments, 1 open" }));
    act(() => useComments.setState({ panelOpen: true }));
    await userEvent.click(screen.getByRole("button", { name: "Close comments" }));
    expect(useComments.getState().panelOpen).toBe(false);
  });

  it("closes on Esc pressed outside it too (on the page or a button of the top bar), leaving the keyboard where it was", async () => {
    open([note("a")]);
    const off = installHotkeys();
    try {
      render(
        <>
          <CommentsButton />
          <div data-cf-workspace tabIndex={0} data-testid="workspace" />
          <CommentsPanel />
        </>,
      );
      const workspace = screen.getByTestId("workspace");
      workspace.focus();
      await userEvent.keyboard("{Escape}");
      expect(useComments.getState().panelOpen).toBe(false);
      expect(document.activeElement).toBe(workspace);
      // from the Comments button that opened it
      await userEvent.click(screen.getByRole("button", { name: "Comments, 1 open" }));
      expect(useComments.getState().panelOpen).toBe(true);
      await userEvent.keyboard("{Escape}");
      expect(useComments.getState().panelOpen).toBe(false);
    } finally {
      off();
    }
  });

  it("lets a selection wait for the next Esc, and the draft of a pin or an edit with the keyboard take Esc first", async () => {
    open([note("a")]);
    const off = installHotkeys();
    try {
      render(
        <>
          <div data-cf-workspace tabIndex={0} data-testid="workspace">
            <div className="cf-pageframe">
              <CommentsOverlay />
            </div>
          </div>
          <CommentsPanel />
        </>,
      );
      act(() => useEditor.getState().actions.select(["box"]));
      // a pin being placed: Esc cancels it and the panel stays open
      act(() => void placeDraft(useEditor.getState().design!, "p", { x: 50, y: 40 }, null));
      await userEvent.type(screen.getByRole("textbox", { name: "Comment" }), "Draft{Escape}");
      expect(useComments.getState().draft).toBeNull();
      expect(useComments.getState().panelOpen).toBe(true);
      // an edit of a comment in the panel: Esc cancels the edit and the panel stays open
      await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("textbox", { name: "Edit your comment" })).toBeNull();
      expect(useComments.getState().panelOpen).toBe(true);
      // then the panel, and only then the selection
      screen.getByTestId("workspace").focus();
      await userEvent.keyboard("{Escape}");
      expect(useComments.getState().panelOpen).toBe(false);
      expect(useEditor.getState().selection).toEqual(["box"]);
      await userEvent.keyboard("{Escape}");
      expect(useEditor.getState().selection).toEqual([]);
    } finally {
      off();
    }
  });
});

describe("the Comments button", () => {
  it("says how many comments are open, and opens and closes the panel", async () => {
    open([note("a"), note("b"), note("c", { resolved: true })]);
    render(<CommentsButton />);
    const button = screen.getByRole("button", { name: "Comments, 2 open" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent).toBe("2");
    await userEvent.click(button);
    expect(useComments.getState().panelOpen).toBe(true);
    await userEvent.click(button);
    expect(useComments.getState().panelOpen).toBe(false);
  });

  it("is called Comments when none is open, and shows 99+ for many", () => {
    open();
    const { unmount } = render(<CommentsButton />);
    expect(screen.getByRole("button", { name: "Comments" }).textContent).toBe("");
    unmount();
    open(Array.from({ length: 120 }, (_, i) => note(`n${i}`)));
    render(<CommentsButton />);
    expect(screen.getByRole("button", { name: "Comments, 120 open" }).textContent).toBe("99+");
  });
});

describe("the Comment tool", () => {
  it("is in the tools, last, with its key", () => {
    open();
    render(<ToolsPalette onClose={() => undefined} />);
    const tools = screen.getAllByRole("button").filter((b) => b.closest(".cf-tools__card"));
    expect(tools.at(-1)!.getAttribute("aria-label")).toBe("Comment");
    fireEvent.click(tools.at(-1)!);
    expect(useEditor.getState().tool).toBe("comment");
  });

  it("is chosen with M, and only while editing", () => {
    open();
    const off = installHotkeys();
    fireEvent.keyDown(window, { key: "m" });
    expect(useEditor.getState().tool).toBe("comment");
    a().setTool("select");
    a().setMode("view");
    fireEvent.keyDown(window, { key: "m" });
    expect(useEditor.getState().tool).toBe("select");
    off();
  });

  it("is in the list of keyboard shortcuts, with its key", () => {
    render(<ShortcutsDialog open onClose={() => undefined} />);
    const row = screen.getByText("Comment: click the page to pin a note there").closest("li")!;
    expect(Array.from(row.querySelectorAll("kbd")).map((k) => k.textContent)).toEqual(["M"]);
  });
});

describe("what a screen reader is told", () => {
  it("is one polite sentence for each comment or reply of somebody else, nothing for this person's own, and one for many", () => {
    render(<CommentsAnnouncer />);
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    const base = { ...createDesign({ width: 10, height: 10 }), comments: [note("a")] };
    act(() =>
      announceArrivals(base, {
        ...base,
        comments: [note("a", { replies: [{ id: "r", author: { name: "Bob", colorIndex: 0 }, createdAt: 1, text: "Yes" }] }), note("b", { author: { name: "Cy", colorIndex: 0 } })],
      }),
    );
    expect(region.textContent).toBe("New reply from Bob: Yes New comment from Cy: Note b");
    rememberMine("own");
    act(() => announceArrivals(base, { ...base, comments: [note("a"), note("own")] }));
    expect(region.textContent).toBe("New reply from Bob: Yes New comment from Cy: Note b");
    act(() => announceArrivals(null, { ...base, comments: ["w", "x", "y", "z"].map((id) => note(id)) }));
    expect(region.textContent).toBe("4 new comments and replies.");
  });

  it("is cut to the first words", () => {
    expect(firstWords("short")).toBe("short");
    expect(firstWords("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
  });

  it("names a pin by its number, its author and its first words", () => {
    expect(pinName(3, note("a", { text: "Hello  there\nfriend" }))).toBe("Comment 3 by Ann: Hello there friend");
  });
});
