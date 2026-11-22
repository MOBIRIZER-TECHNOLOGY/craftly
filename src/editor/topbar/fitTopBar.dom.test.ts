/**
 * How the top bar folds its words into icons (fitTopBar.ts). jsdom draws nothing, so each test gives the bar and its labels the
 * widths a browser would measure, and makes them depend on the fold the way topbar.css does: each fold takes words off the bar
 * and gives the room back. The words and their widths are the ones measured in Chrome on a 600 px screen in Hindi, where File,
 * Resize and Share were cut to "फ़ा…" before the bar learnt to fold. The real layout is checked in e2e/mobile.cjs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLDS, fitTopBar, isCut, watchTopBar } from "./fitTopBar";

/** A width a browser would report, read again at every look, like a layout forced by the measurement. */
function measured(el: HTMLElement, sizes: () => { scroll: number; client: number }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => sizes().scroll });
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => sizes().client });
}

const NATURAL: Record<string, number> = { file: 37, resize: 72, share: 51 };
/** the fold from which a word is its icon (its label measures 0, as one that is not shown does); File never folds */
const ICON_FROM: Record<string, number> = { file: Infinity, resize: 2, share: 1 };

/**
 * A top bar whose words lack `short()` px with no fold (read at every look, so a test can change the screen); each fold
 * frees `perFold` px, and what is still lacking is shared by the words still shown, as the flex groups share it.
 */
function bar(short: number | (() => number), perFold = 60) {
  const lacking = typeof short === "number" ? () => short : short;
  const header = document.createElement("header");
  header.className = "cf-topbar";
  header.innerHTML = `
    <div class="cf-topbar__group">
      <button class="cf-btn"><span class="cf-btn__label" data-word="file">फ़ाइल</span></button>
      <button class="cf-btn"><span class="cf-btn__label" data-word="resize">आकार बदलें</span></button>
    </div>
    <div class="cf-topbar__group cf-topbar__group--end">
      <button class="cf-btn"><span class="cf-btn__label" data-word="share">शेयर करें</span></button>
    </div>`;
  document.body.append(header);
  const fold = () => Number(header.dataset.fold ?? 0);
  measured(header, () => ({ scroll: 600, client: 600 }));
  for (const label of header.querySelectorAll<HTMLElement>(".cf-btn__label")) {
    const word = label.dataset.word as string;
    measured(label, () => {
      if (fold() >= ICON_FROM[word]) return { scroll: 0, client: 0 };
      const shown = Object.keys(NATURAL).filter((w) => fold() < ICON_FROM[w]).length;
      // a word that is shown keeps at least a pixel (its ellipsis), however short the bar is
      return { scroll: NATURAL[word], client: Math.max(1, NATURAL[word] - Math.max(0, lacking() - fold() * perFold) / shown) };
    });
  }
  return header;
}

/** A ResizeObserver that reports only when the test says so, and remembers what it watches. */
function stubObserver() {
  const watcher = { report: () => {}, observed: [] as Element[], disconnect: vi.fn() };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        watcher.report = () => cb([], this as unknown as ResizeObserver);
      }
      observe(el: Element) {
        watcher.observed.push(el);
      }
      unobserve() {}
      disconnect = watcher.disconnect;
    },
  );
  return watcher;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("isCut", () => {
  it("is false while every word is whole and the bar is no wider than its box", () => {
    expect(isCut(bar(0))).toBe(false);
  });

  it("is true when a word is cut short by more than a pixel of rounding", () => {
    expect(isCut(bar(3))).toBe(false);
    expect(isCut(bar(9))).toBe(true);
  });

  it("is true when the bar itself is wider than its box, even with every word whole", () => {
    const header = bar(0);
    measured(header, () => ({ scroll: 625, client: 600 }));
    expect(isCut(header)).toBe(true);
  });

  it("does not count a label that is not shown (it measures 0)", () => {
    const header = bar(0);
    measured(header.querySelector<HTMLElement>("[data-word=share]") as HTMLElement, () => ({ scroll: 0, client: 0 }));
    expect(isCut(header)).toBe(false);
  });
});

describe("fitTopBar", () => {
  it("leaves the bar unfolded when its words fit, and takes back a fold left from a narrower screen", () => {
    const header = bar(0);
    header.dataset.fold = "2";
    expect(fitTopBar(header)).toBe(0);
    expect(header.dataset.fold).toBeUndefined();
  });

  it("folds Present and Share first, when that is enough (Hindi at 600 px: 55 px short)", () => {
    const header = bar(55);
    expect(fitTopBar(header)).toBe(1);
    expect(header.dataset.fold).toBe("1");
  });

  it("folds Resize too when Share alone does not free enough room", () => {
    const header = bar(90);
    expect(fitTopBar(header)).toBe(2);
    expect(header.dataset.fold).toBe("2");
  });

  it("folds the title away and Redo last, when even File alone does not fit beside the icons (520 px)", () => {
    const header = bar(150);
    expect(fitTopBar(header)).toBe(3);
    expect(header.dataset.fold).toBe("3");
  });

  it("stops at the last fold even if a word is still cut: it then ends in an ellipsis rather than leaving the screen", () => {
    const header = bar(500);
    expect(fitTopBar(header)).toBe(FOLDS);
    expect(isCut(header)).toBe(true);
  });
});

describe("watchTopBar", () => {
  it("watches the bar, both groups and every label, refits on every report, and stops on the stop", () => {
    const watcher = stubObserver();
    let short = 0;
    const header = bar(() => short);
    const stop = watchTopBar(header);
    expect(header.dataset.fold).toBeUndefined();
    expect(watcher.observed).toContain(header);
    expect(watcher.observed.filter((el) => el.classList.contains("cf-topbar__group"))).toHaveLength(2);
    expect(watcher.observed.filter((el) => el.classList.contains("cf-btn__label"))).toHaveLength(3);

    // the screen narrows: the words lack 55 px
    short = 55;
    watcher.report();
    expect(header.dataset.fold).toBe("1");
    // and widens again
    short = 0;
    watcher.report();
    expect(header.dataset.fold).toBeUndefined();

    stop();
    expect(watcher.disconnect).toHaveBeenCalled();
  });

  it("does nothing for a bar that has left the page (a report that comes after the editor closed)", () => {
    const watcher = stubObserver();
    const header = bar(55);
    const stop = watchTopBar(header);
    expect(header.dataset.fold).toBe("1");
    header.remove();
    delete header.dataset.fold;
    watcher.report();
    expect(header.dataset.fold).toBeUndefined();
    stop();
  });

  it("refits when a font arrives (a wider one cuts the words), and stops listening on the stop", () => {
    stubObserver();
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    try {
      let short = 0;
      const header = bar(() => short);
      const stop = watchTopBar(header);
      expect(header.dataset.fold).toBeUndefined();
      short = 55;
      fonts.dispatchEvent(new Event("loadingdone"));
      expect(header.dataset.fold).toBe("1");
      stop();
      short = 0;
      fonts.dispatchEvent(new Event("loadingdone"));
      // no longer listening: the fold stays as it was
      expect(header.dataset.fold).toBe("1");
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });
});
