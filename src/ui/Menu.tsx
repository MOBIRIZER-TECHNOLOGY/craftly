import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import "./Menu.css";
import { cx } from "./cx";
import { focusElement, isKeyboardModality } from "./hooks";
import { IconCheck, IconChevronRight } from "./icons";
import { Popover, type PopoverAnchor, type PopoverPlacement } from "./Popover";
import { formatShortcut } from "./shortcut";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface MenuItemEntry {
  type?: "item";
  /** stable id (also the React key) */
  id: string;
  label: string;
  icon?: ReactNode;
  /** shown right-aligned, e.g. "Ctrl+C" */
  shortcut?: string;
  disabled?: boolean;
  /** red destructive styling */
  danger?: boolean;
  /** turns the item into a checkbox item; `true` shows a check mark */
  checked?: boolean;
  /** right-aligned grey text (e.g. "Thumbnails") */
  hint?: string;
  onSelect?: () => void;
  /** nested entries; the item then opens a submenu instead of calling onSelect */
  submenu?: MenuEntry[];
}

export interface MenuDividerEntry {
  type: "divider";
}

export interface MenuLabelEntry {
  type: "label";
  label: string;
}

export type MenuEntry = MenuItemEntry | MenuDividerEntry | MenuLabelEntry;

function isItem(entry: MenuEntry): entry is MenuItemEntry {
  return entry.type === undefined || entry.type === "item";
}

/* ------------------------------------------------------------------ */
/* MenuList                                                           */
/* ------------------------------------------------------------------ */

export interface MenuListProps {
  items: MenuEntry[];
  /** called after an item was chosen and when the menu wants to be dismissed (Tab) */
  onClose: () => void;
  /** focus the list on mount (the first item for keyboard users). Default true. */
  autoFocus?: boolean;
  /** always focus the first item on mount, not only after keyboard interaction (keyboard-opened submenus) */
  focusFirst?: boolean;
  /** called when ArrowLeft is pressed in a submenu */
  onExitLeft?: () => void;
  className?: string;
  "aria-label"?: string;
}

const ITEM_SELECTOR = ':scope > [role^="menuitem"]:not([aria-disabled="true"])';
const SUBMENU_OPEN_DELAY = 140;
const SUBMENU_CLOSE_DELAY = 180;

function enabledItems(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

interface OpenSubmenu {
  id: string;
  anchor: HTMLElement;
  viaKeyboard: boolean;
}

/** The roving-focus menu list. Use inside a Popover (see MenuPopover) or as a static list (see Menu). */
export function MenuList({ items, onClose, autoFocus = true, focusFirst = false, onExitLeft, className, "aria-label": ariaLabel }: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<OpenSubmenu | null>(null);
  const subRef = useRef<OpenSubmenu | null>(null);
  subRef.current = sub;
  const timer = useRef(0);
  const typeahead = useRef({ text: "", at: 0 });
  const baseId = useId();

  const hasGutter = items.some((entry) => isItem(entry) && (entry.icon !== undefined || entry.checked !== undefined));

  // Runs before the surrounding Popover decides where to put focus.
  useLayoutEffect(() => {
    if (!autoFocus) return;
    const list = listRef.current;
    if (!list) return;
    const first = enabledItems(list)[0];
    if ((focusFirst || isKeyboardModality()) && first) focusElement(first);
    else list.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const closeSub = (refocusParent: boolean) => {
    window.clearTimeout(timer.current);
    const current = subRef.current;
    if (current && refocusParent) focusElement(current.anchor);
    setSub(null);
  };

  const openSub = (entry: MenuItemEntry, anchor: HTMLElement, viaKeyboard: boolean) => {
    window.clearTimeout(timer.current);
    setSub({ id: entry.id, anchor, viaKeyboard });
  };

  const choose = (entry: MenuItemEntry, anchor: HTMLElement, viaKeyboard: boolean) => {
    if (entry.disabled) return;
    if (entry.submenu && entry.submenu.length > 0) {
      openSub(entry, anchor, viaKeyboard);
      return;
    }
    onClose();
    entry.onSelect?.();
  };

  const onPointerEnterItem = (entry: MenuItemEntry, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "touch") return;
    const el = e.currentTarget;
    window.clearTimeout(timer.current);
    if (entry.disabled) {
      timer.current = window.setTimeout(() => closeSub(false), SUBMENU_CLOSE_DELAY);
      return;
    }
    // Mouse hover moves the highlight, exactly like arrow keys do.
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (entry.submenu && entry.submenu.length > 0) {
      if (sub?.id !== entry.id) timer.current = window.setTimeout(() => openSub(entry, el, false), SUBMENU_OPEN_DELAY);
    } else if (sub) {
      timer.current = window.setTimeout(() => closeSub(false), SUBMENU_CLOSE_DELAY);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current;
    // Synthetic events from portalled submenus bubble through here; they belong to the submenu's own list.
    if (!list || !(e.target instanceof Node) || !list.contains(e.target)) return;
    const els = enabledItems(list);
    const current = els.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => focusElement(els[(i + els.length) % els.length]);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (els.length) focusAt(current < 0 ? 0 : current + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (els.length) focusAt(current < 0 ? els.length - 1 : current - 1);
        return;
      case "Home":
        e.preventDefault();
        focusAt(0);
        return;
      case "End":
        e.preventDefault();
        focusAt(els.length - 1);
        return;
      case "ArrowRight": {
        const el = els[current];
        if (el?.getAttribute("aria-haspopup") === "menu") {
          e.preventDefault();
          const entry = items.find((it): it is MenuItemEntry => isItem(it) && el.dataset.menuId === it.id);
          if (entry) choose(entry, el, true);
        }
        return;
      }
      case "ArrowLeft":
        if (onExitLeft) {
          e.preventDefault();
          onExitLeft();
        }
        return;
      case "Tab":
        e.preventDefault();
        onClose();
        return;
      default:
        break;
    }

    // Type-ahead: jump to the next item whose label starts with the typed text.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      const now = Date.now();
      const buf = typeahead.current;
      buf.text = now - buf.at > 700 ? e.key.toLowerCase() : buf.text + e.key.toLowerCase();
      buf.at = now;
      const ordered = [...els.slice(current + 1), ...els.slice(0, current + 1)];
      const match = ordered.find((el) => (el.dataset.label ?? "").toLowerCase().startsWith(buf.text));
      if (match) {
        e.preventDefault();
        focusElement(match);
      }
    }
  };

  const subEntry = sub ? items.find((it): it is MenuItemEntry => isItem(it) && it.id === sub.id) : undefined;

  return (
    <div ref={listRef} className={cx("cf-menu", className)} role="menu" aria-label={ariaLabel} tabIndex={-1} onKeyDown={onKeyDown}>
      {items.map((entry, index) => {
        if (entry.type === "divider") return <div key={`d${index}`} className="cf-menu__divider" role="separator" />;
        if (entry.type === "label") {
          return (
            <div key={`l${index}`} className="cf-menu__label" role="presentation">
              {entry.label}
            </div>
          );
        }
        const hasSub = !!entry.submenu && entry.submenu.length > 0;
        const isCheckbox = entry.checked !== undefined;
        const leading = entry.icon ?? (entry.checked ? <IconCheck aria-hidden="true" /> : null);
        const trailingCheck = isCheckbox && entry.checked && entry.icon ? <IconCheck aria-hidden="true" className="cf-menu__check" /> : null;
        return (
          <button
            key={entry.id}
            id={`${baseId}-${entry.id}`}
            type="button"
            role={isCheckbox ? "menuitemcheckbox" : "menuitem"}
            aria-checked={isCheckbox ? entry.checked : undefined}
            aria-disabled={entry.disabled || undefined}
            aria-haspopup={hasSub ? "menu" : undefined}
            aria-expanded={hasSub ? sub?.id === entry.id : undefined}
            tabIndex={-1}
            className={cx("cf-menu__item", entry.danger && "is-danger", sub?.id === entry.id && "is-open")}
            data-menu-id={entry.id}
            data-label={entry.label}
            onPointerEnter={(e) => onPointerEnterItem(entry, e)}
            onClick={(e) => choose(entry, e.currentTarget, e.detail === 0)}
          >
            {hasGutter ? <span className="cf-menu__icon">{leading}</span> : null}
            <span className="cf-menu__text">{entry.label}</span>
            {entry.hint ? <span className="cf-menu__hint">{entry.hint}</span> : null}
            {entry.shortcut ? <span className="cf-menu__shortcut">{formatShortcut(entry.shortcut)}</span> : null}
            {trailingCheck}
            {hasSub ? <IconChevronRight aria-hidden="true" className="cf-menu__chevron" /> : null}
          </button>
        );
      })}

      {sub && subEntry?.submenu ? (
        <Popover
          open
          anchor={sub.anchor}
          onClose={() => closeSub(true)}
          placement="right-start"
          offset={2}
          alignOffset={-6}
          role="presentation"
          trapFocus={false}
          restoreFocus={false}
          initialFocus={sub.viaKeyboard}
          className="cf-popover--menu"
        >
          <MenuList
            items={subEntry.submenu}
            onClose={onClose}
            autoFocus={sub.viaKeyboard}
            focusFirst={sub.viaKeyboard}
            onExitLeft={() => closeSub(true)}
            aria-label={subEntry.label}
          />
        </Popover>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Menu (static surface)                                              */
/* ------------------------------------------------------------------ */

/** A menu rendered in place with its own card surface (for sidebars and docs; popups use MenuPopover). */
export function Menu(props: MenuListProps) {
  return <MenuList {...props} className={cx("cf-menu--surface", props.className)} />;
}

/* ------------------------------------------------------------------ */
/* MenuPopover                                                        */
/* ------------------------------------------------------------------ */

export interface MenuPopoverProps {
  open: boolean;
  anchor: PopoverAnchor;
  onClose: () => void;
  items: MenuEntry[];
  placement?: PopoverPlacement;
  /** gap to the anchor (default 6) */
  offset?: number;
  matchWidth?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** A menu in a Popover: arrow keys, type-ahead, submenus, closes after a choice and returns focus to the trigger. */
export function MenuPopover({ open, anchor, onClose, items, placement = "bottom-start", offset = 6, matchWidth, className, "aria-label": ariaLabel }: MenuPopoverProps) {
  return (
    <Popover
      open={open}
      anchor={anchor}
      onClose={onClose}
      placement={placement}
      offset={offset}
      matchWidth={matchWidth}
      role="presentation"
      trapFocus={false}
      className={cx("cf-popover--menu", className)}
    >
      <MenuList items={items} onClose={onClose} aria-label={ariaLabel} />
    </Popover>
  );
}
