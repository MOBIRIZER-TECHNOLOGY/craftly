import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, IconStar, IconTemplate, SearchField, Tabs, useResizeObserver } from "@/ui";
import type { Template, TemplateCategory } from "@/core/types";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS, searchTemplates } from "@/data/templates";
import { navigate } from "@/router";
import { openCreateDialog } from "./createDialogState";
import { useFavouriteTemplates } from "./data";
import { m } from "@/i18n";
import { Hero } from "./Hero";
import { Page } from "./Page";
import { TemplateCard } from "./TemplateCard";
import { takePresetTemplateSearch } from "./templatePreview";
import { CATEGORY_ORDER } from "./templateLists";
import "./TemplatesPage.css";

const PAGE_SIZE = 24;
const GAP = 16;

const isCategory = (value: string | undefined): value is TemplateCategory => value !== undefined && value in TEMPLATE_CATEGORY_LABELS;
/** `#/templates/favourites`: the Favourites chip has a route of its own, so that it survives a reload and Back returns to it. */
export const FAVOURITES_ROUTE = "favourites";

/** Columns that fit the width, and the width of one column (matches the CSS `column-count` layout). */
function columnsFor(width: number): { count: number; width: number } {
  const minColumn = width < 600 ? 150 : width < 900 ? 190 : 220;
  const count = Math.max(width < 420 ? 2 : 1, Math.floor((width + GAP) / (minColumn + GAP)));
  return { count, width: Math.max(80, Math.floor((width - GAP * (count - 1)) / count)) };
}

/** Templates: hero search, route-synced category chips, a masonry of template cards with "Show more". */
export function TemplatesPage({ category }: { category?: string }) {
  const activeCategory = isCategory(category) ? category : null;
  const [query, setQuery] = useState("");
  const onlyFavourites = category === FAVOURITES_ROUTE;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const favourites = useFavouriteTemplates();

  // a search typed on Home ("See all templates") arrives here
  useEffect(() => {
    const preset = takePresetTemplateSearch();
    if (preset) setQuery(preset);
  }, []);

  useEffect(() => setLimit(PAGE_SIZE), [query, category]);

  const counts = useMemo(() => {
    const map = new Map<TemplateCategory, number>();
    for (const template of TEMPLATES) map.set(template.category, (map.get(template.category) ?? 0) + 1);
    return map;
  }, []);

  const results = useMemo(() => {
    // Favourites is a chip beside the categories, not inside one: it spans every category (B2)
    if (onlyFavourites) return searchTemplates(query, null).filter((template) => favourites.has(template.id));
    return searchTemplates(query, activeCategory);
  }, [query, activeCategory, onlyFavourites, favourites]);

  const chipIds = [...CATEGORY_ORDER.filter((id) => (counts.get(id) ?? 0) > 0 || id === activeCategory)];
  const chipValue = onlyFavourites ? FAVOURITES_ROUTE : (activeCategory ?? "all");

  const shown = results.slice(0, limit);
  const searching = query.trim().length > 0;
  const catalogueEmpty = TEMPLATES.length === 0;

  return (
    <div className="cf-tplpage">
      <Hero title={m.dashboard.templates.title} active="templates" compact>
        <SearchField size="lg" value={query} onChange={setQuery} placeholder={m.dashboard.templates.searchPlaceholder} aria-label={m.dashboard.templates.searchLabel} />
      </Hero>

      <Page className="cf-tplpage__page">
        <div className="cf-tplpage__chips">
          <Tabs
            variant="pill"
            aria-label={m.dashboard.home.categories}
            value={chipValue}
            onChange={(id) => navigate(id === "all" ? "/templates" : `/templates/${id}`)}
            tabs={[
              { id: "all", label: m.dashboard.shared.all },
              ...chipIds.map((id) => ({ id, label: TEMPLATE_CATEGORY_LABELS[id] })),
              { id: FAVOURITES_ROUTE, label: m.dashboard.templates.favourites, icon: <IconStar aria-hidden="true" /> },
            ]}
          />
        </div>

        {catalogueEmpty ? (
          <EmptyState
            headingLevel={2}
            icon={<IconTemplate />}
            title={m.dashboard.templates.comingTitle}
            text={m.dashboard.templates.comingText}
            action={
              <Button variant="primary" onClick={() => openCreateDialog()}>
                {m.dashboard.shared.browseDesignTypes}
              </Button>
            }
          />
        ) : results.length === 0 ? (
          <EmptyState
            headingLevel={2}
            icon={onlyFavourites ? <IconStar /> : <IconTemplate />}
            title={
              onlyFavourites && !searching ? m.dashboard.templates.noFavourites : searching ? m.dashboard.templates.noMatch(query.trim()) : m.dashboard.templates.noneInCategory
            }
            text={onlyFavourites && !searching ? m.dashboard.templates.noFavouritesText : searching ? m.dashboard.templates.noMatchText : m.dashboard.templates.noneInCategoryText}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  if (searching) {
                    setQuery("");
                    return;
                  }
                  if (activeCategory || onlyFavourites) navigate("/templates");
                }}
              >
                {searching ? m.dashboard.templates.clearSearch : m.dashboard.templates.showAll}
              </Button>
            }
          />
        ) : (
          <>
            <p className="cf-tplpage__count" aria-live="polite">
              {results.length > shown.length ? m.dashboard.templates.showing(shown.length, results.length) : m.dashboard.counts.templates(results.length)}
            </p>
            <Masonry templates={shown} />
            {results.length > shown.length ? (
              <div className="cf-tplpage__more">
                <Button variant="secondary" size="lg" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                  {m.common.showMore}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Page>
    </div>
  );
}

function Masonry({ templates }: { templates: Template[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth);
  }, []);
  useResizeObserver(ref, (entry) => setWidth(Math.round(entry.contentRect.width)));

  const columns = columnsFor(width || 960);
  return (
    <div className="cf-tplpage__masonry" ref={ref} style={{ columnCount: columns.count, columnGap: GAP }}>
      {width > 0
        ? templates.map((template) => (
            <div className="cf-tplpage__item" key={template.id}>
              <TemplateCard template={template} width={columns.width} showName />
            </div>
          ))
        : null}
    </div>
  );
}
