import { useRef, type KeyboardEvent, type ReactNode } from "react";
import "./Tabs.css";
import { cx } from "./cx";

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  value: string;
  onChange: (id: string) => void;
  tabs: TabItem[];
  /** "underline" (default) for page sections, "pill" for compact switchers on tinted backgrounds */
  variant?: "underline" | "pill";
  /** tabs share the full width equally */
  fullWidth?: boolean;
  className?: string;
  "aria-label"?: string;
  /**
   * When set, every tab gets `id="{idBase}-tab-{id}"` and `aria-controls="{idBase}-panel-{id}"` so the matching
   * panel (`id="{idBase}-panel-{id}"`, `role="tabpanel"`) can be wired up.
   */
  idBase?: string;
}

export function Tabs({ value, onChange, tabs, variant = "underline", fullWidth = false, className, "aria-label": ariaLabel, idBase }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const index = enabled.findIndex((t) => t.id === value);
    let next: TabItem | undefined;
    switch (e.key) {
      case "ArrowRight":
        next = enabled[(index + 1) % enabled.length];
        break;
      case "ArrowLeft":
        next = enabled[(index - 1 + enabled.length) % enabled.length];
        break;
      case "Home":
        next = enabled[0];
        break;
      case "End":
        next = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    e.preventDefault();
    if (!next) return;
    onChange(next.id);
    // Move DOM focus together with the selection (roving tabindex).
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus();
    });
  };

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs are the focusable parts; the arrow keys move between them
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cx("cf-tabs", `cf-tabs--${variant}`, fullWidth && "cf-tabs--full", className)}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${tab.id}` : undefined}
            aria-controls={idBase ? `${idBase}-panel-${tab.id}` : undefined}
            aria-selected={selected}
            disabled={tab.disabled}
            tabIndex={selected ? 0 : -1}
            data-tab-id={tab.id}
            className={cx("cf-tabs__tab", selected && "is-selected")}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon ? <span className="cf-tabs__icon">{tab.icon}</span> : null}
            <span className="cf-tabs__label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
