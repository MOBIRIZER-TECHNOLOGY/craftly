import { useEffect, useMemo, useState } from "react";
import { GRAPHIC_CATEGORIES, searchGraphics } from "@/data/graphics";
import type { GraphicCategory } from "@/data/graphicTypes";
import { ICON_SUGGESTIONS, ICON_SYNONYMS, loadIconIndex, searchIcons, type IconDef } from "@/data/icons";
import { IconGraphics, IconSearch, Skeleton, Tabs } from "@/ui";
import { ChipRow } from "../../shared/ChipRow";
import { EmptyHint } from "../../shared/EmptyHint";
import { useElementWidth } from "../../shared/hooks";
import { ItemGrid, Masonry, VirtualGrid } from "../../shared/ItemGrid";
import { Panel, PanelScroll } from "../../shared/PanelLayout";
import { GraphicCell, IconCell, graphicAspect } from "./cells";
import { useElementsNav, type GraphicsPane } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./GraphicsPage.css";

const PANES = [
  { id: "illustrations", label: "Illustrations" },
  { id: "icons", label: "Icons" },
];

/** Library order for the empty query: the curated "popular" ids first, then everything else alphabetically. */
function browseOrder(index: IconDef[]): IconDef[] {
  const byId = new Map(index.map((d) => [d.id, d]));
  const popular: IconDef[] = [];
  for (const id of Object.keys(ICON_SYNONYMS)) {
    const def = byId.get(id);
    if (def) {
      popular.push(def);
      byId.delete(id);
    }
  }
  return [...popular, ...byId.values()];
}

export function GraphicsPage() {
  const pane = useElementsNav((s) => s.graphicsPane);
  const setPane = useElementsNav((s) => s.setGraphicsPane);
  const query = useElementsNav((s) => s.query);
  const setQuery = useElementsNav((s) => s.setQuery);
  const [category, setCategory] = useState<string>("all");

  const chips = useMemo(() => [{ id: "all", label: "All" }, ...GRAPHIC_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))], []);
  const suggestionChips = useMemo(() => ICON_SUGGESTIONS.map((s) => ({ id: s, label: s.charAt(0).toUpperCase() + s.slice(1) })), []);

  return (
    <Panel>
      <SubPageTop title="Graphics" placeholder={pane === "icons" ? "Search icons" : "Search graphics"}>
        <Tabs tabs={PANES} value={pane} onChange={(id) => setPane(id as GraphicsPane)} fullWidth aria-label="Graphics type" idBase="cf-graphics" />
        {pane === "illustrations" ? (
          <ChipRow chips={chips} value={category} onChange={setCategory} aria-label="Illustration categories" />
        ) : (
          <ChipRow
            chips={suggestionChips}
            value={suggestionChips.some((c) => c.id === query.trim().toLowerCase()) ? query.trim().toLowerCase() : null}
            onChange={(id) => setQuery(id === query.trim().toLowerCase() ? "" : id)}
            aria-label="Popular icon searches"
          />
        )}
      </SubPageTop>
      <PanelScroll>
        <div role="tabpanel" id={`cf-graphics-panel-${pane}`} aria-labelledby={`cf-graphics-tab-${pane}`}>
          {pane === "illustrations" ? <IllustrationsPane query={query} category={category === "all" ? null : (category as GraphicCategory)} /> : <IconsPane query={query} />}
        </div>
      </PanelScroll>
    </Panel>
  );
}

function IllustrationsPane({ query, category }: { query: string; category: GraphicCategory | null }) {
  const results = useMemo(() => searchGraphics(query, category), [query, category]);
  if (!results.length) {
    return (
      <EmptyHint
        icon={<IconGraphics />}
        title="No graphics found"
        text={query.trim() ? `Nothing matches "${query.trim()}". Try another word or pick a different category.` : "This category is empty."}
      />
    );
  }
  return <Masonry items={results} columns={2} minColumnWidth={140} gap={8} aspectOf={graphicAspect} keyOf={(d) => d.id} renderItem={(d) => <GraphicCell def={d} />} />;
}

function IconsPane({ query }: { query: string }) {
  const [index, setIndex] = useState<IconDef[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  // four icons across the 340px panel, more in the wide bottom sheet
  const columns = Math.max(4, Math.floor((width + 8) / 72));

  useEffect(() => {
    let alive = true;
    loadIconIndex()
      .then((list) => alive && setIndex(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const results = useMemo(() => {
    if (!index) return [];
    return query.trim() ? searchIcons(index, query, 900) : browseOrder(index);
  }, [index, query]);

  let body;
  if (failed) body = <EmptyHint icon={<IconSearch />} title="Icons could not load" text="Check your connection and reopen this panel." />;
  else if (!index) {
    body = (
      <ItemGrid columns={columns} gap={8}>
        {Array.from({ length: columns * 6 }, (_, i) => (
          <Skeleton key={i} height={64} radius={12} />
        ))}
      </ItemGrid>
    );
  } else if (!results.length) body = <EmptyHint icon={<IconSearch />} title="No icons found" text={`Nothing matches "${query.trim()}". Try "arrow", "heart" or "chart".`} />;
  else {
    body = (
      <>
        <p className="cf-iconcount">{query.trim() ? `${results.length} icons` : `${results.length} icons - popular ones first`}</p>
        <VirtualGrid count={results.length} columns={columns} rowHeight={64} gap={8} aria-label="Icons" renderItem={(i) => <IconCell key={results[i].id} def={results[i]} />} />
      </>
    );
  }
  return <div ref={hostRef}>{body}</div>;
}
