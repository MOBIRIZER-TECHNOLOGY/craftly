import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { setDragPayload, type DragPayload } from "@/editor/insert";
import { cx } from "@/ui";
import "./DraggableItem.css";

export interface DraggableItemProps {
  /** accessible name (also the native tooltip unless `tooltip` is false) */
  label: string;
  /** click / Enter / Space: put the item on the page */
  onInsert: () => void;
  /** builds what gets dragged onto the canvas; omit for items that cannot be dragged */
  getPayload?: () => DragPayload | null;
  children: ReactNode;
  className?: string;
  tooltip?: boolean;
  disabled?: boolean;
  /** `true` marks the item as the current choice (aria-pressed) */
  pressed?: boolean;
}

/**
 * Wraps one panel item: a click (or Enter / Space) inserts it, dragging it drops it where the pointer is released
 * on the canvas. It is a focusable `role="button"` div rather than a <button>, because Firefox cannot drag buttons.
 */
export function DraggableItem({ label, onInsert, getPayload, children, className, tooltip = true, disabled = false, pressed }: DraggableItemProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onInsert();
    }
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    const payload = disabled ? null : getPayload?.();
    if (!payload) {
      e.preventDefault();
      return;
    }
    setDragPayload(e, payload);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      title={tooltip ? label : undefined}
      className={cx("cf-ditem", disabled && "is-disabled", className)}
      draggable={!!getPayload && !disabled}
      onClick={disabled ? undefined : onInsert}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
    >
      {children}
    </div>
  );
}
