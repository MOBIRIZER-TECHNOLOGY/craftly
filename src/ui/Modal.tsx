import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import "./Modal.css";
import { cx } from "./cx";
import { focusElement, getTabbables, trapTab, useEscape, useLatest, usePresence, useScrollLock } from "./hooks";
import { IconClose } from "./icons";
import { findParentLayer, focusReturnTarget, getOverlayRoot, registerLayer, zAbove } from "./overlay";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ModalSize;
  /** content of the footer row (usually right-aligned Buttons) */
  footer?: ReactNode;
  /** close when the backdrop is clicked (default true) */
  closeOnBackdrop?: boolean;
  /** close on Escape (default true) */
  closeOnEscape?: boolean;
  /** hide the round close button in the top-right corner */
  hideClose?: boolean;
  className?: string;
  /** remove the body padding so the content can lay itself out edge to edge */
  flush?: boolean;
  /** extra class for the scrolling body element */
  bodyClassName?: string;
  /** accessible name when there is no visible `title` */
  "aria-label"?: string;
  /** element that should receive focus on open (default: [data-autofocus], else the first tabbable) */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

/** Counts open modals so the page can tell hotkeys / other code that a dialog is active (body[data-cf-modal-open]). */
let openModals = 0;
const inertCounts = new Map<Element, number>();

/** Makes everything outside the overlay root inert while a modal is open (focus and AT are confined to the dialog). */
function setBackgroundInert(on: boolean): void {
  const root = getOverlayRoot();
  for (const child of Array.from(document.body.children)) {
    if (child === root || child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
    const count = inertCounts.get(child) ?? 0;
    if (on) {
      inertCounts.set(child, count + 1);
      (child as HTMLElement).inert = true;
    } else if (count <= 1) {
      inertCounts.delete(child);
      (child as HTMLElement).inert = false;
    } else {
      inertCounts.set(child, count - 1);
    }
  }
}

/**
 * The element that is to get focus back: the one that opened the dialog, or - when that was swapped for another while the
 * dialog was open (a button that turned into a progress block and back) - the one that carries the same `data-focus-key`.
 */
function stillThere(el: HTMLElement | null): HTMLElement | null {
  if (!el || el.isConnected) return el;
  const key = el.dataset.focusKey;
  if (!key) return null;
  return Array.from(document.querySelectorAll<HTMLElement>("[data-focus-key]")).find((candidate) => candidate.dataset.focusKey === key) ?? null;
}

export function Modal({ open, ...props }: ModalProps) {
  const { mounted, closing } = usePresence(open, 160);
  if (!mounted) return null;
  return createPortal(<ModalLayer {...props} closing={closing} />, getOverlayRoot());
}

function ModalLayer({
  onClose,
  title,
  size = "md",
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideClose = false,
  className,
  flush = false,
  bodyClassName,
  "aria-label": ariaLabel,
  initialFocusRef,
  children,
  closing,
}: Omit<ModalProps, "open"> & { closing: boolean }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const onCloseRef = useLatest(onClose);
  // Captured while rendering, before children (autofocus inputs) can move focus in their own effects.
  const [previous] = useState<HTMLElement | null>(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  // Where focus goes back to on close. Not the menu item that opened this dialog (the menu is closed by then), but the
  // button that opened the menu.
  const [returnTo] = useState<HTMLElement | null>(() => (previous ? focusReturnTarget(previous) : null));

  useScrollLock(true);

  // Stacking, inert background, initial focus and focus restore.
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    if (!backdrop || !dialog) return;

    const parent = findParentLayer(previous);
    const unregister = registerLayer(backdrop, parent);
    const lifted = zAbove(parent);
    // Only lift above the base modal layer (a modal opened from inside another modal).
    if (lifted !== null && lifted > 200) backdrop.style.zIndex = String(lifted);

    setBackgroundInert(true);
    openModals += 1;
    document.body.dataset.cfModalOpen = String(openModals);

    const target =
      initialFocusRef?.current ??
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      getTabbables(dialog.querySelector(".cf-modal__body") ?? dialog)[0] ??
      getTabbables(dialog)[0] ??
      dialog;
    focusElement(target);

    return () => {
      unregister();
      setBackgroundInert(false);
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) delete document.body.dataset.cfModalOpen;
      else document.body.dataset.cfModalOpen = String(openModals);
      focusElement(stillThere(returnTo));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEscape(() => {
    if (closeOnEscape) onCloseRef.current();
  }, !closing);

  // Keep focus from escaping when an inert-less environment is used (older browsers).
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const dialog = dialogRef.current;
      const t = e.target;
      if (!dialog || !(t instanceof Node) || closing) return;
      const backdrop = backdropRef.current;
      if (backdrop && backdrop.contains(t)) return;
      // focus inside a layer opened from this modal (popover / submenu) is fine
      if (t instanceof Element && t.closest("[data-cf-layer]")) return;
      if (t instanceof Element && t.closest("#cf-overlay-root")) return;
      focusElement(dialog);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [closing]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (dialogRef.current) trapTab(e, dialogRef.current);
  };

  const onBackdropPointerDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const wasPressed = pressedBackdrop.current;
    pressedBackdrop.current = false;
    if (closeOnBackdrop && wasPressed && e.target === e.currentTarget) onClose();
  };

  const hasTitle = title !== undefined && title !== null && title !== false;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a click on the backdrop closes the dialog; the keyboard closes it with Esc
    <div
      ref={backdropRef}
      className={cx("cf-modal-backdrop", closing && "is-closing")}
      data-cf-layer="modal"
      onPointerDown={onBackdropPointerDown}
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        className={cx("cf-modal", `cf-modal--${size}`, flush && "cf-modal--flush", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-label={hasTitle ? undefined : ariaLabel}
        tabIndex={-1}
      >
        {hasTitle ? (
          <header className="cf-modal__header">
            <h2 id={titleId} className="cf-modal__title">
              {title}
            </h2>
          </header>
        ) : null}
        <div className={cx("cf-modal__body", bodyClassName)}>{children}</div>
        {footer ? <footer className="cf-modal__footer">{footer}</footer> : null}
        {/* Last in DOM order so initial focus lands on the content; positioned top-right with CSS. */}
        {hideClose ? null : (
          <button type="button" className="cf-modal__close" aria-label="Close" onClick={() => onClose()}>
            <IconClose aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
