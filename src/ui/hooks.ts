/**
 * Small hooks and DOM helpers shared by the UI kit. Everything here is used by at least one component.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ForwardedRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type RefCallback,
  type RefObject,
} from "react";
import { layerContains } from "./overlay";

/* ------------------------------------------------------------------ */
/* Refs                                                               */
/* ------------------------------------------------------------------ */

type AnyRef<T> = Ref<T> | ForwardedRef<T> | undefined;

/** Combines several refs (callback or object) into one callback ref. */
export function mergeRefs<T>(...refs: AnyRef<T>[]): RefCallback<T> {
  return (node: T | null) => {
    const cleanups: Array<() => void> = [];
    for (const ref of refs) {
      if (typeof ref === "function") {
        const cleanup = ref(node);
        cleanups.push(typeof cleanup === "function" ? cleanup : () => ref(null));
      } else if (ref) {
        (ref as { current: T | null }).current = node;
        cleanups.push(() => {
          (ref as { current: T | null }).current = null;
        });
      }
    }
    return () => cleanups.forEach((fn) => fn());
  };
}

/** Memoised `mergeRefs`. */
export function useMergedRefs<T>(...refs: AnyRef<T>[]): RefCallback<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mergeRefs(...refs), refs);
}

/** Always holds the latest value; lets effects call fresh callbacks without re-subscribing. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/* ------------------------------------------------------------------ */
/* Input modality                                                     */
/* ------------------------------------------------------------------ */

let keyboardModality = false;

if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      keyboardModality = true;
    },
    true,
  );
  document.addEventListener("pointerdown", () => (keyboardModality = false), true);
}

/** True when the last user interaction came from the keyboard (used to decide whether menus pre-select an item). */
export function isKeyboardModality(): boolean {
  return keyboardModality;
}

/* ------------------------------------------------------------------ */
/* Escape handling (topmost layer wins)                               */
/* ------------------------------------------------------------------ */

type EscapeHandler = (e: KeyboardEvent) => void;

const escapeStack: Array<RefObject<EscapeHandler>> = [];
let escapeBound = false;

function onDocumentKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.isComposing) return;
  const top = escapeStack[escapeStack.length - 1];
  if (!top) return;
  // Consume the event so editor hotkeys behind the overlay do not also react to it.
  e.preventDefault();
  e.stopPropagation();
  top.current(e);
}

/**
 * Calls `handler` when Escape is pressed - but only for the topmost enabled layer, so Esc closes a
 * submenu before its menu, a popover before its modal, and so on. The event is consumed
 * (`preventDefault` + `stopPropagation`), so global hotkeys should ignore `defaultPrevented` events.
 * Components that handle Esc themselves (NumberField, SearchField) stop propagation in React first.
 */
export function useEscape(handler: EscapeHandler, enabled = true): void {
  const ref = useLatest(handler);
  useEffect(() => {
    if (!enabled) return;
    if (!escapeBound) {
      escapeBound = true;
      document.addEventListener("keydown", onDocumentKeyDown);
    }
    escapeStack.push(ref);
    return () => {
      const i = escapeStack.lastIndexOf(ref);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [enabled, ref]);
}

/* ------------------------------------------------------------------ */
/* Outside clicks                                                     */
/* ------------------------------------------------------------------ */

type RefLike = RefObject<Element | null> | Element | null | undefined;

/**
 * Calls `handler` on a pointerdown outside every element in `refs`. Elements of layers that were opened
 * from inside one of the refs (nested popovers, submenus) count as inside.
 */
export function useOutsideClick(refs: ReadonlyArray<RefLike>, handler: (e: PointerEvent) => void, enabled = true): void {
  const handlerRef = useLatest(handler);
  const refsRef = useLatest(refs);
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      for (const r of refsRef.current) {
        const el = r instanceof Element ? r : r ? r.current : null;
        if (el && layerContains(el, e.target)) return;
      }
      handlerRef.current(e);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [enabled, handlerRef, refsRef]);
}

/* ------------------------------------------------------------------ */
/* Media + resize                                                     */
/* ------------------------------------------------------------------ */

/** Subscribes to a CSS media query. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Calls `cb` whenever the referenced element changes size. */
export function useResizeObserver<T extends Element>(ref: RefObject<T | null>, cb: (entry: ResizeObserverEntry) => void, enabled = true): void {
  const cbRef = useLatest(cb);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) cbRef.current(entry);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled, cbRef]);
}

/* ------------------------------------------------------------------ */
/* Presence (exit animations)                                         */
/* ------------------------------------------------------------------ */

/**
 * Keeps a component mounted for `exitMs` after `open` turns false so it can play an exit animation.
 * `closing` is true during that window.
 */
export function usePresence(open: boolean, exitMs = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}

/* ------------------------------------------------------------------ */
/* Scroll lock                                                        */
/* ------------------------------------------------------------------ */

let scrollLocks = 0;
let savedOverflow = "";
let savedPadding = "";

/** Locks page scroll (reference counted, compensates for the scrollbar width). */
export function useScrollLock(enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const body = document.body;
    if (scrollLocks === 0) {
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      savedOverflow = body.style.overflow;
      savedPadding = body.style.paddingRight;
      body.style.overflow = "hidden";
      if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    }
    scrollLocks += 1;
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) {
        body.style.overflow = savedOverflow;
        body.style.paddingRight = savedPadding;
      }
    };
  }, [enabled]);
}

/* ------------------------------------------------------------------ */
/* Focus helpers                                                      */
/* ------------------------------------------------------------------ */

const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Visible, keyboard-focusable descendants of `root` in DOM order. */
export function getTabbables(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.getAttribute("aria-hidden") === "true" || el.closest("[inert]")) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) return false;
    return getComputedStyle(el).visibility !== "hidden";
  });
}

/**
 * Keeps Tab / Shift+Tab inside `root`. Ignores events that originate outside the root's DOM subtree
 * (React bubbles synthetic events from portals to their React parents).
 */
export function trapTab(e: KeyboardEvent | ReactKeyboardEvent, root: HTMLElement): void {
  if (e.key !== "Tab" || !(e.target instanceof Node) || !root.contains(e.target)) return;
  const items = getTabbables(root);
  if (items.length === 0) {
    e.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || active === root) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Moves focus without scrolling the page. */
export function focusElement(el: HTMLElement | null | undefined): void {
  if (el && el.isConnected) el.focus({ preventScroll: true });
}
