import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createRef, useRef, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rect, stubOffsets, stubRects } from "@/test/dashuiLayout";
import { setMedia } from "@/test/media";
import {
  focusElement,
  getTabbables,
  isKeyboardModality,
  mergeRefs,
  trapTab,
  useEscape,
  useLatest,
  useMedia,
  useMergedRefs,
  useOutsideClick,
  usePresence,
  useResizeObserver,
  useScrollLock,
} from "./hooks";
import { registerLayer } from "./overlay";

/* ------------------------------------------------------------------ */
/* refs                                                               */
/* ------------------------------------------------------------------ */

describe("mergeRefs", () => {
  it("hands the node to object refs and callback refs alike", () => {
    const object = createRef<HTMLDivElement>();
    const callback = vi.fn();
    const node = document.createElement("div");
    mergeRefs<HTMLDivElement>(object, callback)(node);
    expect(object.current).toBe(node);
    expect(callback).toHaveBeenCalledWith(node);
  });

  it("clears every ref when the returned cleanup runs", () => {
    const object = createRef<HTMLDivElement>();
    const callback = vi.fn();
    const node = document.createElement("div");
    const cleanup = mergeRefs<HTMLDivElement>(object, callback)(node) as () => void;
    cleanup();
    expect(object.current).toBeNull();
    expect(callback).toHaveBeenLastCalledWith(null);
  });

  it("runs the cleanup a callback ref returns instead of calling it with null", () => {
    const inner = vi.fn();
    const callback = vi.fn(() => inner);
    const cleanup = mergeRefs<HTMLDivElement>(callback)(document.createElement("div")) as () => void;
    cleanup();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("skips refs that are null or undefined", () => {
    const object = createRef<HTMLDivElement>();
    const node = document.createElement("div");
    const cleanup = mergeRefs<HTMLDivElement>(undefined, null, object)(node) as () => void;
    expect(object.current).toBe(node);
    expect(() => cleanup()).not.toThrow();
  });
});

describe("useMergedRefs", () => {
  function Probe({ first, second }: { first: Ref<HTMLDivElement>; second: Ref<HTMLDivElement> }) {
    const ref = useMergedRefs<HTMLDivElement>(first, second);
    return <div ref={ref} data-testid="probe" />;
  }

  it("fills both refs on mount and empties them on unmount", () => {
    const object = createRef<HTMLDivElement>();
    const callback = vi.fn();
    const { unmount } = render(<Probe first={object} second={callback} />);
    const node = screen.getByTestId("probe");
    expect(object.current).toBe(node);
    expect(callback).toHaveBeenCalledWith(node);
    unmount();
    expect(object.current).toBeNull();
    expect(callback).toHaveBeenLastCalledWith(null);
  });

  it("keeps the same attachment while the refs stay the same, and re-attaches when one changes", () => {
    const object = createRef<HTMLDivElement>();
    const callback = vi.fn();
    const { rerender } = render(<Probe first={object} second={callback} />);
    expect(callback).toHaveBeenCalledTimes(1);
    rerender(<Probe first={object} second={callback} />);
    expect(callback).toHaveBeenCalledTimes(1);
    const other = vi.fn();
    rerender(<Probe first={object} second={other} />);
    expect(other).toHaveBeenCalledWith(screen.getByTestId("probe"));
  });
});

describe("useLatest", () => {
  it("always holds the value of the latest render", () => {
    const { result, rerender } = renderHook(({ value }) => useLatest(value), { initialProps: { value: 1 } });
    expect(result.current.current).toBe(1);
    rerender({ value: 2 });
    expect(result.current.current).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* input modality                                                     */
/* ------------------------------------------------------------------ */

describe("isKeyboardModality", () => {
  it("turns on with a plain key press and off again with a pointer press", () => {
    fireEvent.pointerDown(document.body);
    expect(isKeyboardModality()).toBe(false);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(isKeyboardModality()).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(isKeyboardModality()).toBe(false);
  });

  it("is not fooled by shortcuts that carry a modifier key", () => {
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "c", metaKey: true });
    fireEvent.keyDown(document.body, { key: "c", altKey: true });
    expect(isKeyboardModality()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Escape                                                             */
/* ------------------------------------------------------------------ */

function Layer({ onEscape, enabled = true }: { onEscape: (e: KeyboardEvent) => void; enabled?: boolean }) {
  useEscape(onEscape, enabled);
  return <div />;
}

function pressEscape(init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
  act(() => void document.body.dispatchEvent(event));
  return event;
}

describe("useEscape", () => {
  it("calls only the topmost layer, then the one below once it is gone", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    render(<Layer onEscape={lower} />);
    const top = render(<Layer onEscape={upper} />);
    pressEscape();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    top.unmount();
    pressEscape();
    expect(lower).toHaveBeenCalledTimes(1);
  });

  it("consumes the event so hotkeys behind the overlay never see it", () => {
    render(<Layer onEscape={() => undefined} />);
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    const event = pressEscape();
    window.removeEventListener("keydown", behind);
    expect(event.defaultPrevented).toBe(true);
    expect(behind).not.toHaveBeenCalled();
  });

  it("leaves Escape alone when no layer is open", () => {
    const event = pressEscape();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores other keys and Escape pressed while composing text", () => {
    const handler = vi.fn();
    render(<Layer onEscape={handler} />);
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    pressEscape({ isComposing: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the keyboard event to the handler", () => {
    const handler = vi.fn();
    render(<Layer onEscape={handler} />);
    const event = pressEscape();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not take part while disabled, and joins at the top when enabled", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    render(<Layer onEscape={lower} />);
    const { rerender } = render(<Layer onEscape={upper} enabled={false} />);
    pressEscape();
    expect(lower).toHaveBeenCalledTimes(1);
    expect(upper).not.toHaveBeenCalled();
    rerender(<Layer onEscape={upper} enabled />);
    pressEscape();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).toHaveBeenCalledTimes(1);
  });

  it("calls the handler of the latest render without re-registering", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Layer onEscape={first} />);
    rerender(<Layer onEscape={second} />);
    pressEscape();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* outside clicks                                                     */
/* ------------------------------------------------------------------ */

describe("useOutsideClick", () => {
  function Panel({ onOutside, enabled = true, extra }: { onOutside: (e: PointerEvent) => void; enabled?: boolean; extra?: Element | null }) {
    const ref = useRef<HTMLDivElement>(null);
    useOutsideClick([ref, extra, undefined], onOutside, enabled);
    return (
      <div>
        <div ref={ref}>
          <button>inside</button>
        </div>
        <button>outside</button>
      </div>
    );
  }

  it("reports a press outside the elements and ignores presses inside", () => {
    const onOutside = vi.fn();
    render(<Panel onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "inside" }));
    expect(onOutside).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onOutside.mock.calls[0][0].type).toBe("pointerdown");
  });

  it("does nothing while disabled", () => {
    const onOutside = vi.fn();
    render(<Panel onOutside={onOutside} enabled={false} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("accepts elements as well as refs, so an anchor counts as inside", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const onOutside = vi.fn();
    render(<Panel onOutside={onOutside} extra={anchor} />);
    fireEvent.pointerDown(anchor);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("counts a layer opened from inside as inside", () => {
    const onOutside = vi.fn();
    render(<Panel onOutside={onOutside} />);
    const child = document.createElement("div");
    const button = document.createElement("button");
    child.append(button);
    document.body.append(child);
    const unregister = registerLayer(child, screen.getByRole("button", { name: "inside" }).parentElement);
    fireEvent.pointerDown(button);
    expect(onOutside).not.toHaveBeenCalled();
    unregister();
    fireEvent.pointerDown(button);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("calls the handler of the latest render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Panel onOutside={first} />);
    rerender(<Panel onOutside={second} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* media and resize                                                   */
/* ------------------------------------------------------------------ */

describe("useMedia", () => {
  it("returns the current answer and follows later changes", () => {
    const { result } = renderHook(() => useMedia("(max-width: 899px)"));
    expect(result.current).toBe(false);
    act(() => setMedia("(max-width: 899px)", true));
    expect(result.current).toBe(true);
    act(() => setMedia("(max-width: 899px)", false));
    expect(result.current).toBe(false);
  });

  it("only reacts to its own query", () => {
    const { result } = renderHook(() => useMedia("(max-width: 899px)"));
    act(() => setMedia("(prefers-reduced-motion: reduce)", true));
    expect(result.current).toBe(false);
  });

  it("answers false when rendered on a server, where there is no window to ask", () => {
    function Probe() {
      return <p>{useMedia("(max-width: 899px)") ? "narrow" : "wide"}</p>;
    }
    setMedia("(max-width: 899px)", true);
    expect(renderToString(<Probe />)).toContain("wide");
  });

  it("switches to the new query when the query changes", () => {
    setMedia("(min-width: 1200px)", true);
    const { result, rerender } = renderHook(({ query }) => useMedia(query), { initialProps: { query: "(max-width: 899px)" } });
    expect(result.current).toBe(false);
    rerender({ query: "(min-width: 1200px)" });
    expect(result.current).toBe(true);
  });
});

describe("useResizeObserver", () => {
  function Box({ onResize, enabled = true }: { onResize: (entry: ResizeObserverEntry) => void; enabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useResizeObserver(ref, onResize, enabled);
    return <div ref={ref} data-testid="box" />;
  }

  it("reports the size of the observed element", async () => {
    const restore = stubRects((el) => (el instanceof HTMLElement && el.dataset.testid === "box" ? rect(0, 0, 320, 180) : null));
    const onResize = vi.fn();
    render(<Box onResize={onResize} />);
    await act(async () => void (await Promise.resolve()));
    restore();
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0][0].contentRect.width).toBe(320);
    expect(onResize.mock.calls[0][0].contentRect.height).toBe(180);
  });

  it("does not observe while disabled", async () => {
    const observe = vi.spyOn(ResizeObserver.prototype, "observe");
    const onResize = vi.fn();
    render(<Box onResize={onResize} enabled={false} />);
    await act(async () => void (await Promise.resolve()));
    expect(observe).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("does nothing without an element and disconnects on unmount", async () => {
    const observe = vi.spyOn(ResizeObserver.prototype, "observe");
    const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
    renderHook(() => useResizeObserver(createRef<HTMLDivElement>(), () => undefined));
    expect(observe).not.toHaveBeenCalled();
    const { unmount } = render(<Box onResize={() => undefined} />);
    expect(observe).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* presence and scroll lock                                           */
/* ------------------------------------------------------------------ */

describe("usePresence", () => {
  it("stays mounted for the exit time after closing, flagging that it is closing", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 160), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, closing: false });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });
    act(() => void vi.advanceTimersByTime(159));
    expect(result.current.mounted).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  it("starts unmounted when it starts closed, and mounts at once when opened", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: false } });
    expect(result.current).toEqual({ mounted: false, closing: false });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  it("cancels the exit when it opens again in time", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 100), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => void vi.advanceTimersByTime(60));
    rerender({ open: true });
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current).toEqual({ mounted: true, closing: false });
  });
});

describe("useScrollLock", () => {
  function Lock({ on = true }: { on?: boolean }) {
    useScrollLock(on);
    return null;
  }

  afterEach(() => {
    document.body.removeAttribute("style");
  });

  it("hides the page scroll while mounted and restores the previous styles afterwards", () => {
    document.body.style.overflow = "scroll";
    document.body.style.paddingRight = "3px";
    const { unmount } = render(<Lock />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.body.style.paddingRight).toBe("3px");
  });

  it("pads the body by the width of the scrollbar so the page does not jump", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth - 15);
    const { unmount } = render(<Lock />);
    expect(document.body.style.paddingRight).toBe("15px");
    unmount();
    expect(document.body.style.paddingRight).toBe("");
  });

  it("adds no padding when there is no scrollbar", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth);
    const { unmount } = render(<Lock />);
    expect(document.body.style.paddingRight).toBe("");
    unmount();
  });

  it("counts its users: the page scrolls again only after the last one is gone", () => {
    const first = render(<Lock />);
    const second = render(<Lock />);
    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("does nothing while disabled and locks when it becomes enabled", () => {
    const { rerender, unmount } = render(<Lock on={false} />);
    expect(document.body.style.overflow).toBe("");
    rerender(<Lock on />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* focus helpers                                                      */
/* ------------------------------------------------------------------ */

function Tabbables() {
  return (
    <div data-testid="root" tabIndex={-1}>
      <button>one</button>
      <input aria-label="text" />
      <a href="#x">link</a>
      <button disabled>disabled</button>
      <input type="hidden" aria-label="hidden input" />
      <div tabIndex={0}>focusable div</div>
      <div tabIndex={-1}>programmatic only</div>
      <button aria-hidden="true">aria hidden</button>
      <div {...{ inert: true }}>
        <button>inert child</button>
      </div>
      <button style={{ visibility: "hidden" }}>invisible</button>
      <select aria-label="choice">
        <option>a</option>
      </select>
      <textarea aria-label="notes" />
      <span contentEditable="true" suppressContentEditableWarning>
        editable
      </span>
    </div>
  );
}

describe("getTabbables", () => {
  it("lists the visible keyboard-focusable elements in document order", () => {
    stubOffsets();
    render(<Tabbables />);
    const names = getTabbables(screen.getByTestId("root")).map((el) => el.getAttribute("aria-label") ?? el.textContent);
    expect(names).toEqual(["one", "text", "link", "focusable div", "choice", "notes", "editable"]);
  });

  it("treats elements without a box as hidden", () => {
    render(<Tabbables />);
    expect(getTabbables(screen.getByTestId("root"))).toEqual([]);
  });

  it("counts an element that has client rects even without an offset size", () => {
    render(<Tabbables />);
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([rect(0, 0, 10, 10)] as unknown as DOMRectList);
    expect(getTabbables(screen.getByTestId("root")).length).toBeGreaterThan(0);
  });
});

describe("trapTab", () => {
  function keyTab(target: Element, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  function setup() {
    stubOffsets();
    render(
      <div>
        <div data-testid="trap" tabIndex={-1}>
          <button>first</button>
          <button>middle</button>
          <button>last</button>
        </div>
        <button>after</button>
      </div>,
    );
    const root = screen.getByTestId("trap");
    const handler = (e: KeyboardEvent) => trapTab(e, root);
    root.addEventListener("keydown", handler);
    return { root, first: screen.getByText("first"), middle: screen.getByText("middle"), last: screen.getByText("last"), after: screen.getByText("after") };
  }

  it("wraps Tab from the last element to the first", () => {
    const { first, last } = setup();
    last.focus();
    const event = keyTab(last);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first element, or from the container, to the last", () => {
    const { root, first, last } = setup();
    first.focus();
    expect(keyTab(first, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    root.focus();
    keyTab(root, true);
    expect(document.activeElement).toBe(last);
  });

  it("lets Tab move on normally from the middle", () => {
    const { middle } = setup();
    middle.focus();
    expect(keyTab(middle).defaultPrevented).toBe(false);
    expect(keyTab(middle, true).defaultPrevented).toBe(false);
  });

  it("keeps focus on the container when there is nothing to tab to", () => {
    render(
      <div data-testid="empty" tabIndex={-1}>
        <span>text only</span>
      </div>,
    );
    const root = screen.getByTestId("empty");
    root.addEventListener("keydown", (e) => trapTab(e, root));
    const event = keyTab(screen.getByText("text only"));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root);
  });

  it("ignores other keys and events that come from outside the container", () => {
    const { root, after, last } = setup();
    last.focus();
    const other = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    last.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    const outside = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    Object.defineProperty(outside, "target", { value: after });
    trapTab(outside, root);
    expect(outside.defaultPrevented).toBe(false);
  });

  it("works with React keyboard events", () => {
    stubOffsets();
    function Trap() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref} tabIndex={-1} onKeyDown={(e: ReactKeyboardEvent) => ref.current && trapTab(e, ref.current)}>
          <button>a</button>
          <button>b</button>
        </div>
      );
    }
    render(<Trap />);
    screen.getByText("b").focus();
    fireEvent.keyDown(screen.getByText("b"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("a"));
  });
});

describe("focusElement", () => {
  it("focuses a connected element without scrolling", () => {
    render(<button>go</button>);
    const button = screen.getByText("go");
    const focus = vi.spyOn(button, "focus");
    focusElement(button);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(button);
  });

  it("does nothing for nothing, or for an element that left the page", () => {
    const detached = document.createElement("button");
    const focus = vi.spyOn(detached, "focus");
    expect(() => {
      focusElement(null);
      focusElement(undefined);
      focusElement(detached);
    }).not.toThrow();
    expect(focus).not.toHaveBeenCalled();
  });
});
