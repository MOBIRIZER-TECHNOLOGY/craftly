import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_MIME } from "@/editor/insert";
import { IconPlus } from "@/ui";
import { fakeDataTransfer, renderSettled } from "@/test/tabsHarness";
import { stubLayout } from "@/test/helpers";
import { CategoryTile } from "./CategoryTile";
import { ChipRow } from "./ChipRow";
import { DraggableItem } from "./DraggableItem";
import { EmptyHint } from "./EmptyHint";
import { ItemGrid, LazyBox, Masonry, VirtualGrid } from "./ItemGrid";
import { PanelBoundary } from "./PanelBoundary";
import { PanelHeader } from "./PanelHeader";
import { Panel, PanelLink, PanelScroll, PanelSection, PanelTop, usePanelScroller } from "./PanelLayout";
import { PanelSearch } from "./PanelSearch";
import { ShapePreview } from "./ShapePreview";

/** An IntersectionObserver the test drives by hand (the harness's own reports "visible" at once). */
class ManualObserver {
  static all: ManualObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    ManualObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  report(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  takeRecords() {
    return [];
  }
}

function withManualObserver() {
  const original = globalThis.IntersectionObserver;
  // the panels share one observer per scroll area for the life of the module, so earlier observers stay in the list
  globalThis.IntersectionObserver = ManualObserver as unknown as typeof IntersectionObserver;
  return () => {
    globalThis.IntersectionObserver = original;
  };
}

/** Tell every manual observer that `el` has (not) scrolled near the viewport. */
function intersect(el: Element, isIntersecting: boolean) {
  act(() => {
    for (const o of ManualObserver.all) if (o.targets.has(el)) o.report(el, isIntersecting);
  });
}

describe("<ChipRow>", () => {
  const chips = [
    { id: "all", label: "All" },
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ];

  /** Fakes a row that is wider than its box, scrolled to `left`. */
  function overflow(scroller: HTMLElement, left: number) {
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "scrollLeft", { configurable: true, value: left });
    fireEvent.scroll(scroller);
  }

  it("marks the selected chip and reports the chip that is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipRow chips={chips} value="a" onChange={onChange} aria-label="Categories" />);
    const group = screen.getByRole("group", { name: "Categories" });
    expect(within(group).getByRole("button", { name: "Alpha" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(within(group).getByRole("button", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("leaves every chip unselected when there is no value", () => {
    render(<ChipRow chips={chips} value={null} onChange={() => undefined} aria-label="Categories" />);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
  });

  it("keeps the selected chip in view when the selection changes", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const { rerender } = render(<ChipRow chips={chips} value="all" onChange={() => undefined} aria-label="Categories" />);
    scrollIntoView.mockClear();
    rerender(<ChipRow chips={chips} value="b" onChange={() => undefined} aria-label="Categories" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("button", { name: "Beta" }));
  });

  it("shows scroll arrows only on the side where more chips are hidden, and scrolls by 180px", async () => {
    const user = userEvent.setup();
    const { container } = render(<ChipRow chips={chips} value="all" onChange={() => undefined} aria-label="Categories" className="mine" />);
    const row = container.firstElementChild as HTMLElement;
    const scroller = screen.getByRole("group", { name: "Categories" });
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as unknown as typeof scroller.scrollBy;
    expect(row.classList.contains("mine")).toBe(true);
    expect(screen.queryByRole("button", { name: "Scroll left" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scroll right" })).toBeNull();

    overflow(scroller, 0);
    expect(screen.queryByRole("button", { name: "Scroll left" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Scroll right" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 180, behavior: "smooth" });
    expect(row.classList.contains("has-right")).toBe(true);

    overflow(scroller, 120);
    await user.click(screen.getByRole("button", { name: "Scroll left" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -180, behavior: "smooth" });
    expect(row.classList.contains("has-left")).toBe(true);

    overflow(scroller, 300);
    expect(screen.queryByRole("button", { name: "Scroll right" })).toBeNull();
    expect(row.classList.contains("has-right")).toBe(false);
  });

  it("ignores a resize report that arrives after the row has been removed", () => {
    const original = globalThis.ResizeObserver;
    const callbacks: ResizeObserverCallback[] = [];
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const { unmount } = render(<ChipRow chips={chips} value="all" onChange={() => undefined} aria-label="Categories" />);
      unmount();
      expect(callbacks.length).toBeGreaterThan(0);
      expect(() => callbacks.forEach((callback) => callback([], {} as ResizeObserver))).not.toThrow();
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

describe("<PanelSearch>", () => {
  function Controlled(props: { onSubmit?: (v: string) => void; initial?: string; extra?: Partial<Parameters<typeof PanelSearch>[0]> }) {
    const [value, setValue] = useState(props.initial ?? "");
    return <PanelSearch value={value} onChange={setValue} placeholder="Search things" onSubmit={props.onSubmit} {...props.extra} />;
  }

  it("is a labelled search box that reports what is typed", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole("searchbox", { name: "Search things" }) as HTMLInputElement;
    expect(screen.getByRole("search")).toBeTruthy();
    await user.type(box, "cat");
    expect(box.value).toBe("cat");
  });

  it("uses an explicit accessible name instead of the placeholder", () => {
    render(<Controlled extra={{ "aria-label": "Find a font" }} />);
    expect(screen.getByRole("searchbox", { name: "Find a font" }).getAttribute("placeholder")).toBe("Search things");
  });

  it("offers a clear button only while there is text, and keeps focus in the field", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="dog" />);
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box.value).toBe("");
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("clears with Escape first and lets Escape through when the field is already empty", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Controlled initial="dog" />
      </div>,
    );
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    await user.click(box);
    await user.keyboard("{Escape}");
    expect(box.value).toBe("");
    expect(outer).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("submits the text on Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Controlled onSubmit={onSubmit} initial="moon" />);
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("moon");
  });

  it("ignores Enter when nobody listens for a submit", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="moon" />);
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("{Enter}");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("moon");
  });

  it("can turn its leading glyph into a button, and shows trailing controls", async () => {
    const user = userEvent.setup();
    const onLeadingClick = vi.fn();
    render(<Controlled extra={{ leading: <IconPlus />, onLeadingClick, leadingLabel: "New folder", trailing: <button type="button">Filter</button> }} />);
    await user.click(screen.getByRole("button", { name: "New folder" }));
    expect(onLeadingClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
  });

  it("names the leading button after the search options when no label is given", () => {
    render(<Controlled extra={{ onLeadingClick: () => undefined }} />);
    expect(screen.getByRole("button", { name: "Search options" })).toBeTruthy();
  });

  it("forwards its ref to the input", () => {
    const ref = createRef<HTMLInputElement>();
    render(<PanelSearch ref={ref} value="" onChange={() => undefined} placeholder="Search" autoFocus />);
    expect(ref.current).toBe(screen.getByRole("searchbox"));
    expect(document.activeElement).toBe(ref.current);
  });
});

describe("<PanelHeader>", () => {
  it("shows a title and subtitle without any buttons by default", () => {
    render(<PanelHeader title="Shapes" subtitle="Pick one" />);
    expect(screen.getByRole("heading", { name: "Shapes" })).toBeTruthy();
    expect(screen.getByText("Pick one")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("offers back and close buttons with their own labels, and extra actions", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onClose = vi.fn();
    render(<PanelHeader title="Frames" onBack={onBack} backLabel="Back to all" onClose={onClose} closeLabel="Dismiss" actions={<button type="button">Extra</button>} />);
    await user.click(screen.getByRole("button", { name: "Back to all" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Extra" })).toBeTruthy();
  });

  it("falls back to 'Back' and 'Close'", () => {
    render(<PanelHeader title="Tables" onBack={() => undefined} onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("panel layout", () => {
  it("stacks a fixed top over a scrolling body", () => {
    const { container } = render(
      <Panel className="mine">
        <PanelTop className="top">search</PanelTop>
        <PanelScroll className="body" flush>
          content
        </PanelScroll>
      </Panel>,
    );
    expect(container.querySelector(".cf-panel.mine")).toBeTruthy();
    expect(container.querySelector(".cf-panel__top.top")?.textContent).toBe("search");
    const scroll = container.querySelector(".cf-panel__scroll");
    expect(scroll?.classList.contains("is-flush")).toBe(true);
    expect(scroll?.classList.contains("body")).toBe(true);
  });

  it("is not flush unless asked, and reports scrolling", () => {
    const onScroll = vi.fn();
    const { container } = render(<PanelScroll onScroll={onScroll}>x</PanelScroll>);
    const scroll = container.querySelector(".cf-panel__scroll") as HTMLElement;
    expect(scroll.classList.contains("is-flush")).toBe(false);
    fireEvent.scroll(scroll);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("hands its scroll element to lazy lists inside it", () => {
    let seen: HTMLElement | null | undefined;
    function Probe() {
      seen = usePanelScroller();
      return null;
    }
    const { container } = render(
      <PanelScroll>
        <Probe />
      </PanelScroll>,
    );
    expect(seen).toBe(container.querySelector(".cf-panel__scroll"));
    render(<Probe />);
    expect(seen).toBeNull();
  });

  it("titles a section with a heading of the chosen level and an optional action", () => {
    render(
      <>
        <PanelSection title="Photos" action={<button type="button">See all</button>}>
          one
        </PanelSection>
        <PanelSection title="Deep" headingLevel={4}>
          two
        </PanelSection>
        <PanelSection action={<button type="button">Clear</button>}>three</PanelSection>
        <PanelSection>four</PanelSection>
      </>,
    );
    expect(screen.getByRole("heading", { name: "Photos", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Deep", level: 4 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "See all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByText("four").querySelector(".cf-panel__section-head")).toBeNull();
  });

  it("renders a text style link that can carry its own accessible name", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <PanelLink onClick={onClick} label="See all shapes">
        See all
      </PanelLink>,
    );
    await user.click(screen.getByRole("button", { name: "See all shapes" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("<ItemGrid>", () => {
  let restoreObserver: () => void;
  beforeEach(() => {
    restoreObserver = withManualObserver();
  });
  afterEach(() => restoreObserver());

  it("lays its children out in the requested number of columns", () => {
    const { container } = render(
      <ItemGrid columns={3} gap={4} aria-label="Tiles" role="list" className="mine">
        <span>a</span>
        <span>b</span>
      </ItemGrid>,
    );
    const grid = screen.getByRole("list", { name: "Tiles" });
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(grid.style.getPropertyValue("--cf-gap")).toBe("4px");
    expect(container.querySelector(".cf-itemgrid.mine")).toBe(grid);
    expect(grid.children).toHaveLength(2);
  });

  it("fits as many columns as there is room for when given a minimum cell width", () => {
    const { container } = render(
      <ItemGrid minCell={92}>
        <span>a</span>
      </ItemGrid>,
    );
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(92px, 1fr))");
  });

  it("defaults to two columns with an 8px gap", () => {
    const { container } = render(
      <ItemGrid>
        <span>a</span>
      </ItemGrid>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(grid.style.getPropertyValue("--cf-gap")).toBe("8px");
  });

  it("draws cells lazily: a shimmer holds the place until the cell nears the viewport", () => {
    const { container } = render(
      <ItemGrid lazy={{ aspect: 0.75, radius: 6 }}>
        <span>first</span>
        {null}
        {false}
        <span>second</span>
      </ItemGrid>,
    );
    const boxes = container.querySelectorAll(".cf-lazybox");
    expect(boxes).toHaveLength(2);
    expect(screen.queryByText("first")).toBeNull();
    expect(container.querySelectorAll(".cf-skeleton")).toHaveLength(2);
    expect((boxes[0] as HTMLElement).style.aspectRatio).toBe(`${1 / 0.75} / 1`);
    expect((boxes[0] as HTMLElement).style.borderRadius).toBe("6px");

    intersect(boxes[1], true);
    expect(screen.getByText("second")).toBeTruthy();
    expect(screen.queryByText("first")).toBeNull();
    intersect(boxes[0], true);
    expect(screen.getByText("first")).toBeTruthy();
    expect(container.querySelectorAll(".cf-skeleton")).toHaveLength(0);
  });

  it("uses square cells with rounded corners for lazy={true}", () => {
    const { container } = render(
      <ItemGrid lazy>
        <span>only</span>
      </ItemGrid>,
    );
    const box = container.querySelector(".cf-lazybox") as HTMLElement;
    expect(box.style.aspectRatio).toBe("1 / 1");
    expect(box.style.borderRadius).toBe("12px");
  });

  it("keeps a lazy box rendered once it has been seen", () => {
    const { container } = render(
      <LazyBox aspect={0.5}>
        <span>photo</span>
      </LazyBox>,
    );
    const box = container.querySelector(".cf-lazybox") as HTMLElement;
    intersect(box, true);
    intersect(box, false);
    expect(screen.getByText("photo")).toBeTruthy();
  });

  it("can leave the place empty instead of showing a shimmer", () => {
    const { container } = render(
      <LazyBox skeleton={false} className="mine" style={{ margin: 3 }}>
        <span>photo</span>
      </LazyBox>,
    );
    expect(container.querySelector(".cf-skeleton")).toBeNull();
    expect(container.querySelector(".cf-lazybox.mine")).toBeTruthy();
    expect(screen.queryByText("photo")).toBeNull();
  });
});

describe("<Masonry>", () => {
  let restoreLayout: () => void;
  beforeEach(() => {
    restoreLayout = stubLayout(400, 600);
  });
  afterEach(() => restoreLayout());

  const items = [
    { id: "tall", h: 2 },
    { id: "short-1", h: 0.5 },
    { id: "short-2", h: 0.5 },
    { id: "short-3", h: 0.5 },
  ];
  const render2 = (props: Partial<Parameters<typeof Masonry<(typeof items)[number]>>[0]> = {}) =>
    renderSettled(<Masonry items={items} aspectOf={(i) => i.h} keyOf={(i) => i.id} renderItem={(i) => <p>{i.id}</p>} {...props} />);

  const columns = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".cf-masonry__col")).map((col) => Array.from(col.querySelectorAll("p")).map((p) => p.textContent));

  it("always adds the next item to the shortest column", async () => {
    const { container } = await render2({ columns: 2 });
    expect(columns(container)).toEqual([["tall"], ["short-1", "short-2", "short-3"]]);
  });

  it("balances by height, not by count", async () => {
    const { container } = await render2({ columns: 3 });
    // short-2 and short-3 meet two equally short columns: the left-most one wins
    expect(columns(container)).toEqual([["tall"], ["short-1", "short-3"], ["short-2"]]);
  });

  it("adds columns while each stays at least the minimum width", async () => {
    // 400px wide: (400 + 8) / (100 + 8) = 3 columns
    const { container } = await render2({ columns: 2, minColumnWidth: 100 });
    expect(container.querySelectorAll(".cf-masonry__col")).toHaveLength(3);
  });

  it("never goes below the requested number of columns", async () => {
    const { container } = await render2({ columns: 2, minColumnWidth: 400 });
    expect(container.querySelectorAll(".cf-masonry__col")).toHaveLength(2);
  });

  it("renders nothing for an empty list but keeps the columns", async () => {
    const { container } = await render2({ items: [], columns: 2, className: "mine" });
    expect(container.querySelectorAll(".cf-masonry__col")).toHaveLength(2);
    expect(container.querySelectorAll(".cf-masonry__item")).toHaveLength(0);
    expect(container.querySelector(".cf-masonry.mine")).toBeTruthy();
  });
});

describe("<VirtualGrid>", () => {
  /** Lays the grid out like a browser would: it starts 100px below the top of a 300px tall scroll area. */
  function layout(scroller: () => HTMLElement | null) {
    const rect = (top: number) => ({ x: 0, y: top, left: 0, top, width: 300, height: 300, right: 300, bottom: top + 300, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const view = scroller();
      if (this.classList.contains("cf-vgrid")) return rect(100 - (view?.scrollTop ?? 0));
      return rect(0);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  }

  const cell = (i: number) => <i key={i} data-cell={i} />;
  const cells = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>("[data-cell]")).map((c) => Number(c.dataset.cell));

  it("reserves the height of every row but mounts only the rows near the viewport", () => {
    const { container } = render(
      <PanelScroll>
        <VirtualGrid count={1000} columns={4} rowHeight={64} gap={8} renderItem={cell} aria-label="Icons" />
      </PanelScroll>,
    );
    const grid = screen.getByRole("group", { name: "Icons" });
    // 250 rows of 64px with 8px gaps, minus the last gap
    expect(grid.style.height).toBe(`${250 * 72 - 8}px`);
    const shown = cells(container);
    expect(shown[0]).toBe(0);
    expect(shown.length).toBeLessThan(120);
    expect(shown.length % 4).toBe(0);
  });

  it("slides the window along when the panel scrolls", () => {
    let scroller: HTMLElement | null = null;
    layout(() => scroller);
    const { container } = render(
      <PanelScroll>
        <VirtualGrid count={1000} columns={4} rowHeight={64} gap={8} renderItem={cell} overscan={1} />
      </PanelScroll>,
    );
    scroller = container.querySelector(".cf-panel__scroll");
    const at = (top: number) => {
      (scroller as HTMLElement).scrollTop = top;
      fireEvent.scroll(scroller as HTMLElement);
    };
    expect(cells(container)[0]).toBe(0);

    // 2000px down: 100px of that is the space above the grid, the visible part starts at row (1900 / 72) = 26
    at(2000);
    const shown = cells(container);
    expect(shown[0]).toBe((26 - 1) * 4);
    expect(shown[shown.length - 1]).toBeGreaterThanOrEqual(26 * 4);
    expect((container.querySelector(".cf-vgrid__window") as HTMLElement).style.top).toBe(`${25 * 72}px`);
    expect(container.querySelector("[data-cell='0']")).toBeNull();

    at(0);
    expect(cells(container)[0]).toBe(0);
  });

  it("goes back to the top when the list shrinks below the window", () => {
    let scroller: HTMLElement | null = null;
    layout(() => scroller);
    const { container, rerender } = render(
      <PanelScroll>
        <VirtualGrid count={1000} columns={4} rowHeight={64} gap={8} renderItem={cell} overscan={1} />
      </PanelScroll>,
    );
    scroller = container.querySelector(".cf-panel__scroll");
    (scroller as HTMLElement).scrollTop = 5000;
    fireEvent.scroll(scroller as HTMLElement);
    expect(cells(container)[0]).toBeGreaterThan(100);

    // the panel is still scrolled far down when the list gets short: the window comes back to the top
    rerender(
      <PanelScroll>
        <VirtualGrid count={12} columns={4} rowHeight={64} gap={8} renderItem={cell} overscan={1} />
      </PanelScroll>,
    );
    expect(cells(container)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect((container.querySelector(".cf-vgrid__window") as HTMLElement).style.top).toBe("0px");
  });

  it("works without a panel around it, following the page scroll", () => {
    const { container } = render(<VirtualGrid count={20} columns={5} rowHeight={40} renderItem={cell} />);
    expect(cells(container)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    fireEvent.scroll(window);
    expect(cells(container)).toHaveLength(20);
  });

  it("stops listening when it unmounts", () => {
    const remove = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const { unmount } = render(
      <PanelScroll>
        <VirtualGrid count={30} columns={3} rowHeight={40} renderItem={cell} />
      </PanelScroll>,
    );
    unmount();
    expect(remove.mock.calls.some((call) => call[0] === "scroll")).toBe(true);
  });
});

describe("<DraggableItem>", () => {
  it("is a named button that inserts on click", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(
      <DraggableItem label="Heart" onInsert={onInsert} className="mine">
        <span>icon</span>
      </DraggableItem>,
    );
    const item = screen.getByRole("button", { name: "Heart" });
    expect(item.getAttribute("title")).toBe("Heart");
    expect(item.classList.contains("mine")).toBe(true);
    expect(item.getAttribute("tabindex")).toBe("0");
    await user.click(item);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("inserts with Enter and Space but ignores other keys", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(
      <DraggableItem label="Star" onInsert={onInsert}>
        x
      </DraggableItem>,
    );
    screen.getByRole("button", { name: "Star" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onInsert).toHaveBeenCalledTimes(2);
    await user.keyboard("a");
    await user.keyboard("{Tab}");
    expect(onInsert).toHaveBeenCalledTimes(2);
  });

  it("can hide its tooltip and show a pressed state", () => {
    render(
      <DraggableItem label="Sunset" onInsert={() => undefined} tooltip={false} pressed>
        x
      </DraggableItem>,
    );
    const item = screen.getByRole("button", { name: "Sunset" });
    expect(item.hasAttribute("title")).toBe(false);
    expect(item.getAttribute("aria-pressed")).toBe("true");
  });

  it("does nothing while disabled", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(
      <DraggableItem label="Open now" onInsert={onInsert} disabled getPayload={() => ({ type: "background", fill: { type: "solid", color: "#fff" } })}>
        x
      </DraggableItem>,
    );
    const item = screen.getByRole("button", { name: "Open now" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("tabindex")).toBe("-1");
    expect(item.getAttribute("draggable")).toBe("false");
    expect(item.classList.contains("is-disabled")).toBe(true);
    await user.click(item);
    fireEvent.keyDown(item, { key: "Enter" });
    expect(onInsert).not.toHaveBeenCalled();
    const dt = fakeDataTransfer();
    const proceeded = fireEvent.dragStart(item, { dataTransfer: dt });
    expect(proceeded).toBe(false);
    expect(dt.data.size).toBe(0);
  });

  it("hands the payload to the drag when it is dragged", () => {
    const payload = { type: "image", src: "builtin:sunset", naturalWidth: 10, naturalHeight: 5 } as const;
    render(
      <DraggableItem label="Sunset" onInsert={() => undefined} getPayload={() => payload}>
        x
      </DraggableItem>,
    );
    const item = screen.getByRole("button", { name: "Sunset" });
    expect(item.getAttribute("draggable")).toBe("true");
    const dt = fakeDataTransfer();
    const proceeded = fireEvent.dragStart(item, { dataTransfer: dt });
    expect(proceeded).toBe(true);
    expect(JSON.parse(dt.data.get(DRAG_MIME) ?? "null")).toEqual(payload);
    expect(dt.data.get("text/plain")).toBe("image");
    expect(dt.effectAllowed).toBe("copy");
  });

  it("cancels a drag that has no payload to offer", () => {
    render(
      <DraggableItem label="Loading icon" onInsert={() => undefined} getPayload={() => null}>
        x
      </DraggableItem>,
    );
    const item = screen.getByRole("button", { name: "Loading icon" });
    const event = createEvent.dragStart(item, { dataTransfer: fakeDataTransfer() });
    fireEvent(item, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("cannot be dragged when it has no way to build a payload", () => {
    render(
      <DraggableItem label="Folder" onInsert={() => undefined}>
        x
      </DraggableItem>,
    );
    const item = screen.getByRole("button", { name: "Folder" });
    expect(item.getAttribute("draggable")).toBe("false");
    const event = createEvent.dragStart(item, { dataTransfer: fakeDataTransfer() });
    fireEvent(item, event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("<CategoryTile>", () => {
  it("is a button named by its description, falling back to its label", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <>
        <CategoryTile label="Shapes" description="Browse shapes" icon={<IconPlus />} from="#111111" to="#222222" plate="#333333" onClick={onClick} className="mine" />
        <CategoryTile label="Photos" icon={<IconPlus />} from="#aaaaaa" to="#bbbbbb" onClick={() => undefined} />
      </>,
    );
    const shapes = screen.getByRole("button", { name: "Browse shapes" });
    await user.click(shapes);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(shapes.classList.contains("mine")).toBe(true);
    expect(shapes.style.getPropertyValue("--_from")).toBe("#111111");
    expect(shapes.style.getPropertyValue("--_plate")).toBe("#333333");
    expect(within(shapes).getByText("Shapes")).toBeTruthy();
    const photos = screen.getByRole("button", { name: "Photos" });
    expect(photos.style.getPropertyValue("--_plate")).toBe("#bbbbbb");
  });
});

describe("<EmptyHint>", () => {
  it("shows a title, a sentence and an action", () => {
    render(<EmptyHint icon={<IconPlus />} title="Nothing here" text="Try something else." action={<button type="button">Reset</button>} />);
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeTruthy();
    expect(screen.getByText("Try something else.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("can be compact and extra classes are kept", () => {
    const { container } = render(<EmptyHint icon={<IconPlus />} title="Empty" compact className="mine" />);
    const hint = container.firstElementChild as HTMLElement;
    expect(hint.classList.contains("cf-hint--compact")).toBe(true);
    expect(hint.classList.contains("mine")).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("<ShapePreview>", () => {
  const pathOf = (container: HTMLElement) => container.querySelector("path") as SVGPathElement;

  it("draws the real outline of a catalogue shape, filled with the current colour", () => {
    const { container } = render(<ShapePreview kind="star" />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("viewBox")).toBe("0 0 40 40");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(pathOf(container).getAttribute("d")?.startsWith("M")).toBe(true);
    expect(pathOf(container).getAttribute("fill")).toBe("currentColor");
    expect(pathOf(container).getAttribute("stroke")).toBeNull();
  });

  it("can draw an outline instead of a fill", () => {
    const { container } = render(<ShapePreview kind="heart" outline box={28} className="mine" />);
    expect(pathOf(container).getAttribute("fill")).toBe("none");
    expect(pathOf(container).getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelector("svg")?.getAttribute("class")).toBe("mine");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("28");
  });

  it("fits wide and tall shapes into the square box", () => {
    const wide = render(<ShapePreview kind="rect" aspect={2} box={40} />);
    // 38 wide, 19 tall: centred, so it moves down by (40 - 19) / 2
    expect(pathOf(wide.container).getAttribute("transform")).toBe("translate(1 10.5)");
    const tall = render(<ShapePreview kind="rect" aspect={0.5} box={40} />);
    expect(pathOf(tall.container).getAttribute("transform")).toBe("translate(10.5 1)");
  });

  it("rounds the corners of a rectangle by a fraction of its shorter side", () => {
    const plain = render(<ShapePreview kind="rect" />);
    const rounded = render(<ShapePreview kind="rect" radiusRatio={0.22} />);
    expect(pathOf(rounded.container).getAttribute("d")).not.toBe(pathOf(plain.container).getAttribute("d"));
  });
});

describe("<PanelBoundary>", () => {
  function Boom({ explode }: { explode: boolean }) {
    if (explode) throw new Error("the catalogue is broken");
    return <p>healthy panel</p>;
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("shows the panel while it works", () => {
    render(
      <PanelBoundary resetKey="text" label="Text">
        <Boom explode={false} />
      </PanelBoundary>,
    );
    expect(screen.getByText("healthy panel")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces a panel that fails with a message and a way to try again", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    let explode = true;
    function Flaky() {
      return <Boom explode={explode} />;
    }
    render(
      <PanelBoundary resetKey="text" label="Text" onRetry={onRetry}>
        <Flaky />
      </PanelBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The Text panel could not load");
    expect(alert.textContent).toContain("Everything else in the editor still works");
    expect(console.error).toHaveBeenCalledWith("The Text panel failed:", expect.any(Error), expect.any(String));

    explode = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("healthy panel")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tries again even without a retry callback", async () => {
    const user = userEvent.setup();
    let explode = true;
    function Flaky() {
      return <Boom explode={explode} />;
    }
    render(
      <PanelBoundary resetKey="brand" label="Brand">
        <Flaky />
      </PanelBoundary>,
    );
    explode = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("healthy panel")).toBeTruthy();
  });

  it("clears the message when another tab is opened", () => {
    let explode = true;
    function Flaky() {
      return <Boom explode={explode} />;
    }
    const { rerender } = render(
      <PanelBoundary resetKey="text" label="Text">
        <Flaky />
      </PanelBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    explode = false;
    // same key: the message stays
    rerender(
      <PanelBoundary resetKey="text" label="Text">
        <Flaky />
      </PanelBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(
      <PanelBoundary resetKey="brand" label="Brand">
        <Flaky />
      </PanelBoundary>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("healthy panel")).toBeTruthy();
  });
});
