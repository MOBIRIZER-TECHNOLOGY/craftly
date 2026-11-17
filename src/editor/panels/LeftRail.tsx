import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { getActions, useEditor, type LeftTab } from "@/core/store";
import { m } from "@/i18n";
import {
  IconApps,
  IconBrand,
  IconChevronLeft,
  IconChevronRight,
  IconCloudUpload,
  IconElements,
  IconFolder,
  IconTemplate,
  IconText,
  IconTools,
  cx,
  useMedia,
  useResizeObserver,
  type LucideIcon,
} from "@/ui";
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
  { id: "templates", label: m.panelsTabs.tabs.templates, icon: IconTemplate },
  { id: "elements", label: m.panelsTabs.tabs.elements, icon: IconElements },
  { id: "text", label: m.panelsTabs.tabs.text, icon: IconText },
  { id: "brand", label: m.panelsTabs.tabs.brand, icon: IconBrand },
  { id: "uploads", label: m.panelsTabs.tabs.uploads, icon: IconCloudUpload },
  { id: "tools", label: m.panelsTabs.tabs.tools, icon: IconTools },
  { id: "projects", label: m.panelsTabs.tabs.projects, icon: IconFolder },
  { id: "apps", label: m.panelsTabs.tabs.apps, icon: IconApps },
];

/**
 * The 72px icon rail on the left of the editor. Clicking a tab opens its side panel; clicking the active tab
 * collapses / re-opens the panel. "Tools" has no panel: it toggles the floating tool palette instead.
 *
 * Under 900 px the editor shell lays the rail out as a tab bar along the bottom. Eight tabs with their labels do not fit a
 * phone, so the bar scrolls sideways, like the context toolbar: the side with more tabs fades out under a chevron, the tab
 * that was chosen is scrolled into view and the arrow keys follow the bar's direction.
 */
export function LeftRail() {
  const leftTab = useEditor((s) => s.leftTab);
  const panelOpen = useEditor((s) => s.panelOpen);
  const context = useEditor((s) => s.context);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<LeftTab | null>(null);
  const horizontal = useMedia("(max-width: 899px)");
  // "l", "r" or "lr": the sides of the tab bar that have more tabs past them
  const [fade, setFade] = useState("");

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const max = list.scrollWidth - list.clientWidth;
    const next = max > 1 ? (list.scrollLeft > 1 ? "l" : "") + (list.scrollLeft < max - 1 ? "r" : "") : "";
    setFade((prev) => (prev === next ? prev : next));
  }, []);
  useLayoutEffect(measure, [measure, horizontal]);
  useResizeObserver(listRef, measure);

  /** scrolls the tab bar by most of its width, towards the end (1) or the start (-1) */
  const page = (direction: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const left = list.scrollLeft + direction * Math.max(64, list.clientWidth - 96);
    if (typeof list.scrollTo === "function") list.scrollTo({ left, behavior: "smooth" });
    else list.scrollLeft = left;
  };

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
    // down and up along the rail, right and left along the tab bar of a narrow screen (either pair works in both)
    const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const current = buttons.findIndex((b) => b === document.activeElement);
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (current + 1) % buttons.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else next = buttons.length - 1;
    buttons[next]?.focus();
  };

  const activeId = RAIL_TABS.find((t) => isActive(t.id))?.id ?? leftTab;

  // the tab bar of a narrow screen keeps the chosen tab in view (it may have been chosen from the keyboard or by the store)
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(`#cf-tab-${activeId}`);
    if (!horizontal || !list || !tab) return;
    const left = tab.offsetLeft - list.offsetLeft;
    const pad = 24; // past the edge fade
    if (left < list.scrollLeft + pad) list.scrollLeft = Math.max(0, left - pad);
    else if (left + tab.offsetWidth > list.scrollLeft + list.clientWidth - pad) list.scrollLeft = left + tab.offsetWidth - list.clientWidth + pad;
    measure();
  }, [activeId, horizontal, measure]);

  return (
    <nav className={cx("cf-leftrail", !panelOpen && "is-flush")} aria-label={m.panelsTabs.leftRail.label} data-fade={fade || undefined}>
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs are the focusable parts; the arrow keys move between them */}
      <div
        ref={listRef}
        className="cf-leftrail__list"
        role="tablist"
        aria-orientation={horizontal ? "horizontal" : "vertical"}
        aria-label={m.panelsTabs.leftRail.label}
        onKeyDown={onKeyDown}
        onScroll={measure}
      >
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
      {/*
       * The sign that more tabs lie past an edge of the tab bar; a tap on it scrolls the bar that way. It is for the eye and the
       * finger only: the keyboard and screen readers reach every tab in the tab list itself.
       */}
      <button type="button" className="cf-leftrail__more cf-leftrail__more--l" aria-hidden="true" tabIndex={-1} onClick={() => page(-1)}>
        <IconChevronLeft />
      </button>
      <button type="button" className="cf-leftrail__more cf-leftrail__more--r" aria-hidden="true" tabIndex={-1} onClick={() => page(1)}>
        <IconChevronRight />
      </button>
      {leftTab === "tools" ? <ToolsPalette onClose={closeToolsPalette} /> : null}
    </nav>
  );
}
