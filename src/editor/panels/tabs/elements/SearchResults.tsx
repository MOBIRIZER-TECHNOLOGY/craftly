import { useEffect, useMemo, useState } from "react";
import { LINE_PRESETS } from "@/data/shapes";
import { searchGraphics } from "@/data/graphics";
import { loadIconIndex, searchIcons, type IconDef } from "@/data/icons";
import { PHOTOS } from "@/data/photos";
import { m } from "@/i18n";
import { IconSearch } from "@/ui";
import { EmptyHint } from "../../shared/EmptyHint";
import { ItemGrid, Masonry } from "../../shared/ItemGrid";
import { PanelLink, PanelSection } from "../../shared/PanelLayout";
import { GraphicCell, IconCell, PhotoCell, ShapeCell, graphicAspect } from "./cells";
import { useElementsNav } from "./nav";
import { ALL_SHAPE_PRESETS, LinesSection, matchLine, matchShape } from "./ShapesPage";
import { matchPhoto } from "./PhotosPage";

/**
 * What the overview shows while its search field has text: shapes, graphics, photos and icons that match, each in
 * its own short group with a "See all" link that opens the full sub-page with the same query.
 */
export function ElementsSearchResults({ query }: { query: string }) {
  const open = useElementsNav((s) => s.open);
  const q = query.trim().toLowerCase();

  const [icons, setIcons] = useState<IconDef[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadIconIndex()
      .then((list) => alive && setIcons(list))
      .catch(() => alive && setIcons([]));
    return () => {
      alive = false;
    };
  }, []);

  const shapes = useMemo(() => ALL_SHAPE_PRESETS.filter((p) => matchShape(p, q)), [q]);
  const hasLines = useMemo(() => LINE_PRESETS.some((p) => matchLine(p, q)), [q]);
  const graphics = useMemo(() => searchGraphics(query), [query]);
  const photos = useMemo(() => PHOTOS.filter((p) => matchPhoto(p, q)), [q]);
  const iconHits = useMemo(() => (icons ? searchIcons(icons, query, 400) : []), [icons, query]);

  const nothing = !shapes.length && !hasLines && !graphics.length && !photos.length && icons !== null && !iconHits.length;
  if (nothing) {
    return <EmptyHint icon={<IconSearch />} title={m.panelsTabs.elements.results.noneTitle} text={m.panelsTabs.elements.results.noneText(query.trim())} />;
  }

  return (
    <>
      {shapes.length ? (
        <PanelSection
          title={m.panelsTabs.elements.categories.shapes}
          action={shapes.length > 8 ? <PanelLink onClick={() => open("shapes", query)}>{m.panelsTabs.shared.seeAll}</PanelLink> : undefined}
        >
          <ItemGrid columns={4} gap={8}>
            {shapes.slice(0, 8).map((p) => (
              <ShapeCell key={p.id} preset={p} />
            ))}
          </ItemGrid>
        </PanelSection>
      ) : null}
      {hasLines ? (
        <PanelSection title={m.panelsTabs.elements.categories.lines} action={<PanelLink onClick={() => open("lines", query)}>{m.panelsTabs.shared.seeAll}</PanelLink>}>
          <LinesSection query={q} limit={4} />
        </PanelSection>
      ) : null}
      {graphics.length ? (
        <PanelSection
          title={m.panelsTabs.elements.categories.graphics}
          action={graphics.length > 6 ? <PanelLink onClick={() => open("graphics", query, "illustrations")}>{m.panelsTabs.shared.seeAll}</PanelLink> : undefined}
        >
          <Masonry items={graphics.slice(0, 6)} columns={2} gap={8} aspectOf={graphicAspect} keyOf={(d) => d.id} renderItem={(d) => <GraphicCell def={d} />} />
        </PanelSection>
      ) : null}
      {photos.length ? (
        <PanelSection
          title={m.panelsTabs.elements.categories.photos}
          action={photos.length > 4 ? <PanelLink onClick={() => open("photos", query)}>{m.panelsTabs.shared.seeAll}</PanelLink> : undefined}
        >
          <Masonry items={photos.slice(0, 4)} columns={2} gap={8} aspectOf={(p) => p.height / p.width} keyOf={(p) => p.id} renderItem={(p) => <PhotoCell def={p} />} />
        </PanelSection>
      ) : null}
      {iconHits.length ? (
        <PanelSection
          title={m.panelsTabs.elements.results.icons}
          action={iconHits.length > 8 ? <PanelLink onClick={() => open("graphics", query, "icons")}>{m.panelsTabs.shared.seeAll}</PanelLink> : undefined}
        >
          <ItemGrid columns={4} gap={8}>
            {iconHits.slice(0, 8).map((d) => (
              <div key={d.id} className="cf-searchicon">
                <IconCell def={d} />
              </div>
            ))}
          </ItemGrid>
        </PanelSection>
      ) : null}
    </>
  );
}
