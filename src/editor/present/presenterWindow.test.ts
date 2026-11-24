import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenterWindow, presenterWindowHtml, type PresenterWindowState } from "./presenterWindow";

const state: PresenterWindowState = { index: 1, count: 3, notes: "Say this", nextName: "Page 3", nextImage: "data:image/jpeg;base64,AAAA" };

describe("presenter window", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has notes, a next-page preview and previous/next controls", () => {
    const html = presenterWindowHtml();
    expect(html).toContain('id="notes"');
    expect(html).toContain('id="next-image"');
    expect(html).toContain('id="previous"');
    expect(html).toContain('new BroadcastChannel("craftly-presenter")');
  });

  it("opens, publishes state, receives commands and closes", () => {
    const popup = { closed: false, focus: vi.fn(), close: vi.fn(), document: { write: vi.fn(), close: vi.fn() } };
    const open = vi.fn(() => popup);
    vi.stubGlobal("window", { open });
    const channel = { onmessage: null as null | ((event: { data: string }) => void), postMessage: vi.fn(), close: vi.fn() };
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          return channel;
        }
      },
    );
    const presenter = new PresenterWindow();
    const command = vi.fn();
    expect(presenter.open(command)).toBe(true);
    expect(popup.document.write).toHaveBeenCalledWith(presenterWindowHtml());
    presenter.post(state);
    expect(channel.postMessage).toHaveBeenCalledWith(state);
    channel.onmessage?.({ data: "next" });
    expect(command).toHaveBeenCalledWith("next");
    presenter.close();
    expect(channel.close).toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
  });

  it("reports a blocked popup and posts nothing", () => {
    vi.stubGlobal("window", { open: vi.fn(() => null) });
    const presenter = new PresenterWindow();
    expect(presenter.open(vi.fn())).toBe(false);
    expect(() => presenter.post(state)).not.toThrow();
  });
});
