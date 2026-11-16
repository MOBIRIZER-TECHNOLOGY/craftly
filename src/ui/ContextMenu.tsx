import { useEffect, useSyncExternalStore } from "react";
import { m } from "@/i18n";
import { MenuPopover, type MenuEntry } from "./Menu";

export interface ContextMenuRequest {
  /** viewport coordinates (clientX / clientY of the contextmenu event) */
  x: number;
  y: number;
  items: MenuEntry[];
  /** called once when the menu is dismissed or replaced */
  onClose?: () => void;
}

interface ActiveMenu extends ContextMenuRequest {
  key: number;
}

let active: ActiveMenu | null = null;
let sequence = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): ActiveMenu | null {
  return active;
}

/** Opens the (single) context menu at a viewport point. Call from an `onContextMenu` handler after `preventDefault()`. */
export function openContextMenu(request: ContextMenuRequest): void {
  const previous = active;
  sequence += 1;
  active = { ...request, key: sequence };
  emit();
  previous?.onClose?.();
}

export function closeContextMenu(): void {
  const previous = active;
  if (!previous) return;
  active = null;
  emit();
  previous.onClose?.();
}

/** Mount once near the app root; renders whatever `openContextMenu` requested. */
export function ContextMenuHost() {
  const menu = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A context menu is tied to the pointer position: dismiss it when the surroundings change.
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => closeContextMenu();
    const onScroll = (e: Event) => {
      const t = e.target;
      // scrolling inside the menu itself is fine
      if (t instanceof Element && t.closest(".cf-popover--menu")) return;
      closeContextMenu();
    };
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onScroll, true);
    };
  }, [menu]);

  return (
    <MenuPopover
      key={menu?.key ?? 0}
      open={menu !== null}
      anchor={menu ? { x: menu.x, y: menu.y } : null}
      onClose={closeContextMenu}
      items={menu?.items ?? []}
      placement="bottom-start"
      offset={2}
      aria-label={m.ui.contextMenu.label}
    />
  );
}
