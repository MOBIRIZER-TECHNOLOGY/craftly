import { useRef, useState, type KeyboardEvent } from "react";
import { getActions, useEditor, type LeftTab } from "@/core/store";
import { IconApps, IconBrand, IconCloudUpload, IconElements, IconFolder, IconTemplate, IconText, IconTools, cx, type LucideIcon } from "@/ui";
import { preloadTab } from "./SidePanel";
import { closeToolsPalette, toggleToolsPalette } from "./shared/railState";
import { ToolsPalette } from "./tabs/ToolsPalette";
import "./LeftRail.css";

interface RailTab {
  id: LeftTab;
  label: string;
  icon: LucideIcon;
}

/** Top to bottom, exactly as in the editor this mirrors. */
export const RAIL_TABS: RailTab[] = [
  { id: "templates", label: "Templates", icon: IconTemplate },
  { id: "elements", label: "Elements", icon: IconElements },
  { id: "text", label: "Text", icon: IconText },
  { id: "brand", label: "Brand", icon: IconBrand },
  { id: "uploads", label: "Uploads", icon: IconCloudUpload },
  { id: "tools", label: "Tools", icon: IconTools },
  { id: "projects", label: "Projects", icon: IconFolder },
  { id: "apps", label: "Apps", icon: IconApps },
];

/**
 * The 72px icon rail on the left of the editor. Clicking a tab opens its side panel; clicking the active tab
 * collapses / re-opens the panel. "Tools" has no panel: it toggles the floating tool palette instead.
 */
export function LeftRail() {
  const leftTab = useEditor((s) => s.leftTab);
  const panelOpen = useEditor((s) => s.panelOpen);
  const context = useEditor((s) => s.context);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<LeftTab | null>(null);

  const isActive = (id: LeftTab) => leftTab === id && (id === "tools" || panelOpen);

  const choose = (id: LeftTab) => {
    const actions = getActions();
    if (id === "tools") {
      toggleToolsPalette();
      return;
    }
    // re-selecting the open tab folds the panel away (unless a context panel is covering it: then go back to the tab)
    if (leftTab === id && panelOpen && !context) actions.toggle("panelOpen");
    else actions.setLeftTab(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const current = buttons.findIndex((b) => b === document.activeElement);
    let next: number;
    if (e.key === "ArrowDown") next = (current + 1) % buttons.length;
    else if (e.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else next = buttons.length - 1;
    buttons[next]?.focus();
  };

  const activeId = RAIL_TABS.find((t) => isActive(t.id))?.id ?? leftTab;

  return (
    <nav className={cx("cf-leftrail", !panelOpen && "is-flush")} aria-label="Editor tools">
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs are the focusable parts; the arrow keys move between them */}
      <div ref={listRef} className="cf-leftrail__list" role="tablist" aria-orientation="vertical" aria-label="Editor tools" onKeyDown={onKeyDown}>
        {RAIL_TABS.map(({ id, label, icon: Icon }) => {
          const active = isActive(id);
          return (
            <button
              key={id}
              id={`cf-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              // a context panel (Edit image, Animate ...) takes the place of the tab's panel, which then has no id on the page
              aria-controls={active && id !== "tools" && !context ? `cf-tabpanel-${id}` : undefined}
              aria-expanded={id === "tools" ? active : undefined}
              tabIndex={(focusId ?? activeId) === id ? 0 : -1}
              className={cx("cf-leftrail__tab", active && "is-active")}
              onFocus={() => {
                setFocusId(id);
                preloadTab(id);
              }}
              onBlur={() => setFocusId(null)}
              onPointerEnter={() => preloadTab(id)}
              onClick={() => choose(id)}
            >
              <span className="cf-leftrail__icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="cf-leftrail__label">{label}</span>
            </button>
          );
        })}
      </div>
      {leftTab === "tools" ? <ToolsPalette onClose={closeToolsPalette} /> : null}
    </nav>
  );
}
