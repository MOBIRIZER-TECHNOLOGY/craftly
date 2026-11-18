import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import "./Popover.css";
import { cx } from "./cx";
import { focusElement, trapTab, useEscape, useLatest, useMergedRefs, useOutsideClick } from "./hooks";
import { anchorRect, findParentLayer, getOverlayRoot, parsePlacement, placeFloating, registerLayer, zAbove } from "./overlay";

export type PopoverPlacement = "bottom-start" | "bottom" | "bottom-end" | "top-start" | "top" | "top-end" | "right-start" | "left-start";

/** An element to attach to, or a viewport point (context menus), or null (nothing is rendered). */
export type PopoverAnchor = HTMLElement | { x: number; y: number } | null;

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: PopoverAnchor;
  placement?: PopoverPlacement;
  /** gap between anchor and panel in px (default 8) */
  offset?: number;
  /** make the panel at least as wide as the anchor element */
  matchWidth?: boolean;
  className?: string;
  children?: ReactNode;
  /** ARIA role of the panel (default "dialog"; menus use "presentation") */
  role?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
  style?: CSSProperties;
  /** move focus into the panel when it opens (default true) */
  initialFocus?: boolean;
  /** return focus to the previously focused element when it closes (default true) */
  restoreFocus?: boolean;
  /** keep Tab inside the panel (default true; menus close on Tab instead) */
  trapFocus?: boolean;
  /** close on Escape (default true) */
  closeOnEscape?: boolean;
  /** close on a pointer press outside the panel and its anchor (default true) */
  closeOnOutsidePress?: boolean;
  /** shifts the panel along the cross axis (px), used to align submenu items with their parent item */
  alignOffset?: number;
}

type PanelProps = Omit<PopoverProps, "open"> & { forwardedRef: Ref<HTMLDivElement> };

/**
 * Floating panel attached to an anchor. Portalled into `#cf-overlay-root`, flips and shifts to stay in the
 * viewport, closes on Esc / outside press, traps Tab and restores focus. Popovers opened from inside another
 * popover or modal are lifted above it and count as "inside" it for outside-press handling.
 */
export const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover({ open, ...props }, ref) {
  if (!open || !props.anchor) return null;
  return <PopoverPanel {...props} forwardedRef={ref} />;
});

function PopoverPanel({
  onClose,
  anchor,
  placement = "bottom-start",
  offset = 8,
  matchWidth = false,
  className,
  children,
  role = "dialog",
  initialFocus = true,
  restoreFocus = true,
  trapFocus = true,
  closeOnEscape = true,
  closeOnOutsidePress = true,
  alignOffset = 0,
  style,
  forwardedRef,
  ...aria
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const merged = useMergedRefs<HTMLDivElement>(panelRef, forwardedRef);
  const anchorEl = anchor instanceof HTMLElement ? anchor : null;
  const pointX = anchor && !(anchor instanceof HTMLElement) ? anchor.x : 0;
  const pointY = anchor && !(anchor instanceof HTMLElement) ? anchor.y : 0;
  const anchorRef = useLatest(anchor);
  const onCloseRef = useLatest(onClose);
  // Captured while rendering: children (e.g. a menu that focuses itself) move focus in their own layout
  // effects, which run before this component's effects.
  const [previous] = useState<HTMLElement | null>(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));

  // Layer registration, stacking, focus in / focus restore. Runs once per open.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const parent = findParentLayer(anchorRef.current);
    const unregister = registerLayer(panel, parent, previous ?? anchorEl);
    const lifted = zAbove(parent);
    if (lifted !== null) panel.style.zIndex = String(lifted);

    // The element marked `data-autofocus` takes the focus, else the panel itself. (React's own `autoFocus` is not enough here:
    // it focuses only when the element is first put in the page, so StrictMode's second run of this effect, after the cleanup
    // has given the focus back to the trigger, would leave it on the panel.)
    if (initialFocus && !panel.contains(document.activeElement)) (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus({ preventScroll: true });

    return () => {
      unregister();
      if (!restoreFocus) return;
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) focusElement(previous);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Positioning: initial, and again on scroll / resize / size changes.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const target = anchorRef.current;
    if (!panel || !target) return;
    let frame = 0;

    const update = () => {
      if (anchorEl && !anchorEl.isConnected) {
        onCloseRef.current();
        return;
      }
      const rect = anchorRect(target);
      panel.style.maxHeight = "";
      if (matchWidth && anchorEl) panel.style.minWidth = `${Math.round(rect.right - rect.left)}px`;
      const result = placeFloating({
        anchor: rect,
        size: { width: panel.offsetWidth, height: panel.offsetHeight },
        placement: parsePlacement(placement),
        offset,
        alignOffset,
      });
      panel.style.left = `${Math.round(result.x)}px`;
      panel.style.top = `${Math.round(result.y)}px`;
      if (result.maxHeight < panel.offsetHeight) panel.style.maxHeight = `${Math.floor(result.maxHeight)}px`;
      panel.dataset.side = result.side;
      panel.dataset.align = result.align;
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const onScroll = (e: Event) => {
      // scrolling inside the panel itself never moves it
      if (e.target instanceof Node && panel.contains(e.target)) return;
      schedule();
    };

    update();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", onScroll, true);
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    if (anchorEl) observer.observe(anchorEl);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", onScroll, true);
      observer.disconnect();
    };
  }, [anchorEl, pointX, pointY, placement, offset, matchWidth, alignOffset, anchorRef, onCloseRef]);

  useOutsideClick([panelRef, anchorEl], () => {
    if (closeOnOutsidePress) onCloseRef.current();
  });
  useEscape(() => {
    if (closeOnEscape) onCloseRef.current();
  });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (trapFocus && panelRef.current) trapTab(e, panelRef.current);
  };

  return createPortal(
    <div
      ref={merged}
      className={cx("cf-popover", className)}
      data-cf-layer="popover"
      data-side={parsePlacement(placement).side}
      data-align={parsePlacement(placement).align}
      role={role}
      tabIndex={-1}
      style={style}
      onKeyDown={onKeyDown}
      {...aria}
    >
      {children}
    </div>,
    getOverlayRoot(),
  );
}
