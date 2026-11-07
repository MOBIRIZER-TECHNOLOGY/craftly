import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FontRow, fontCategoryLabel } from "./FontRow";

/* Fonts load through `ensureFont`: the real one, watched. */
vi.mock("@/render/fonts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/render/fonts")>();
  return { ...real, ensureFont: vi.fn(real.ensureFont) };
});

/** An IntersectionObserver the test drives by hand, installed before the first row is drawn (rows share one observer). */
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
  disconnect() {}
  takeRecords() {
    return [];
  }
  report(el: Element) {
    this.callback([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

let original: typeof IntersectionObserver;
beforeAll(() => {
  original = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = ManualObserver as unknown as typeof IntersectionObserver;
});
afterAll(() => {
  globalThis.IntersectionObserver = original;
});

const scrollIntoView = (el: Element) => act(() => ManualObserver.all.forEach((o) => o.targets.has(el) && o.report(el)));

describe("fontCategoryLabel", () => {
  it("names the kind of a catalogue font", () => {
    expect(fontCategoryLabel("Lora")).toBe("Serif");
    expect(fontCategoryLabel("Inter")).toBe("Sans serif");
    expect(fontCategoryLabel("Anton")).toBe("Display");
    expect(fontCategoryLabel("Pacifico")).toBe("Script");
    expect(fontCategoryLabel("Caveat")).toBe("Handwriting");
    expect(fontCategoryLabel("JetBrains Mono")).toBe("Monospace");
  });

  it("calls a font that is not in the catalogue custom", () => {
    expect(fontCategoryLabel("Comic Sans")).toBe("Custom font");
  });
});

describe("<FontRow>", () => {
  it("shows the family in its own face with its kind", () => {
    render(<FontRow family="Lora" onPick={() => undefined} />);
    const button = screen.getByRole("button", { name: "Add text in Lora" });
    expect(button.textContent).toBe("LoraSerif");
    const sample = button.querySelector(".cf-fontrow__sample") as HTMLElement;
    expect(sample.style.fontFamily).toContain("Lora");
  });

  it("can show a different sample and carry its own accessible name", () => {
    render(<FontRow family="Anton" sample="Big news" label="Use Anton for headings" onPick={() => undefined} className="mine" />);
    const button = screen.getByRole("button", { name: "Use Anton for headings" });
    expect(button.textContent).toBe("Big newsDisplay");
    expect(button.closest(".cf-fontrow")?.classList.contains("mine")).toBe(true);
  });

  it("picks the font when the row is clicked", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<FontRow family="Cinzel" onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: "Add text in Cinzel" }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("keeps a trailing action apart from the pick", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onRemove = vi.fn();
    render(
      <FontRow
        family="Cinzel"
        onPick={onPick}
        trailing={
          <button type="button" onClick={onRemove}>
            Remove
          </button>
        }
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("asks for the font file only once the row is near the viewport", async () => {
    const { ensureFont } = await import("@/render/fonts");
    vi.mocked(ensureFont).mockClear();
    const { container } = render(<FontRow family="Satisfy" onPick={() => undefined} />);
    expect(ensureFont).not.toHaveBeenCalled();
    scrollIntoView(container.querySelector(".cf-fontrow") as Element);
    expect(ensureFont).toHaveBeenCalledWith("Satisfy", 400);
  });
});
