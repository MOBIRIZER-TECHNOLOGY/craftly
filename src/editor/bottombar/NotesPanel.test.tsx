import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { chromeDesign, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { NotesPanel } from "./NotesPanel";

const actions = () => useEditor.getState().actions;
const notesOf = (index: number) => storeDesign().pages[index].notes;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
});

afterEach(() => {
  vi.useRealTimers();
  resetEditor();
});

const mount = (title = "Notes design") => renderChrome(<NotesPanel />, chromeDesign(title));
const textarea = (page = 1) => screen.getByRole("textbox", { name: `Notes for page ${page}` }) as HTMLTextAreaElement;
/** Types by setting the whole value, with the clock faked from here on (Testing Library's own waiting cannot cope with it). */
const fakeTyping = () => {
  vi.useFakeTimers();
  return (value: string) => fireEvent.change(textarea(), { target: { value } });
};

describe("<NotesPanel>", () => {
  it("shows the notes of the open page and which page that is", async () => {
    const { design } = await mount();
    expect(screen.getByRole("region", { name: "Presenter notes" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(textarea().value).toBe("Welcome everyone");
    expect(textarea().placeholder).toMatch(/Press N while presenting/);
    act(() => actions().setActivePage(design.pages[1].id));
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect(textarea(2).value).toBe("");
    act(() => actions().setActivePage(design.pages[2].id));
    expect(textarea(3).value).toBe("Thank you");
  });

  it("saves what is typed once typing pauses, as a single change", async () => {
    await mount();
    const type = fakeTyping();
    type("Welcome everyone and");
    type("Welcome everyone and welcome");
    expect(notesOf(0)).toBe("Welcome everyone");
    expect(textarea().value).toBe("Welcome everyone and welcome");
    act(() => void vi.advanceTimersByTime(399));
    expect(notesOf(0)).toBe("Welcome everyone");
    act(() => void vi.advanceTimersByTime(1));
    expect(notesOf(0)).toBe("Welcome everyone and welcome");
    expect(useEditor.getState().past).toHaveLength(1);
    act(() => actions().undo());
    expect(notesOf(0)).toBe("Welcome everyone");
  });

  it("restarts the wait while the person keeps typing", async () => {
    await mount();
    const type = fakeTyping();
    type("Welcome everyonea");
    act(() => void vi.advanceTimersByTime(300));
    type("Welcome everyoneab");
    act(() => void vi.advanceTimersByTime(300));
    expect(notesOf(0)).toBe("Welcome everyone");
    act(() => void vi.advanceTimersByTime(100));
    expect(notesOf(0)).toBe("Welcome everyoneab");
  });

  it("saves at once when the field loses focus", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(textarea(), "!");
    await user.tab();
    expect(notesOf(0)).toBe("Welcome everyone!");
  });

  it("saves what was typed on a page to that page when another page opens", async () => {
    const { design } = await mount();
    const type = fakeTyping();
    type("Welcome everyone today");
    act(() => actions().setActivePage(design.pages[1].id));
    expect(notesOf(0)).toBe("Welcome everyone today");
    expect(notesOf(1)).toBeUndefined();
    expect(textarea(2).value).toBe("");
    // the timer of the first page does not write anything to the second
    act(() => void vi.advanceTimersByTime(1000));
    expect(notesOf(1)).toBeUndefined();
  });

  it("saves what was typed when the panel is closed", async () => {
    const { unmount } = await mount();
    const type = fakeTyping();
    type("Welcome everyone?");
    unmount();
    expect(notesOf(0)).toBe("Welcome everyone?");
  });

  it("follows undo and redo of the notes", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.type(textarea(), " 2");
    await user.tab();
    expect(textarea().value).toBe("Welcome everyone 2");
    act(() => actions().undo());
    expect(textarea().value).toBe("Welcome everyone");
    act(() => actions().redo());
    expect(textarea().value).toBe("Welcome everyone 2");
  });

  it("does not replace what is being typed with a change that arrives meanwhile", async () => {
    const { design } = await mount();
    const type = fakeTyping();
    type("Welcome everyone typed");
    act(() => actions().setPageNotes(design.pages[0].id, "from elsewhere"));
    expect(textarea().value).toBe("Welcome everyone typed");
    act(() => void vi.advanceTimersByTime(500));
    expect(notesOf(0)).toBe("Welcome everyone typed");
  });

  it("closes from its button", async () => {
    await mount();
    act(() => useEditor.setState({ notesOpen: true }));
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Close notes" }));
    expect(useEditor.getState().notesOpen).toBe(false);
  });

  it("cannot be edited while the design is only being viewed", async () => {
    await mount();
    act(() => actions().setMode("view"));
    expect(textarea().readOnly).toBe(true);
    await userEvent.setup({ delay: null }).type(textarea(), "nope");
    expect(textarea().value).toBe("Welcome everyone");
    expect(notesOf(0)).toBe("Welcome everyone");
  });

  it("has no page number without a design", () => {
    const { container } = render(<NotesPanel />);
    expect(container.textContent).toContain("Page 0");
    expect(textarea(0).value).toBe("");
  });
});
