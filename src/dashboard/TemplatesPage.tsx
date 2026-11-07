import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, IconStar, IconTemplate, SearchField, Tabs, useResizeObserver } from "@/ui";
import type { Template, TemplateCategory } from "@/core/types";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS, searchTemplates } from "@/data/templates";
import { navigate } from "@/router";
import { openCreateDialog } from "./createDialogState";
import { useFavouriteTemplates } from "./data";
import { plural } from "./format";
import { Hero } from "./Hero";
import { Page } from "./Page";
import { TemplateCard } from "./TemplateCard";
import { takePresetTemplateSearch } from "./templatePreview";
import { CATEGORY_ORDER } from "./templateLists";
import "./TemplatesPage.css";

const PAGE_SIZE = 24;
const GAP = 16;

const isCategory = (value: string | undefined): value is TemplateCategory => value !== undefined && value in TEMPLATE_CATEGORY_LABELS;

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
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const favourites = useFavouriteTemplates();

  // a search typed on Home ("See all templates") arrives here
  useEffect(() => {
    const preset = takePresetTemplateSearch();
    if (preset) setQuery(preset);
  }, []);

  useEffect(() => setOnlyFavourites(false), [category]);
  useEffect(() => setLimit(PAGE_SIZE), [query, category, onlyFavourites]);

  const counts = useMemo(() => {
    const map = new Map<TemplateCategory, number>();
    for (const template of TEMPLATES) map.set(template.category, (map.get(template.category) ?? 0) + 1);
    return map;
  }, []);

  const results = useMemo(() => {
    const found = searchTemplates(query, activeCategory);
    return onlyFavourites ? found.filter((template) => favourites.has(template.id)) : found;
  }, [query, activeCategory, onlyFavourites, favourites]);

  const chipIds = [...CATEGORY_ORDER.filter((id) => (counts.get(id) ?? 0) > 0 || id === activeCategory)];
  const chipValue = onlyFavourites ? "favourites" : (activeCategory ?? "all");

  const shown = results.slice(0, limit);
  const searching = query.trim().length > 0;
  const catalogueEmpty = TEMPLATES.length === 0;

  return (
    <div className="cf-tplpage">
      <Hero title="Start with a great template" active="templates" compact>
        <SearchField size="lg" value={query} onChange={setQuery} placeholder="Search templates, e.g. birthday, resume or pitch" aria-label="Search templates" />
      </Hero>

      <Page className="cf-tplpage__page">
        <div className="cf-tplpage__chips">
          <Tabs
            variant="pill"
            aria-label="Template categories"
            value={chipValue}
            onChange={(id) => {
              if (id === "favourites") setOnlyFavourites(true);
              else {
                setOnlyFavourites(false);
                navigate(id === "all" ? "/templates" : `/templates/${id}`);
              }
            }}
            tabs={[
              { id: "all", label: "All" },
              ...chipIds.map((id) => ({ id, label: TEMPLATE_CATEGORY_LABELS[id] })),
              { id: "favourites", label: "Favourites", icon: <IconStar aria-hidden="true" /> },
            ]}
          />
        </div>

        {catalogueEmpty ? (
          <EmptyState
            headingLevel={2}
            icon={<IconTemplate />}
            title="Templates are on their way"
            text="There are no templates to show yet. You can still start from a blank design of any size."
            action={
              <Button variant="primary" onClick={() => openCreateDialog()}>
                Browse design types
              </Button>
            }
          />
        ) : results.length === 0 ? (
          <EmptyState
            headingLevel={2}
            icon={onlyFavourites ? <IconStar /> : <IconTemplate />}
            title={onlyFavourites && !searching ? "No favourite templates yet" : searching ? `No templates match “${query.trim()}”` : "No templates in this category"}
            text={
              onlyFavourites && !searching
                ? "Tap the star on a template to keep it here."
                : searching
                  ? "Check the spelling, try a more general word, or pick another category."
                  : "Try another category, or look at all templates."
            }
            action={
              <Button
                variant="primary"
                onClick={() => {
                  if (searching) {
                    setQuery("");
                    return;
                  }
                  setOnlyFavourites(false);
                  if (activeCategory) navigate("/templates");
                }}
              >
                {searching ? "Clear search" : "Show all templates"}
              </Button>
            }
          />
        ) : (
          <>
            <p className="cf-tplpage__count" aria-live="polite">
              {results.length > shown.length ? `Showing ${shown.length} of ${plural(results.length, "template")}` : plural(results.length, "template")}
            </p>
            <Masonry templates={shown} />
            {results.length > shown.length ? (
              <div className="cf-tplpage__more">
                <Button variant="secondary" size="lg" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                  Show more
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
