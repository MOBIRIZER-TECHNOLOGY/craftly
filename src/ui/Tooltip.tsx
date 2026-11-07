import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";
import { useMergedRefs } from "./hooks";
import { anchorRect, getOverlayRoot, placeFloating } from "./overlay";
import { formatShortcut } from "./shortcut";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  /** shortcut shown next to the text, e.g. "Ctrl+Z" */
  shortcut?: string;
  placement?: TooltipPlacement;
  /** hover delay in ms (default 450); keyboard focus shows it immediately */
  delay?: number;
  /** the trigger; must accept a ref and pointer / focus handlers (any DOM element or forwardRef component) */
  children: ReactElement;
  /** turns the tooltip off without unwrapping the trigger */
  disabled?: boolean;
  /** link the tooltip to the trigger with aria-describedby (default true; disable when it repeats the aria-label) */
  describe?: boolean;
}

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
};

/** When a tooltip closed a moment ago the next one opens instantly (like native toolbars). */
let lastHideAt = 0;
const GRACE_MS = 300;

export function Tooltip({ content, shortcut, placement = "top", delay = 450, children, disabled = false, describe = true }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef(0);
  const id = useId();
  const trigger = children.props as TriggerProps;
  const mergedRef = useMergedRefs<HTMLElement>(anchorRef, trigger.ref);
  const hasContent = content !== null && content !== undefined && content !== false && content !== "";
  const active = hasContent && !disabled;

  const show = useCallback(
    (immediate: boolean) => {
      window.clearTimeout(timerRef.current);
      const wait = immediate || Date.now() - lastHideAt < GRACE_MS ? 0 : delay;
      timerRef.current = window.setTimeout(() => {
        openRef.current = true;
        setOpen(true);
      }, wait);
    },
    [delay],
  );

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current);
    if (openRef.current) {
      lastHideAt = Date.now();
      openRef.current = false;
      setOpen(false);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // Hide when the page scrolls or resizes underneath the tooltip.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  // A disabled tooltip must not stay open.
  useEffect(() => {
    if (!active) hide();
  }, [active, hide]);

  const triggerEl = active
    ? cloneElement(children as ReactElement<TriggerProps>, {
        ref: mergedRef,
        onPointerEnter: (e: PointerEvent<HTMLElement>) => {
          trigger.onPointerEnter?.(e);
          if (e.pointerType !== "touch") show(false);
        },
        onPointerLeave: (e: PointerEvent<HTMLElement>) => {
          trigger.onPointerLeave?.(e);
          hide();
        },
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
          trigger.onPointerDown?.(e);
          hide();
        },
        onFocus: (e: FocusEvent<HTMLElement>) => {
          trigger.onFocus?.(e);
          if (e.target.matches(":focus-visible")) show(true);
        },
        onBlur: (e: FocusEvent<HTMLElement>) => {
          trigger.onBlur?.(e);
          hide();
        },
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
          trigger.onKeyDown?.(e);
          if (e.key === "Escape" && openRef.current) hide();
        },
        "aria-describedby": open && describe ? id : trigger["aria-describedby"],
      })
    : children;

  // Same tree shape whether or not the tooltip is active, so the trigger is never remounted.
  return (
    <>
      {triggerEl}
      {active && open && anchorRef.current
        ? createPortal(<TooltipBubble id={id} anchor={anchorRef.current} placement={placement} content={content} shortcut={shortcut} />, getOverlayRoot())
        : null}
    </>
  );
}

interface BubbleProps {
  id: string;
  anchor: HTMLElement;
  placement: TooltipPlacement;
  content: ReactNode;
  shortcut?: string;
}

function TooltipBubble({ id, anchor, placement, content, shortcut }: BubbleProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const result = placeFloating({
      anchor: anchorRect(anchor),
      size: { width: el.offsetWidth, height: el.offsetHeight },
      placement: { side: placement, align: "center" },
      offset: 8,
      margin: 6,
    });
    el.style.left = `${Math.round(result.x)}px`;
    el.style.top = `${Math.round(result.y)}px`;
    el.dataset.side = result.side;
  }, [anchor, placement, content, shortcut]);

  return (
    <div ref={ref} id={id} role="tooltip" className="cf-tooltip" data-side={placement}>
      <span className="cf-tooltip__text">{content}</span>
      {shortcut ? <span className="cf-tooltip__kbd">{formatShortcut(shortcut)}</span> : null}
    </div>
  );
}
