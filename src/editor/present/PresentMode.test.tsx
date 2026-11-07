import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design, Fill } from "@/core/types";
import { contextOf } from "@/test/canvasMock";
import { chromeDesign } from "@/test/chromeUtils";
import { flush, resetEditor, stubLayout } from "@/test/helpers";
import { setMedia } from "@/test/media";
import { PresentMode } from "./PresentMode";

/*
 * The full-screen presenter. The stage is 1000 x 700 (stubLayout), the design 1280 x 720, so a point of the design
 * (x, y) is under the pointer at clientX = x * 1000 / 1280 and clientY = y * 700 / 720.
 */

let restoreLayout: () => void;
/** Each test starts more than 400 ms (the presenter's guard against asking for full screen twice) after the one before. */
let clock = Date.now() + 1_000_000;

beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout(1000, 700);
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  clock += 10_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  restoreLayout();
  resetEditor();
});

const clientOf = (x: number, y: number) => ({ clientX: (x * 1000) / 1280, clientY: (y * 700) / 720 });

/** Open `design` the way the editor does, switch the presenter on and mount it. */
async function present(design: Design = chromeDesign(), page = 0) {
  act(() => {
    const actions = useEditor.getState().actions;
    actions.openDesign(design);
    if (page) actions.setActivePage(design.pages[page].id);
    actions.setPresenting(true);
  });
  const view = render(<PresentMode />);
  await flush();
  return { ...view, design };
}

const stage = () => screen.getByRole("img", { name: /^Page \d+ of \d+$/ });
const counter = () => document.querySelector(".cf-present__count")?.textContent?.replace(/\s+/g, "");
/** Real fake timers (not only the date) for a test that has to wait for a timeout of the presenter. */
const useClock = () => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
};
/** Waits until the player has put a picture on the stage canvas. */
const painted = () => waitFor(() => expect(contextOf(stage() as HTMLCanvasElement)!.callsTo("drawImage").length).toBeGreaterThan(0));

describe("<PresentMode>: opening the show", () => {
  it("shows the page being edited, fitted to the screen and painted", async () => {
    await present(chromeDesign("Show one"), 1);
    const dialog = screen.getByRole("dialog", { name: "Presentation" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(counter()).toBe("2/3");
    expect(stage().getAttribute("aria-label")).toBe("Page 2 of 3");
    expect(screen.getByText("Page 2 of 3")).toBeTruthy(); // the polite live region
    await painted();
    const canvas = stage() as HTMLCanvasElement;
    // 1280 x 720 shown in 1000 x 700: limited by the width
    expect(canvas.style.width).toBe("1000px");
    expect(canvas.style.height).toBe("562px");
  });

  it("goes away quietly when the design is closed underneath it", async () => {
    const { container } = await present();
    await painted();
    act(() => useEditor.getState().actions.closeDesign());
    await flush();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no design is open", () => {
    const { container } = render(<PresentMode />);
    expect(container.firstChild).toBeNull();
  });

  it("disables the arrows at either end", async () => {
    await present();
    const prev = screen.getByRole("button", { name: "Previous page" });
    const next = screen.getByRole("button", { name: "Next page" });
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(next.getAttribute("aria-disabled")).toBeNull();
    const user = userEvent.setup({ delay: null });
    await user.click(next);
    await user.click(next);
    expect(counter()).toBe("3/3");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(prev.getAttribute("aria-disabled")).toBeNull();
    await user.click(next);
    expect(counter()).toBe("3/3");
  });

  it("moves with the arrow buttons", async () => {
    await present();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(counter()).toBe("2/3");
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(counter()).toBe("1/3");
  });

  it("follows a design that loses pages while it is shown", async () => {
    await present(chromeDesign("Shrinking"), 2);
    expect(counter()).toBe("3/3");
    act(() => useEditor.getState().actions.deletePage(useEditor.getState().design!.pages[2].id));
    await flush();
    expect(counter()).toBe("2/2");
  });
});

describe("<PresentMode>: keyboard", () => {
  it.each([["ArrowRight"], ["ArrowDown"], ["PageDown"], [" "], ["Enter"]])("goes to the next page with %j", async (key) => {
    await present();
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
    expect(counter()).toBe("2/3");
  });

  it.each([["ArrowLeft"], ["ArrowUp"], ["PageUp"], ["Backspace"]])("goes back a page with %s", async (key) => {
    await present(chromeDesign("Back"), 2);
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
    expect(counter()).toBe("2/3");
  });

  it("jumps to the last and the first page with End and Home", async () => {
    await present(chromeDesign("Ends"), 1);
    const user = userEvent.setup({ delay: null });
    await user.keyboard("{End}");
    expect(counter()).toBe("3/3");
    await user.keyboard("{Home}");
    expect(counter()).toBe("1/3");
  });

  it("stays on the first and last page", async () => {
    await present();
    const user = userEvent.setup({ delay: null });
    await user.keyboard("{ArrowLeft}");
    expect(counter()).toBe("1/3");
    await user.keyboard("{End}{ArrowRight}");
    expect(counter()).toBe("3/3");
  });

  it("uses a key it handles and says so, and leaves the other keys alone", async () => {
    await present();
    const target = document.activeElement ?? document.body;
    expect(fireEvent.keyDown(target, { key: "ArrowRight" })).toBe(false); // default prevented
    expect(fireEvent.keyDown(target, { key: "x" })).toBe(true);
    expect(counter()).toBe("2/3");
  });

  it("ignores keys pressed together with Ctrl, Meta or Alt", async () => {
    await present();
    const target = document.activeElement ?? document.body;
    fireEvent.keyDown(target, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(target, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(target, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(target, { key: "Escape", ctrlKey: true });
    expect(counter()).toBe("1/3");
    expect(useEditor.getState().presenting).toBe(true);
  });

  it("leaves Space and Enter to a button that has the focus", async () => {
    await present();
    const user = userEvent.setup({ delay: null });
    const exit = screen.getByRole("button", { name: "Exit presentation" });
    exit.focus();
    // not claimed by the presenter: the browser turns it into a click on the button
    expect(fireEvent.keyDown(exit, { key: " " })).toBe(true);
    expect(counter()).toBe("1/3");
    await user.keyboard("{Enter}");
    expect(useEditor.getState().presenting).toBe(false);
  });

  it("ends the show with Esc and the editor continues on the page the show ended on", async () => {
    const { design } = await present(chromeDesign("Esc"), 1);
    const user = userEvent.setup({ delay: null });
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Escape}");
    const s = useEditor.getState();
    expect(s.presenting).toBe(false);
    expect(s.activePageId).toBe(design.pages[2].id);
  });

  it("ends the show with the close button", async () => {
    const { design } = await present(chromeDesign("Close"), 1);
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Exit presentation" }));
    const s = useEditor.getState();
    expect(s.presenting).toBe(false);
    expect(s.activePageId).toBe(design.pages[1].id);
  });
});

describe("<PresentMode>: speaker notes", () => {
  it("shows the notes of the page with N and hides them again", async () => {
    await present();
    const user = userEvent.setup({ delay: null });
    expect(screen.queryByLabelText("Speaker notes")).toBeNull();
    await user.keyboard("n");
    const notes = screen.getByLabelText("Speaker notes");
    expect(within(notes).getByRole("heading", { name: "Notes - page 1" })).toBeTruthy();
    expect(within(notes).getByText("Welcome everyone")).toBeTruthy();
    await user.keyboard("N");
    expect(screen.queryByLabelText("Speaker notes")).toBeNull();
  });

  it("says when a page has no notes, and follows the page", async () => {
    await present();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Show notes" }));
    expect(screen.getByRole("button", { name: "Hide notes" }).getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("{ArrowRight}");
    const notes = screen.getByLabelText("Speaker notes");
    expect(within(notes).getByRole("heading", { name: "Notes - page 2" })).toBeTruthy();
    expect(within(notes).getByText("No notes for this page.")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(within(screen.getByLabelText("Speaker notes")).getByText("Thank you")).toBeTruthy();
  });

  it("treats notes of only spaces as empty", async () => {
    const design = chromeDesign("Blank notes");
    design.pages[0].notes = "   ";
    await present(design);
    await userEvent.setup({ delay: null }).keyboard("n");
    expect(within(screen.getByLabelText("Speaker notes")).getByText("No notes for this page.")).toBeTruthy();
  });
});

describe("<PresentMode>: auto-play", () => {
  it("starts and stops with P and shows a progress line while it runs", async () => {
    await present();
    const user = userEvent.setup({ delay: null });
    const button = screen.getByRole("button", { name: "Auto-play" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".cf-present__progress")).toBeNull();
    await painted();
    await user.keyboard("p");
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    const bar = document.querySelector<HTMLElement>(".cf-present__progress-bar")!;
    expect(bar).toBeTruthy();
    await waitFor(() => expect(bar.style.transform).toMatch(/^scaleX\(/));
    await user.keyboard("P");
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    expect(document.querySelector(".cf-present__progress")).toBeNull();
  });

  it("starts with the Auto-play button and ends when the presenter moves on", async () => {
    await present();
    const user = userEvent.setup({ delay: null });
    await painted();
    const button = screen.getByRole("button", { name: "Auto-play" });
    await user.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    expect(counter()).toBe("2/3");
  });
});

describe("<PresentMode>: full screen", () => {
  it("asks for full screen when it opens and follows the browser's changes", async () => {
    const request = vi.spyOn(HTMLElement.prototype, "requestFullscreen");
    await present();
    const dialog = screen.getByRole("dialog", { name: "Presentation" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(dialog);
    // the browser reports that it went full screen
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeTruthy();
  });

  it("toggles full screen with F and with the button", async () => {
    const exit = vi.spyOn(document, "exitFullscreen");
    await present();
    const user = userEvent.setup({ delay: null });
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    await user.keyboard("f");
    expect(exit).toHaveBeenCalledTimes(1);
    // the browser answers with the change event: the show ends with full screen
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(useEditor.getState().presenting).toBe(false);
  });

  it("goes back into full screen from the button when the browser had left it", async () => {
    const request = vi.spyOn(HTMLElement.prototype, "requestFullscreen");
    await present();
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not end the show when full screen was never entered", async () => {
    await present();
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(useEditor.getState().presenting).toBe(true);
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeTruthy();
  });

  it("carries on in the window when the browser refuses full screen", async () => {
    vi.spyOn(HTMLElement.prototype, "requestFullscreen").mockRejectedValue(new Error("denied"));
    await present();
    expect(screen.getByRole("dialog", { name: "Presentation" })).toBeTruthy();
    expect(useEditor.getState().presenting).toBe(true);
    await userEvent.setup({ delay: null }).keyboard("f");
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeTruthy();
  });

  it("carries on when the browser refuses to leave full screen", async () => {
    vi.spyOn(document, "exitFullscreen").mockRejectedValue(new Error("not in full screen"));
    const { unmount } = await present();
    await userEvent.setup({ delay: null }).keyboard("f");
    expect(useEditor.getState().presenting).toBe(true);
    expect(() => unmount()).not.toThrow();
  });

  it("carries on when asking for full screen throws", async () => {
    vi.spyOn(HTMLElement.prototype, "requestFullscreen").mockImplementation(() => {
      throw new Error("not allowed");
    });
    await present();
    expect(screen.getByRole("dialog", { name: "Presentation" })).toBeTruthy();
    expect(counter()).toBe("1/3");
  });

  it("works in a browser without the full screen API", async () => {
    const proto = HTMLElement.prototype as unknown as { requestFullscreen?: unknown };
    const saved = proto.requestFullscreen;
    proto.requestFullscreen = undefined;
    try {
      await present();
      await userEvent.setup({ delay: null }).keyboard("f");
      expect(screen.getByRole("dialog", { name: "Presentation" })).toBeTruthy();
    } finally {
      proto.requestFullscreen = saved;
    }
  });

  it("asks only once when the presenter is mounted twice in a row (development double mount)", async () => {
    const request = vi.spyOn(HTMLElement.prototype, "requestFullscreen");
    const { unmount } = await present();
    unmount();
    render(<PresentMode />);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("leaves full screen and gives the focus back to where the show was started from", async () => {
    const exit = vi.spyOn(document, "exitFullscreen");
    const opener = document.createElement("button");
    opener.textContent = "Present";
    document.body.append(opener);
    opener.focus();
    const { unmount } = await present();
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(exit).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });
});

describe("<PresentMode>: clicking and swiping", () => {
  const withLinks = () => {
    const design = chromeDesign("Links");
    design.pages[0].elements = [
      createShape("rect", { x: 100, y: 100, width: 200, height: 100, link: "https://example.com/a" }),
      createShape("rect", { x: 100, y: 250, width: 200, height: 100, link: "example.com/path" }),
      createShape("rect", { x: 100, y: 400, width: 200, height: 100, link: "mailto:me@example.com" }),
      createShape("rect", { x: 400, y: 100, width: 200, height: 100, link: "javascript:alert(1)" }),
      createShape("rect", { x: 400, y: 250, width: 200, height: 100, link: "   " }),
      createShape("rect", { x: 400, y: 400, width: 200, height: 100, link: "https://example.com/hidden", hidden: true }),
      createGroup([createShape("rect", { x: 10, y: 10, width: 80, height: 80 }), createShape("rect", { x: 100, y: 10, width: 80, height: 80, link: "https://example.com/own" })], {
        x: 700,
        y: 100,
        width: 200,
        height: 100,
        link: "https://example.com/group",
      }),
    ];
    return design;
  };

  it("follows a web link under the pointer in a new window and does not turn the page", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await present(withLinks());
    fireEvent.click(stage(), clientOf(150, 150));
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
    expect(counter()).toBe("1/3");
  });

  it("adds https:// to a link without a scheme and follows mail links", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await present(withLinks());
    fireEvent.click(stage(), clientOf(150, 300));
    fireEvent.click(stage(), clientOf(150, 450));
    expect(open).toHaveBeenNthCalledWith(1, "https://example.com/path", "_blank", "noopener,noreferrer");
    expect(open).toHaveBeenNthCalledWith(2, "mailto:me@example.com", "_blank", "noopener,noreferrer");
  });

  it("does not follow links to other kinds of address, or empty links: the click turns the page", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await present(withLinks());
    const user = userEvent.setup({ delay: null });
    fireEvent.click(stage(), clientOf(450, 150)); // javascript:
    expect(counter()).toBe("2/3");
    await user.keyboard("{ArrowLeft}");
    fireEvent.click(stage(), clientOf(450, 300)); // spaces only
    expect(counter()).toBe("2/3");
    expect(open).not.toHaveBeenCalled();
  });

  it("ignores a hidden element and a click outside the page", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await present(withLinks());
    const user = userEvent.setup({ delay: null });
    fireEvent.click(stage(), clientOf(450, 450)); // over the hidden element
    expect(counter()).toBe("2/3");
    await user.keyboard("{ArrowLeft}");
    fireEvent.click(stage(), { clientX: 2000, clientY: 100 }); // outside the stage canvas
    expect(counter()).toBe("2/3");
    expect(open).not.toHaveBeenCalled();
  });

  it("lets a group's link cover its children, unless a child has a link of its own", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await present(withLinks());
    fireEvent.click(stage(), clientOf(700 + 50, 100 + 50)); // the first child has no link: the group's applies
    fireEvent.click(stage(), clientOf(700 + 140, 100 + 50)); // the second child links elsewhere
    fireEvent.click(stage(), clientOf(700 + 190, 100 + 98)); // inside the group, on no child
    expect(open).toHaveBeenNthCalledWith(1, "https://example.com/group", "_blank", "noopener,noreferrer");
    expect(open).toHaveBeenNthCalledWith(2, "https://example.com/own", "_blank", "noopener,noreferrer");
    expect(open).toHaveBeenNthCalledWith(3, "https://example.com/group", "_blank", "noopener,noreferrer");
  });

  it("turns the page when the stage canvas has no size to measure a click against", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await present(withLinks());
    const empty = { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON: () => ({}) };
    Object.defineProperty(stage(), "getBoundingClientRect", { value: () => empty });
    fireEvent.click(stage(), clientOf(150, 150));
    expect(open).not.toHaveBeenCalled();
    expect(counter()).toBe("2/3");
  });

  it("marks the pointer as over a link only for addresses it would follow", async () => {
    await present(withLinks());
    const dialog = screen.getByRole("dialog", { name: "Presentation" });
    fireEvent.pointerMove(dialog, clientOf(150, 150));
    expect(dialog.classList.contains("is-link")).toBe(true);
    fireEvent.pointerMove(dialog, clientOf(450, 150)); // javascript: is never followed
    expect(dialog.classList.contains("is-link")).toBe(false);
    fireEvent.pointerMove(dialog, clientOf(150, 150));
    fireEvent.pointerMove(dialog, clientOf(1200, 700)); // empty part of the page
    expect(dialog.classList.contains("is-link")).toBe(false);
  });

  it("turns the page when the stage is clicked", async () => {
    await present();
    fireEvent.click(stage(), clientOf(640, 360));
    expect(counter()).toBe("2/3");
  });

  it("does not turn the page when a control is clicked", async () => {
    await present();
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Show notes" }));
    expect(counter()).toBe("1/3");
  });

  it("swipes left to the next page and right to the previous one", async () => {
    await present(chromeDesign("Swipe"), 1);
    const dialog = screen.getByRole("dialog", { name: "Presentation" });
    fireEvent.pointerDown(dialog, { clientX: 600, clientY: 300 });
    fireEvent.pointerUp(dialog, { clientX: 300, clientY: 310 });
    expect(counter()).toBe("3/3");
    fireEvent.pointerDown(dialog, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(dialog, { clientX: 600, clientY: 290 });
    expect(counter()).toBe("2/3");
  });

  it("ignores short and mostly vertical swipes", async () => {
    await present(chromeDesign("No swipe"), 1);
    const dialog = screen.getByRole("dialog", { name: "Presentation" });
    fireEvent.pointerDown(dialog, { clientX: 500, clientY: 300 });
    fireEvent.pointerUp(dialog, { clientX: 460, clientY: 300 }); // 40 px: too short
    fireEvent.pointerDown(dialog, { clientX: 500, clientY: 100 });
    fireEvent.pointerUp(dialog, { clientX: 400, clientY: 400 }); // more up and down than across
    fireEvent.pointerUp(dialog, { clientX: 100, clientY: 300 }); // no press started in the presenter
    expect(counter()).toBe("2/3");
  });

  it("does not turn the page twice when the click that ends a swipe arrives", async () => {
    await present(chromeDesign("Swipe click"), 0);
    const dialog = screen.getByRole("dialog", { name: "Presentation" });
    fireEvent.pointerDown(dialog, { clientX: 600, clientY: 300 });
    fireEvent.pointerUp(dialog, { clientX: 300, clientY: 300 });
    expect(counter()).toBe("2/3");
    fireEvent.click(stage(), clientOf(640, 360)); // the click that follows the swipe is swallowed
    expect(counter()).toBe("2/3");
    fireEvent.click(stage(), clientOf(640, 360)); // the next one is a real click
    expect(counter()).toBe("3/3");
  });

  it("does not let a swipe that no click followed swallow a click made later", async () => {
    useClock();
    await present(chromeDesign("Swipe alone"), 1);
    const dialog = screen.getByRole("dialog", { name: "Presentation" });
    fireEvent.pointerDown(dialog, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(dialog, { clientX: 600, clientY: 300 });
    expect(counter()).toBe("1/3");
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.click(stage(), clientOf(640, 360));
    expect(counter()).toBe("2/3");
  });
});

describe("<PresentMode>: the controls fade when nothing happens", () => {
  it("hides the controls after two seconds and brings them back on input", async () => {
    useClock();
    await present();
    const controls = document.querySelector(".cf-present__controls")!;
    const root = screen.getByRole("dialog", { name: "Presentation" });
    expect(controls.classList.contains("is-idle")).toBe(false);
    act(() => void vi.advanceTimersByTime(2100));
    expect(controls.classList.contains("is-idle")).toBe(true);
    expect(root.classList.contains("is-idle")).toBe(true);
    fireEvent.pointerMove(root, { clientX: 10, clientY: 10 });
    expect(controls.classList.contains("is-idle")).toBe(false);
    act(() => void vi.advanceTimersByTime(2100));
    expect(controls.classList.contains("is-idle")).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "x" });
    expect(controls.classList.contains("is-idle")).toBe(false);
    act(() => void vi.advanceTimersByTime(2100));
    fireEvent.pointerDown(root, { clientX: 10, clientY: 10 });
    expect(controls.classList.contains("is-idle")).toBe(false);
  });
});

describe("<PresentMode>: motion and damaged pages", () => {
  const slideDesign = () => {
    const design = chromeDesign("Slides");
    design.pages[1].transition = { kind: "slide", duration: 0.3, direction: "left" };
    return design;
  };

  it("slides between pages when the next page has a transition", async () => {
    await present(slideDesign());
    await painted();
    const ctx = () => contextOf(stage() as HTMLCanvasElement)!;
    await userEvent.setup({ delay: null }).keyboard("{ArrowRight}");
    await waitFor(() => expect(ctx().callsTo("translate").length).toBeGreaterThan(2));
    await waitFor(() => expect(counter()).toBe("2/3"));
  });

  it("cuts with reduced motion", async () => {
    setMedia("(prefers-reduced-motion: reduce)", true);
    await present(slideDesign());
    await painted();
    const canvas = stage() as HTMLCanvasElement;
    const before = contextOf(canvas)!.callsTo("drawImage").length;
    await userEvent.setup({ delay: null }).keyboard("{ArrowRight}");
    await waitFor(() => expect(contextOf(canvas)!.callsTo("drawImage").length).toBe(before + 1));
    expect(contextOf(canvas)!.callsTo("translate")).toHaveLength(0);
  });

  it("follows a change of the reduced motion preference while it runs", async () => {
    await present(slideDesign());
    await painted();
    act(() => setMedia("(prefers-reduced-motion: reduce)", true));
    const canvas = stage() as HTMLCanvasElement;
    const before = contextOf(canvas)!.callsTo("drawImage").length;
    await userEvent.setup({ delay: null }).keyboard("{ArrowRight}");
    await waitFor(() => expect(contextOf(canvas)!.callsTo("drawImage").length).toBeGreaterThan(before));
    expect(contextOf(canvas)!.callsTo("translate")).toHaveLength(0);
  });

  it("says when a page cannot be drawn and carries on with the next one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const design = chromeDesign("Damaged");
    design.pages[0].background = { type: "linear", angle: 0, stops: undefined } as unknown as Fill;
    await present(design);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This page couldn't be drawn");
    expect((screen.getByLabelText("Page 1 of 3", { selector: "canvas" }) as HTMLCanvasElement).hidden).toBe(true);
    await userEvent.setup({ delay: null }).keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect((stage() as HTMLCanvasElement).hidden).toBe(false);
  });
});
