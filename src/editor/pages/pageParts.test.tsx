import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@/core/factory";
import { useEditor } from "@/core/store";
import { chromeDesign, clearToasts, fakeDataTransfer, fireDrag, pageIds, pageNames, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { PAGE_MIME, PageCaption, deletePageWithUndo, pageMenuItems, usePageReorder, useThrottled } from "./pageParts";

const actions = () => useEditor.getState().actions;

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(1000, 200);
});

afterEach(async () => {
  restoreLayout();
  vi.useRealTimers();
  resetEditor();
  await clearToasts();
});

describe("useThrottled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  it("starts with the value it is given", () => {
    const { result } = renderHook(() => useThrottled("first", 400));
    expect(result.current).toBe("first");
  });

  it("follows a change after the delay, not before", () => {
    const { result, rerender } = renderHook(({ value }) => useThrottled(value, 400), { initialProps: { value: 1 } });
    rerender({ value: 2 });
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(399));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(2);
  });

  it("applies only the latest of several quick changes", () => {
    const { result, rerender } = renderHook(({ value }) => useThrottled(value, 400), { initialProps: { value: 1 } });
    rerender({ value: 2 });
    act(() => void vi.advanceTimersByTime(100));
    rerender({ value: 3 });
    act(() => void vi.advanceTimersByTime(100));
    rerender({ value: 4 });
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toBe(4);
  });

  it("follows a change at once when the last update is long ago", () => {
    const { result, rerender } = renderHook(({ value }) => useThrottled(value, 400), { initialProps: { value: "a" } });
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ value: "b" });
    expect(result.current).toBe("b");
  });
});

/** Three rows that can be dragged, and a tail zone after them, driven by the hook. */
function Reorderable({ ids, onMove, enabled = true }: { ids: string[]; onMove: (id: string, to: number) => void; enabled?: boolean }) {
  const reorder = usePageReorder(ids, onMove, enabled);
  return (
    <ul data-drag={reorder.dragId ?? ""} data-slot={reorder.slot ?? ""}>
      {ids.map((id, i) => (
        <li key={id} data-testid={id} {...reorder.item(id, i)}>
          {id}
        </li>
      ))}
      <li data-testid="tail" {...reorder.tail()}>
        end
      </li>
    </ul>
  );
}

describe("usePageReorder", () => {
  const ids = ["a", "b", "c"];
  const row = (id: string) => screen.getByTestId(id);
  const list = () => document.querySelector("ul")!;

  it("marks the rows as draggable only when dragging is enabled", () => {
    const { rerender } = render(<Reorderable ids={ids} onMove={() => undefined} />);
    expect(row("a").draggable).toBe(true);
    rerender(<Reorderable ids={ids} onMove={() => undefined} enabled={false} />);
    expect(row("a").draggable).toBe(false);
  });

  it("remembers what is dragged and puts its id on the drag data", () => {
    render(<Reorderable ids={ids} onMove={() => undefined} />);
    const dt = fakeDataTransfer();
    fireDrag(row("b"), "dragStart", dt);
    expect(dt.getData(PAGE_MIME)).toBe("b");
    expect(dt.effectAllowed).toBe("move");
    expect(list().dataset.drag).toBe("b");
    fireDrag(row("b"), "dragEnd", dt);
    expect(list().dataset.drag).toBe("");
    expect(list().dataset.slot).toBe("");
  });

  it("does not start a drag when dragging is disabled", () => {
    render(<Reorderable ids={ids} onMove={() => undefined} enabled={false} />);
    const dt = fakeDataTransfer();
    fireDrag(row("a"), "dragStart", dt);
    expect(dt.data.size).toBe(0);
    expect(list().dataset.drag).toBe("");
  });

  it("shows the slot before a row over its left half and after it over its right half", () => {
    render(<Reorderable ids={ids} onMove={() => undefined} />);
    const dt = fakeDataTransfer();
    fireDrag(row("a"), "dragStart", dt);
    expect(fireDrag(row("b"), "dragOver", dt, 100)).toBe(false); // the row accepts the drop
    expect(dt.dropEffect).toBe("move");
    expect(list().dataset.slot).toBe("1");
    fireDrag(row("b"), "dragOver", dt, 900);
    expect(list().dataset.slot).toBe("2");
  });

  it("does not accept anything over a row unless one of its own rows is being dragged", () => {
    render(<Reorderable ids={ids} onMove={() => undefined} />);
    const dt = fakeDataTransfer();
    expect(fireDrag(row("b"), "dragOver", dt, 100)).toBe(true); // not prevented: no drop here
    expect(fireDrag(screen.getByTestId("tail"), "dragOver", dt)).toBe(true);
    expect(list().dataset.slot).toBe("");
  });

  it("moves a row forward to the slot where it was dropped", () => {
    const onMove = vi.fn();
    render(<Reorderable ids={ids} onMove={onMove} />);
    const dt = fakeDataTransfer();
    fireDrag(row("a"), "dragStart", dt);
    fireDrag(row("c"), "dragOver", dt, 900); // after the last row
    fireDrag(row("c"), "drop", dt);
    // once the row has been taken out, slot 3 is index 2
    expect(onMove).toHaveBeenCalledWith("a", 2);
    expect(list().dataset.drag).toBe("");
  });

  it("moves a row backwards", () => {
    const onMove = vi.fn();
    render(<Reorderable ids={ids} onMove={onMove} />);
    const dt = fakeDataTransfer();
    fireDrag(row("c"), "dragStart", dt);
    fireDrag(row("a"), "dragOver", dt, 100);
    fireDrag(row("a"), "drop", dt);
    expect(onMove).toHaveBeenCalledWith("c", 0);
  });

  it("moves a row to the end when it is dropped after the last one", () => {
    const onMove = vi.fn();
    render(<Reorderable ids={ids} onMove={onMove} />);
    const dt = fakeDataTransfer();
    fireDrag(row("a"), "dragStart", dt);
    expect(fireDrag(screen.getByTestId("tail"), "dragOver", dt)).toBe(false);
    expect(list().dataset.slot).toBe("3");
    fireDrag(screen.getByTestId("tail"), "drop", dt);
    expect(onMove).toHaveBeenCalledWith("a", 2);
  });

  it("does nothing when a row is dropped where it already is", () => {
    const onMove = vi.fn();
    render(<Reorderable ids={ids} onMove={onMove} />);
    const dt = fakeDataTransfer();
    fireDrag(row("b"), "dragStart", dt);
    fireDrag(row("b"), "dragOver", dt, 100); // slot 1: right before itself
    fireDrag(row("b"), "drop", dt);
    fireDrag(row("b"), "dragStart", dt);
    fireDrag(row("b"), "dragOver", dt, 900); // slot 2: right after itself
    fireDrag(row("b"), "drop", dt);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does nothing when the drop is not over any row, or when the row has vanished", () => {
    const onMove = vi.fn();
    const { rerender } = render(<Reorderable ids={ids} onMove={onMove} />);
    const dt = fakeDataTransfer();
    fireDrag(row("a"), "dragStart", dt);
    fireDrag(row("c"), "drop", dt); // never dragged over a row
    expect(onMove).not.toHaveBeenCalled();
    fireDrag(row("a"), "dragStart", dt);
    fireDrag(row("c"), "dragOver", dt, 900);
    rerender(<Reorderable ids={["b", "c"]} onMove={onMove} />); // the page was deleted meanwhile
    fireDrag(row("c"), "drop", dt);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores a drop that has nothing to do with the rows", () => {
    const onMove = vi.fn();
    render(<Reorderable ids={ids} onMove={onMove} />);
    expect(fireDrag(row("a"), "drop", fakeDataTransfer())).toBe(true);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("deletePageWithUndo", () => {
  it("deletes the page and offers to bring it back", async () => {
    const { design } = await renderChrome(<div />, chromeDesign("Delete page"));
    deletePageWithUndo(design.pages[1].id);
    expect(pageIds()).toEqual([design.pages[0].id, design.pages[2].id]);
    await userEvent.setup({ delay: null }).click(await screen.findByRole("button", { name: "Undo" }));
    expect(pageIds()).toEqual(design.pages.map((p) => p.id));
    expect(screen.queryByText("Page deleted")).toBeTruthy();
  });

  it("keeps the only page of a design", async () => {
    const { design } = await renderChrome(<div />, chromeDesign("One page"));
    act(() => {
      actions().deletePage(design.pages[2].id);
      actions().deletePage(design.pages[1].id);
    });
    deletePageWithUndo(design.pages[0].id);
    expect(pageIds()).toEqual([design.pages[0].id]);
    expect(screen.queryByText("Page deleted")).toBeNull();
  });

  it("does nothing while the design is only being viewed, or when no design is open", async () => {
    const { design } = await renderChrome(<div />, chromeDesign("Viewing"));
    act(() => actions().setMode("view"));
    deletePageWithUndo(design.pages[0].id);
    expect(pageIds()).toHaveLength(3);
    act(() => actions().closeDesign());
    expect(() => deletePageWithUndo(design.pages[0].id)).not.toThrow();
  });
});

describe("pageMenuItems", () => {
  const options = (patch: Partial<Parameters<typeof pageMenuItems>[0]> = {}) => ({ pageId: "x", index: 1, count: 3, hasName: false, readOnly: false, onRename: vi.fn(), ...patch });
  const labelled = (items: ReturnType<typeof pageMenuItems>) => items.flatMap((i) => (i.type === "divider" || i.type === "label" ? [] : [i]));
  const byId = (items: ReturnType<typeof pageMenuItems>, id: string) => labelled(items).find((i) => i.id === id)!;

  it("lists what can be done with a page", () => {
    const items = labelled(pageMenuItems(options()));
    expect(items.map((i) => i.label)).toEqual(["Add page title", "Duplicate page", "Present from this page", "Move left", "Move right", "Delete page"]);
    expect(items.every((i) => !i.disabled)).toBe(true);
    expect(byId(pageMenuItems(options()), "delete").danger).toBe(true);
  });

  it("offers to edit the title of a page that has one", () => {
    expect(labelled(pageMenuItems(options({ hasName: true })))[0].label).toBe("Edit page title");
  });

  it("disables moving past either end and deleting the only page", () => {
    expect(byId(pageMenuItems(options({ index: 0 })), "left").disabled).toBe(true);
    expect(byId(pageMenuItems(options({ index: 0 })), "right").disabled).toBe(false);
    expect(byId(pageMenuItems(options({ index: 2 })), "right").disabled).toBe(true);
    expect(byId(pageMenuItems(options({ index: 2 })), "left").disabled).toBe(false);
    expect(byId(pageMenuItems(options({ count: 1, index: 0 })), "delete").disabled).toBe(true);
  });

  it("only lets a viewer present", () => {
    const items = labelled(pageMenuItems(options({ readOnly: true })));
    expect(items.filter((i) => !i.disabled).map((i) => i.id)).toEqual(["present"]);
  });

  it("does what the items say", async () => {
    const { design } = await renderChrome(<div />, chromeDesign("Menu actions"));
    const [first, second, third] = design.pages.map((p) => p.id);
    const rename = vi.fn();
    const run = (pageId: string, index: number, id: string) => byId(pageMenuItems({ pageId, index, count: 3, hasName: false, readOnly: false, onRename: rename }), id).onSelect?.();

    run(second, 1, "title");
    expect(rename).toHaveBeenCalledTimes(1);

    act(() => run(second, 1, "duplicate"));
    expect(pageIds()).toHaveLength(4);
    expect(pageIds().indexOf(second)).toBe(1);

    act(() => run(third, 3, "present"));
    expect(useEditor.getState().presenting).toBe(true);
    expect(useEditor.getState().activePageId).toBe(third);

    act(() => run(first, 0, "right"));
    expect(pageIds().indexOf(first)).toBe(1);
    act(() => run(first, 1, "left"));
    expect(pageIds().indexOf(first)).toBe(0);

    act(() => run(third, 3, "delete"));
    expect(pageIds()).not.toContain(third);
    expect(screen.queryByText("Page deleted")).toBeTruthy();
  });
});

describe("<PageCaption>", () => {
  const page = createPage({ name: "Agenda" });

  it("shows the page title, with its number in the grid", () => {
    const { container, rerender } = render(<PageCaption page={page} index={1} editing={false} onDone={() => undefined} />);
    expect(screen.getByText("Agenda")).toBeTruthy();
    expect(container.querySelector(".cf-pagecap__num")).toBeNull();
    expect(container.querySelector(".cf-pagecap")?.getAttribute("title")).toBe("Agenda");
    rerender(<PageCaption page={page} index={1} editing={false} onDone={() => undefined} showNumber />);
    expect(container.querySelector(".cf-pagecap__num")?.textContent).toBe("2");
  });

  it("shows nothing for a page without a title", () => {
    const { container } = render(<PageCaption page={createPage()} index={0} editing={false} onDone={() => undefined} />);
    expect(container.querySelector(".cf-pagecap__name")).toBeNull();
  });

  describe("renaming", () => {
    const edit = async (name?: string) => {
      const { design } = await renderChrome(<div />, chromeDesign("Caption"));
      const target = design.pages[1];
      if (name) act(() => actions().setPageName(target.id, name));
      const current = storeDesign().pages[1];
      const onDone = vi.fn();
      render(<PageCaption page={current} index={1} editing onDone={onDone} showNumber />);
      return { input: screen.getByRole("textbox", { name: "Page title" }) as HTMLInputElement, onDone, id: target.id };
    };

    it("focuses the field with the title selected", async () => {
      const { input } = await edit("Old title");
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("Old title");
      expect(input.selectionEnd).toBe("Old title".length);
      expect(input.maxLength).toBe(60);
      expect(input.placeholder).toBe("Page title");
    });

    it("saves the new title on Enter", async () => {
      const { input, onDone, id } = await edit();
      const user = userEvent.setup({ delay: null });
      await user.type(input, "  Budget  {Enter}");
      expect(storeDesign().pages.find((p) => p.id === id)?.name).toBe("Budget");
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("saves the new title when the field loses focus", async () => {
      const { input, onDone, id } = await edit();
      const user = userEvent.setup({ delay: null });
      await user.type(input, "Roadmap");
      await user.tab();
      expect(pageNames()[1]).toBe("Roadmap");
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(storeDesign().pages.find((p) => p.id === id)?.name).toBe("Roadmap");
    });

    it("keeps the old title on Escape", async () => {
      const { input, onDone } = await edit("Keep me");
      const user = userEvent.setup({ delay: null });
      await user.type(input, " and more{Escape}");
      expect(pageNames()[1]).toBe("Keep me");
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("removes the title when the field is emptied", async () => {
      const { input } = await edit("Remove me");
      const user = userEvent.setup({ delay: null });
      await user.clear(input);
      await user.keyboard("{Enter}");
      expect(pageNames()[1]).toBeUndefined();
    });

    it("does not touch the document when nothing changed", async () => {
      const { input, onDone } = await edit("Same");
      const before = storeDesign();
      await userEvent.setup({ delay: null }).keyboard("{Enter}");
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(storeDesign()).toBe(before);
      expect(input.isConnected).toBe(true);
    });

    it("keeps clicks inside the field from reaching whatever is around it", () => {
      const parentClick = vi.fn();
      const parentDouble = vi.fn();
      render(
        <div onClick={parentClick} onDoubleClick={parentDouble}>
          <PageCaption page={page} index={0} editing onDone={() => undefined} />
        </div>,
      );
      const input = screen.getByRole("textbox", { name: "Page title" });
      fireEvent.click(input);
      fireEvent.doubleClick(input);
      expect(parentClick).not.toHaveBeenCalled();
      expect(parentDouble).not.toHaveBeenCalled();
    });
  });
});
