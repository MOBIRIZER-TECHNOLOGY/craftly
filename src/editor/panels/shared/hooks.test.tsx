import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, deleteAsset, getAssetUrl, listAssets, renameAsset } from "@/core/assets";
import { createFolder, getBrandKit, listFolders, saveDesign, setBrandKit } from "@/core/library";
import type { BrandKit } from "@/core/types";
import { clearLibrary, flush, sampleDesign, stubLayout } from "@/test/helpers";
import { imageFile, renderSettled } from "@/test/tabsHarness";
import { PanelScroll } from "./PanelLayout";
import { useAssetUrl, useAssets, useBrandKit, useDebounced, useElementWidth, useLibraryData, useVisible } from "./hooks";

/* The real library and asset store (in the fake IndexedDB), wrapped so a test can make one call fail. */
vi.mock("@/core/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/assets")>();
  return { ...real, listAssets: vi.fn(real.listAssets), getAssetUrl: vi.fn(real.getAssetUrl) };
});
vi.mock("@/core/library", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/library")>();
  return { ...real, getBrandKit: vi.fn(real.getBrandKit), listFolders: vi.fn(real.listFolders) };
});

class ManualObserver {
  static all: ManualObserver[] = [];
  readonly targets = new Set<Element>();
  readonly options: IntersectionObserverInit | undefined;
  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.options = options;
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
  takeRecords() {
    return [];
  }
  report(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

const observerOf = (el: Element) => ManualObserver.all.find((o) => o.targets.has(el));
const intersect = (el: Element, on: boolean) => act(() => observerOf(el)?.report(el, on));

describe("useVisible", () => {
  let original: typeof IntersectionObserver;
  beforeEach(() => {
    original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = ManualObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  function Probe({ margin, once }: { margin: string; once?: boolean }) {
    const [ref, visible] = useVisible<HTMLDivElement>({ rootMargin: margin, once });
    return (
      <div ref={ref} data-testid={`probe-${margin}`}>
        {visible ? "seen" : "hidden"}
      </div>
    );
  }

  it("turns true when the element nears the viewport and stays true by default", () => {
    render(<Probe margin="11px 0px" />);
    const el = screen.getByTestId("probe-11px 0px");
    expect(el.textContent).toBe("hidden");
    intersect(el, true);
    expect(el.textContent).toBe("seen");
    intersect(el, false);
    expect(el.textContent).toBe("seen");
  });

  it("follows the element out of view when asked not to stay visible", () => {
    render(<Probe margin="12px 0px" once={false} />);
    const el = screen.getByTestId("probe-12px 0px");
    intersect(el, true);
    expect(el.textContent).toBe("seen");
    intersect(el, false);
    expect(el.textContent).toBe("hidden");
  });

  it("shares one observer between elements with the same margin, and passes the margin on", () => {
    const before = ManualObserver.all.length;
    render(
      <>
        <Probe margin="13px 0px" />
        <Probe margin="13px 0px" />
      </>,
    );
    const [a, b] = screen.getAllByTestId("probe-13px 0px");
    expect(ManualObserver.all.length - before).toBe(1);
    expect(observerOf(a)).toBe(observerOf(b));
    expect(observerOf(a)?.options?.rootMargin).toBe("13px 0px");
    expect(observerOf(a)?.options?.root).toBeNull();
  });

  it("observes inside the scroll area of the panel it sits in", () => {
    const { container } = render(
      <PanelScroll>
        <Probe margin="14px 0px" />
      </PanelScroll>,
    );
    const el = screen.getByTestId("probe-14px 0px");
    expect(observerOf(el)?.options?.root).toBe(container.querySelector(".cf-panel__scroll"));
  });

  it("stops observing when the element goes away", () => {
    const { unmount } = render(<Probe margin="15px 0px" />);
    const el = screen.getByTestId("probe-15px 0px");
    const observer = observerOf(el);
    expect(observer).toBeTruthy();
    unmount();
    expect(observer?.targets.has(el)).toBe(false);
  });

  it("uses the default margin when none is given", () => {
    function Plain() {
      const [ref, visible] = useVisible<HTMLDivElement>();
      return (
        <div ref={ref} data-testid="plain">
          {visible ? "seen" : "hidden"}
        </div>
      );
    }
    render(<Plain />);
    expect(observerOf(screen.getByTestId("plain"))?.options?.rootMargin).toBe("320px 0px");
  });

  it("counts everything as visible where there is no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    try {
      render(<Probe margin="16px 0px" />);
      expect(screen.getByTestId("probe-16px 0px").textContent).toBe("seen");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("useElementWidth", () => {
  let originalObserver: typeof ResizeObserver;
  const callbacks: ResizeObserverCallback[] = [];
  beforeEach(() => {
    originalObserver = globalThis.ResizeObserver;
    callbacks.length = 0;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = originalObserver;
  });

  function Probe() {
    const [ref, width] = useElementWidth<HTMLDivElement>();
    return <div ref={ref}>width {width}</div>;
  }
  const resize = (entries: Array<{ contentRect: { width: number } }>) =>
    act(() => callbacks[callbacks.length - 1](entries as unknown as ResizeObserverEntry[], {} as ResizeObserver));

  it("starts at the element's measured width, rounded", () => {
    const restore = stubLayout(321.4, 100);
    try {
      render(<Probe />);
      expect(screen.getByText("width 321")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("is 0 until the element has a size", () => {
    render(<Probe />);
    expect(screen.getByText("width 0")).toBeTruthy();
  });

  it("follows the element as it is resized", () => {
    render(<Probe />);
    resize([{ contentRect: { width: 250.4 } }]);
    expect(screen.getByText("width 250")).toBeTruthy();
    resize([{ contentRect: { width: 100 } }, { contentRect: { width: 480.6 } }]);
    expect(screen.getByText("width 481")).toBeTruthy();
  });

  it("falls back to 0 for a report without entries", () => {
    const restore = stubLayout(200, 100);
    try {
      render(<Probe />);
      expect(screen.getByText("width 200")).toBeTruthy();
      resize([]);
      expect(screen.getByText("width 0")).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe("useDebounced", () => {
  function Probe({ value, ms }: { value: string; ms?: number }) {
    return <p>{useDebounced(value, ms)}</p>;
  }

  it("holds the old value until the new one has been stable for the delay", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="a" ms={100} />);
    expect(screen.getByText("a")).toBeTruthy();
    rerender(<Probe value="ab" ms={100} />);
    act(() => void vi.advanceTimersByTime(60));
    expect(screen.getByText("a")).toBeTruthy();
    // another change restarts the wait
    rerender(<Probe value="abc" ms={100} />);
    act(() => void vi.advanceTimersByTime(60));
    expect(screen.getByText("a")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(60));
    expect(screen.getByText("abc")).toBeTruthy();
  });

  it("waits 160 ms unless told otherwise", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="x" />);
    rerender(<Probe value="y" />);
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByText("x")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(20));
    expect(screen.getByText("y")).toBeTruthy();
  });
});

describe("live library data", () => {
  beforeEach(async () => {
    await clearLibrary();
    vi.mocked(listAssets).mockClear();
  });

  function Assets() {
    const assets = useAssets();
    return <p data-testid="assets">{assets === null ? "loading" : assets.map((a) => a.name).join(",") || "none"}</p>;
  }

  it("lists the uploads newest first and keeps the list up to date", async () => {
    await renderSettled(<Assets />);
    await waitFor(() => expect(screen.getByTestId("assets").textContent).toBe("none"));

    const first = await addAssetFromFile(imageFile("first.png"));
    await waitFor(() => expect(screen.getByTestId("assets").textContent).toBe("first"));
    await new Promise((r) => setTimeout(r, 5));
    await addAssetFromFile(imageFile("second.png"));
    await waitFor(() => expect(screen.getByTestId("assets").textContent).toBe("second,first"));

    await renameAsset(first.id, "renamed");
    await waitFor(() => expect(screen.getByTestId("assets").textContent).toBe("second,renamed"));
    await deleteAsset(first.id);
    await waitFor(() => expect(screen.getByTestId("assets").textContent).toBe("second"));
  });

  it("is null while loading", async () => {
    render(<Assets />);
    expect(screen.getByTestId("assets").textContent).toBe("loading");
    await flush(5);
  });

  it("shows an empty list when the uploads cannot be read", async () => {
    await addAssetFromFile(imageFile("lost.png"));
    vi.mocked(listAssets).mockRejectedValueOnce(new Error("disk is gone"));
    await renderSettled(<Assets />);
    await waitFor(() => expect(screen.getByTestId("assets").textContent).toBe("none"));
  });

  it("stops listening when the panel closes", async () => {
    const { unmount } = await renderSettled(<Assets />);
    await waitFor(() => expect(vi.mocked(listAssets)).toHaveBeenCalledTimes(1));
    unmount();
    await addAssetFromFile(imageFile("late.png"));
    await flush(5);
    expect(vi.mocked(listAssets)).toHaveBeenCalledTimes(1);
  });

  function AssetUrl({ id }: { id: string | null | undefined }) {
    return <p data-testid="url">{String(useAssetUrl(id))}</p>;
  }

  it("resolves the object URL of an upload, and null without an id or for a missing upload", async () => {
    const asset = await addAssetFromFile(imageFile("logo.png"));
    const { rerender } = await renderSettled(<AssetUrl id={null} />);
    expect(screen.getByTestId("url").textContent).toBe("null");
    rerender(<AssetUrl id={asset.id} />);
    await waitFor(() => expect(screen.getByTestId("url").textContent).toMatch(/^blob:test\//));
    rerender(<AssetUrl id="a_missing" />);
    await waitFor(() => expect(screen.getByTestId("url").textContent).toBe("null"));
    rerender(<AssetUrl id={undefined} />);
    expect(screen.getByTestId("url").textContent).toBe("null");
  });

  it("gives null when the upload cannot be read", async () => {
    const asset = await addAssetFromFile(imageFile("broken-store.png"));
    vi.mocked(getAssetUrl).mockRejectedValueOnce(new Error("no blob"));
    await renderSettled(<AssetUrl id={asset.id} />);
    await flush(5);
    expect(screen.getByTestId("url").textContent).toBe("null");
  });

  function Library() {
    const { designs, folders } = useLibraryData();
    return (
      <p data-testid="library">
        {designs === null || folders === null ? "loading" : `${designs.map((d) => d.title).join(",") || "no designs"} | ${folders.map((f) => f.name).join(",") || "no folders"}`}
      </p>
    );
  }

  it("lists designs and folders and refreshes when either changes", async () => {
    await renderSettled(<Library />);
    await waitFor(() => expect(screen.getByTestId("library").textContent).toBe("no designs | no folders"));
    await saveDesign(sampleDesign({ id: "hooks-d1", title: "Poster" }));
    await waitFor(() => expect(screen.getByTestId("library").textContent).toBe("Poster | no folders"));
    await createFolder("Client work");
    await waitFor(() => expect(screen.getByTestId("library").textContent).toBe("Poster | Client work"));
  });

  it("shows empty lists when the library cannot be read", async () => {
    vi.mocked(listFolders).mockRejectedValueOnce(new Error("blocked"));
    await renderSettled(<Library />);
    await waitFor(() => expect(screen.getByTestId("library").textContent).toBe("no designs | no folders"));
  });

  function Brand({ next }: { next?: BrandKit }) {
    const [kit, save] = useBrandKit();
    return (
      <div>
        <p data-testid="kit">{kit === null ? "loading" : `${kit.colors.join(",") || "no colours"} | ${kit.fonts.join(",") || "no fonts"}`}</p>
        <button type="button" onClick={() => next && void save(next)}>
          save
        </button>
      </div>
    );
  }

  it("starts from the default brand kit and saves a new one straight away", async () => {
    await renderSettled(<Brand next={{ colors: ["#123456"], fonts: ["Lora"], logos: [] }} />);
    await waitFor(() => expect(screen.getByTestId("kit").textContent).toContain("#7c3aed"));
    act(() => screen.getByRole("button", { name: "save" }).click());
    // optimistic: shown at once, written afterwards
    expect(screen.getByTestId("kit").textContent).toBe("#123456 | Lora");
    await waitFor(async () => expect((await getBrandKit()).colors).toEqual(["#123456"]));
  });

  it("picks up a brand kit that changed elsewhere", async () => {
    await renderSettled(<Brand />);
    await waitFor(() => expect(screen.getByTestId("kit").textContent).toContain("#7c3aed"));
    await setBrandKit({ colors: ["#abcdef"], fonts: [], logos: [] });
    await waitFor(() => expect(screen.getByTestId("kit").textContent).toBe("#abcdef | no fonts"));
  });

  it("falls back to an empty kit when it cannot be read", async () => {
    vi.mocked(getBrandKit).mockRejectedValueOnce(new Error("blocked"));
    await renderSettled(<Brand />);
    await waitFor(() => expect(screen.getByTestId("kit").textContent).toBe("no colours | no fonts"));
  });
});
