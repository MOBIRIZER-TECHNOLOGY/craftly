import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import { useEditor } from "@/core/store";
import { useGesture } from "@/editor/canvas/gestureStore";
import { chromeDesign, clearToasts, listenOnWindow, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { TopBar } from "./TopBar";

const actions = () => useEditor.getState().actions;
const mount = (title = "Top bar design") => renderChrome(<TopBar />, chromeDesign(title));
const titleField = () => screen.getByRole("textbox", { name: "Design title" }) as HTMLInputElement;
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
});

afterEach(async () => {
  resetEditor();
  await clearToasts();
});

describe("<TopBar>: home, undo and redo", () => {
  it("goes back to the home page", async () => {
    await mount();
    window.location.hash = "#/design/somewhere";
    await userEvent.setup({ delay: null }).click(button("Home"));
    expect(window.location.hash).toBe("#/");
  });

  it("undoes and redoes the last change", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    const undo = button("Undo");
    const redo = button("Redo");
    expect(isDisabled(undo)).toBe(true);
    expect(isDisabled(redo)).toBe(true);
    act(() => actions().setTitle("Edited title"));
    expect(isDisabled(undo)).toBe(false);
    await user.click(undo);
    expect(storeDesign().title).toBe("Top bar design");
    expect(isDisabled(redo)).toBe(false);
    await user.click(redo);
    expect(storeDesign().title).toBe("Edited title");
    expect(isDisabled(redo)).toBe(true);
  });

  it("keeps undo and redo off while the design is only being viewed", async () => {
    await mount();
    act(() => actions().setTitle("Edited title"));
    act(() => actions().setMode("view"));
    const undo = button("Undo");
    expect(isDisabled(undo)).toBe(true);
    await userEvent.setup({ delay: null }).click(undo);
    expect(storeDesign().title).toBe("Edited title");
  });
});

describe("<TopBar>: undo and redo while a path is being placed", () => {
  /** a path of `count` points that the Pen has not finished */
  const placing = (count: number) =>
    act(() =>
      useGesture.setState({
        pen: {
          path: { closed: false, nodes: Array.from({ length: count }, (_unused, i) => ({ x: 100 + i * 100, y: 100, handleIn: null, handleOut: null })) },
          hover: null,
          pageId: useEditor.getState().activePageId,
        },
      }),
    );
  const points = () => useGesture.getState().pen?.path.nodes.length ?? 0;
  afterEach(() => act(() => useGesture.setState({ pen: null })));

  it("Undo takes the last point back, and is on even when the document has nothing to undo", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    const undo = button("Undo");
    expect(isDisabled(undo)).toBe(true);
    placing(3);
    expect(isDisabled(undo)).toBe(false);
    await user.click(undo);
    expect(points()).toBe(2);
    await user.click(undo);
    await user.click(undo);
    expect(points()).toBe(0);
    expect(isDisabled(undo)).toBe(true);
  });

  it("Undo leaves the document alone", async () => {
    await mount();
    act(() => actions().setTitle("Edited title"));
    placing(2);
    await userEvent.setup({ delay: null }).click(button("Undo"));
    expect(storeDesign().title).toBe("Edited title");
    expect(points()).toBe(1);
  });

  it("Redo is off, and comes back with the path that is finished or thrown away", async () => {
    await mount();
    act(() => actions().setTitle("Edited title"));
    act(() => actions().undo());
    const redo = button("Redo");
    expect(isDisabled(redo)).toBe(false);
    placing(2);
    expect(isDisabled(redo)).toBe(true);
    act(() => useGesture.setState({ pen: null }));
    expect(isDisabled(redo)).toBe(false);
  });
});

describe("<TopBar>: the save indicator", () => {
  it.each([
    ["saved", "All changes saved"],
    ["saving", "Saving..."],
    ["unsaved", "Unsaved changes"],
    ["error", "Couldn't save - storage is full or blocked"],
  ] as const)("shows the %s state", async (state, label) => {
    const { container } = await mount();
    act(() => actions().setSaveState(state));
    const indicator = button(label);
    expect(indicator.classList.contains(`is-${state}`)).toBe(true);
    // only a failure is announced to screen readers
    const announced = container.querySelector('.cf-sr-only[role="status"]');
    expect(announced?.textContent).toBe(state === "error" ? label : "");
  });

  it("saves right away when clicked", async () => {
    await mount();
    act(() => actions().setSaveState("unsaved"));
    const events = listenOnWindow("craftly:save-now");
    await userEvent.setup({ delay: null }).click(button("Unsaved changes"));
    expect(events).toHaveLength(1);
  });
});

describe("<TopBar>: the title", () => {
  it("shows the title of the design and follows it when it changes elsewhere", async () => {
    await mount("First name");
    expect(titleField().value).toBe("First name");
    expect(titleField().maxLength).toBe(120);
    act(() => actions().setTitle("Changed by undo or another tab"));
    expect(titleField().value).toBe("Changed by undo or another tab");
  });

  it("selects the whole title when it is focused", async () => {
    await mount("Select me");
    act(() => titleField().focus());
    expect(titleField().selectionStart).toBe(0);
    expect(titleField().selectionEnd).toBe("Select me".length);
  });

  it("renames the design on Enter", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.clear(titleField());
    await user.type(titleField(), "Brand new name{Enter}");
    expect(storeDesign().title).toBe("Brand new name");
    expect(document.activeElement).not.toBe(titleField());
    expect(useEditor.getState().saveState).toBe("unsaved");
  });

  it("renames the design when the field loses focus", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.clear(titleField());
    await user.type(titleField(), "Typed and left");
    await user.tab();
    expect(storeDesign().title).toBe("Typed and left");
  });

  it("trims the name", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.clear(titleField());
    await user.type(titleField(), "   padded   {Enter}");
    expect(storeDesign().title).toBe("padded");
    expect(titleField().value).toBe("padded");
  });

  it("falls back to 'Untitled design' for an empty name", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.clear(titleField());
    await user.keyboard("{Enter}");
    expect(storeDesign().title).toBe("Untitled design");
    expect(titleField().value).toBe("Untitled design");
  });

  it("keeps the old name on Escape", async () => {
    await mount("Keep this");
    const user = userEvent.setup({ delay: null });
    await user.clear(titleField());
    await user.type(titleField(), "Thrown away{Escape}");
    expect(storeDesign().title).toBe("Keep this");
    expect(titleField().value).toBe("Keep this");
    // the next edit works normally again
    await user.clear(titleField());
    await user.type(titleField(), "Second try{Enter}");
    expect(storeDesign().title).toBe("Second try");
  });

  it("does not add an undo step when the name did not change", async () => {
    await mount("Same name");
    const user = userEvent.setup({ delay: null });
    await user.click(titleField());
    await user.tab();
    expect(useEditor.getState().canUndo).toBe(false);
    expect(useEditor.getState().saveState).toBe("saved");
  });

  it("cannot be edited while the design is only being viewed", async () => {
    await mount("Read only");
    act(() => actions().setMode("view"));
    expect(titleField().readOnly).toBe(true);
    await userEvent.setup({ delay: null }).type(titleField(), "more{Enter}");
    expect(storeDesign().title).toBe("Read only");
  });
});

describe("<TopBar>: the mode", () => {
  it("switches between editing and viewing", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Editing mode"));
    const menu = screen.getByRole("menu", { name: "Mode" });
    expect(
      within(menu)
        .getByRole("menuitemcheckbox", { name: /^Editing/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(menu)
        .getByRole("menuitemcheckbox", { name: /^Viewing/ })
        .getAttribute("aria-checked"),
    ).toBe("false");
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /^Viewing/ }));
    expect(useEditor.getState().mode).toBe("view");
    expect(screen.queryByRole("menu", { name: "Mode" })).toBeNull();
    expect(button("Viewing mode").textContent).toContain("Viewing");
    expect(isDisabled(button("Resize"))).toBe(true);

    await user.click(button("Viewing mode"));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /^Editing/ }));
    expect(useEditor.getState().mode).toBe("edit");
    expect(isDisabled(button("Resize"))).toBe(false);
  });
});

describe("<TopBar>: resize", () => {
  it("opens the resize dialog from its small menu", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Resize"));
    const popover = screen.getByRole("dialog", { name: "Resize options" });
    await user.click(within(popover).getByRole("button", { name: /Change the size of your design/ }));
    expect(useEditor.getState().dialog).toBe("resize");
    expect(screen.queryByRole("dialog", { name: "Resize options" })).toBeNull();
  });

  it("puts the keyboard on the small resize menu's item, so that Enter opens the dialog", async () => {
    // as main.tsx renders the app: StrictMode runs the popover's effects twice
    await renderChrome(
      <StrictMode>
        <TopBar />
      </StrictMode>,
      chromeDesign("Strict"),
    );
    const user = userEvent.setup({ delay: null });
    await user.click(button("Resize"));
    const popover = screen.getByRole("dialog", { name: "Resize options" });
    expect(document.activeElement).toBe(within(popover).getByRole("button", { name: /Change the size of your design/ }));
    await user.keyboard("{Enter}");
    expect(useEditor.getState().dialog).toBe("resize");
  });

  it("closes the small resize menu with Escape without opening the dialog", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Resize"));
    expect(screen.getByRole("dialog", { name: "Resize options" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Resize options" })).toBeNull();
    expect(useEditor.getState().dialog).toBeNull();
  });
});

describe("<TopBar>: present", () => {
  it("starts the show from the current page", async () => {
    await mount();
    await userEvent.setup({ delay: null }).click(button("Present"));
    expect(useEditor.getState().presenting).toBe(true);
  });

  it("does nothing when the design has been closed underneath it", async () => {
    await mount();
    act(() => actions().closeDesign());
    await userEvent.setup({ delay: null }).click(button("Present"));
    expect(useEditor.getState().presenting).toBe(false);
  });

  it("offers only the current page on the first page", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Present options"));
    const menu = screen.getByRole("menu", { name: "Present" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["PresentPage 1"]);
    await user.click(items[0]);
    expect(useEditor.getState().presenting).toBe(true);
  });

  it("offers to start from the first page when another page is open", async () => {
    const { design } = await mount();
    act(() => actions().setActivePage(design.pages[2].id));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Present options"));
    const menu = screen.getByRole("menu", { name: "Present" });
    expect(within(menu).getByRole("menuitem", { name: /^Present\s*Page 3$/ })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Present from first page" }));
    const s = useEditor.getState();
    expect(s.presenting).toBe(true);
    expect(s.activePageId).toBe(design.pages[0].id);
  });

  it("has no page number to offer in a design with a single page", async () => {
    await renderChrome(<TopBar />, createDesign({ title: "One page", width: 800, height: 600, pages: [createPage()] }));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Present options"));
    const items = within(screen.getByRole("menu", { name: "Present" })).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Present"]);
  });
});

describe("<TopBar>: the share button", () => {
  it("opens the share panel", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    const share = button("Share");
    expect(share.getAttribute("aria-expanded")).toBe("false");
    await user.click(share);
    expect(share.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "Share design" })).toBeTruthy();
    await user.click(share);
    expect(screen.queryByRole("heading", { name: "Share design" })).toBeNull();
  });
});

describe("<TopBar>: renaming from the File menu", () => {
  it("jumps to the title field and selects it when there is room for it", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    await mount("Rename in place");
    const user = userEvent.setup({ delay: null });
    await user.click(button("File"));
    await user.click(screen.getByRole("button", { name: /^Rename design/ }));
    expect(document.activeElement).toBe(titleField());
    expect(titleField().selectionEnd).toBe("Rename in place".length);
    expect(useEditor.getState().dialog).toBeNull();
  });

  it("opens the rename dialog on a phone, where the title field is folded away", async () => {
    await mount("Rename in a dialog");
    const user = userEvent.setup({ delay: null });
    await user.click(button("File"));
    await user.click(screen.getByRole("button", { name: /^Rename design/ }));
    expect(useEditor.getState().dialog).toBe("rename");
  });
});

describe("<TopBar>: adding pictures from the File menu", () => {
  const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const choose = (files: File[]) => fireEvent.change(fileInput(), { target: { files } });
  const lastElement = () => {
    const s = useEditor.getState();
    const page = storeDesign().pages.find((p) => p.id === s.activePageId)!;
    return page.elements[page.elements.length - 1];
  };

  it("accepts pictures, svg files and several at a time", async () => {
    await mount();
    expect(fileInput().accept).toBe("image/*,.svg");
    expect(fileInput().multiple).toBe(true);
  });

  it("opens the file chooser from 'Upload files'", async () => {
    await mount();
    const click = vi.spyOn(fileInput(), "click");
    const user = userEvent.setup({ delay: null });
    await user.click(button("File"));
    await user.click(screen.getByRole("menuitem", { name: "Upload files" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("puts a chosen picture on the page", async () => {
    await mount();
    const before = storeDesign().pages[0].elements.length;
    choose([new File(["png"], "holiday.png", { type: "image/png" })]);
    await waitFor(() => expect(storeDesign().pages[0].elements).toHaveLength(before + 1));
    const added = lastElement();
    expect(added.type).toBe("image");
    expect(added.type === "image" && added.src).toMatch(/^asset:/);
    expect(fileInput().value).toBe("");
  });

  it("puts several pictures on the page, one after the other", async () => {
    await mount();
    const before = storeDesign().pages[0].elements.length;
    choose([new File(["a"], "one.png", { type: "image/png" }), new File(["b"], "two.jpg", { type: "image/jpeg" })]);
    await waitFor(() => expect(storeDesign().pages[0].elements).toHaveLength(before + 2));
  });

  it("explains when the files are not pictures", async () => {
    await mount();
    choose([new File(["text"], "notes.txt", { type: "text/plain" })]);
    expect(await screen.findByText("Craftly can't add those files. Try a PNG, JPG, GIF, WebP or SVG image.")).toBeTruthy();
  });

  it("explains when the pictures could not be stored", async () => {
    await mount();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("no space left");
    });
    choose([new File(["png"], "big.png", { type: "image/png" })]);
    expect(await screen.findByText("Couldn't add the files. Check that your browser has free storage and try again.")).toBeTruthy();
  });

  it("does nothing when the chooser is closed without a file", async () => {
    await mount();
    const before = storeDesign().pages[0].elements.length;
    choose([]);
    choose(null as unknown as File[]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(storeDesign().pages[0].elements).toHaveLength(before);
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });
});
