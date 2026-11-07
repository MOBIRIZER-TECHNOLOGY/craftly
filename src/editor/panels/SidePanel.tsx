import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { useEditor, type LeftTab } from "@/core/store";
import { IconButton, IconChevronLeft, IconChevronRight, Skeleton, cx, usePresence } from "@/ui";
import { ContextPanel } from "./context";
import { PanelBoundary } from "./shared/PanelBoundary";
import { PanelScroll, Panel, PanelTop } from "./shared/PanelLayout";
import "./SidePanel.css";

/* Each tab is its own chunk: the data catalogues (graphics, photos, templates, emoji ...) load when first needed. */
const loaders: Record<Exclude<LeftTab, "tools">, () => Promise<{ default: ComponentType }>> = {
  templates: () => import("./tabs/TemplatesTab"),
  elements: () => import("./tabs/ElementsTab"),
  text: () => import("./tabs/TextTab"),
  brand: () => import("./tabs/BrandTab"),
  uploads: () => import("./tabs/UploadsTab"),
  projects: () => import("./tabs/ProjectsTab"),
  apps: () => import("./tabs/AppsTab"),
};

const lazyTabs = Object.fromEntries(Object.entries(loaders).map(([id, load]) => [id, lazy(load)])) as unknown as Record<Exclude<LeftTab, "tools">, ComponentType>;

/** A chunk requested ahead of need. If it cannot be fetched nobody is waiting for it: opening the tab asks again and shows the retry panel. */
const warm = (load: () => Promise<unknown>): void => void load().catch(() => undefined);

/** Starts downloading a tab's chunk (the rail calls this when a tab is hovered or focused). */
export function preloadTab(tab: LeftTab): void {
  if (tab !== "tools") warm(loaders[tab]);
}

const TAB_TITLES: Record<LeftTab, string> = {
  templates: "Templates",
  elements: "Elements",
  text: "Text",
  brand: "Brand",
  uploads: "Uploads",
  tools: "Tools",
  projects: "Projects",
  apps: "Apps",
};

/** Placeholder shown while a tab's chunk loads: search field and a few tiles. */
function TabSkeleton() {
  return (
    <Panel>
      <PanelTop>
        <Skeleton height={52} radius={16} />
      </PanelTop>
      <PanelScroll>
        <Skeleton width={120} height={16} radius={6} style={{ marginBottom: 14 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} height={84} radius={16} />
          ))}
        </div>
      </PanelScroll>
    </Panel>
  );
}

/**
 * The ~340px panel beside the rail: the active tab, or - when the editor opened one - a context panel
 * (Position, Effects, Colour ...) in its place. A round handle on the right edge folds it away; when folded only a
 * small handle at the left edge of the workspace remains. "Tools" has no panel (its palette floats instead).
 */
export function SidePanel() {
  const leftTab = useEditor((s) => s.leftTab);
  const context = useEditor((s) => s.context);
  const panelOpen = useEditor((s) => s.panelOpen);
  const toggle = useEditor((s) => s.actions.toggle);
  const [, reloadTabs] = useState(0);

  const hasContent = context !== null || leftTab !== "tools";
  const open = panelOpen && hasContent;
  const { mounted } = usePresence(open, 260);

  // warm up the default tab's chunk once the editor is idle
  useEffect(() => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const run = () => warm(loaders.elements);
    const handle = idle ? idle(run) : window.setTimeout(run, 800);
    return () => {
      if (!idle) window.clearTimeout(handle);
    };
  }, []);

  const Tab = leftTab !== "tools" ? lazyTabs[leftTab] : null;
  const label = context ? "Options" : TAB_TITLES[leftTab];

  return (
    <aside id="cf-sidepanel" className={cx("cf-sidepanel", open && "is-open")} aria-label={`${label} panel`} data-collapsed={!open || undefined}>
      <div className="cf-sidepanel__clip">
        <div className="cf-sidepanel__inner">
          {mounted && (context || Tab) ? (
            <div
              key={context ? `context-${context.kind}` : leftTab}
              className="cf-sidepanel__body"
              role={context ? undefined : "tabpanel"}
              id={context ? undefined : `cf-tabpanel-${leftTab}`}
              aria-labelledby={context ? undefined : `cf-tab-${leftTab}`}
            >
              {/* the panel's own heading, between the page's h1 and the h3 titles of the sections inside it */}
              {context ? null : <h2 className="cf-sr-only">{TAB_TITLES[leftTab]}</h2>}
              {context ? (
                <ContextPanel state={context} />
              ) : Tab ? (
                <PanelBoundary
                  resetKey={leftTab}
                  label={TAB_TITLES[leftTab]}
                  onRetry={() => {
                    // a lazy component remembers a failed import: make a fresh one so the chunk is requested again
                    if (leftTab !== "tools") lazyTabs[leftTab] = lazy(loaders[leftTab]);
                    reloadTabs((n) => n + 1);
                  }}
                >
                  <Suspense fallback={<TabSkeleton />}>
                    <Tab />
                  </Suspense>
                </PanelBoundary>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {hasContent ? (
        <IconButton
          label={open ? "Hide panel" : "Show panel"}
          icon={open ? <IconChevronLeft /> : <IconChevronRight />}
          size="sm"
          className="cf-sidepanel__handle"
          aria-expanded={open}
          aria-controls="cf-sidepanel"
          onClick={() => toggle("panelOpen")}
        />
      ) : null}
    </aside>
  );
}
