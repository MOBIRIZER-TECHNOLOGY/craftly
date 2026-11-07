import { useEffect, useMemo, useState } from "react";
import { LINE_PRESETS } from "@/data/shapes";
import { searchGraphics } from "@/data/graphics";
import { loadIconIndex, searchIcons, type IconDef } from "@/data/icons";
import { PHOTOS } from "@/data/photos";
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
    return <EmptyHint icon={<IconSearch />} title="No elements found" text={`Nothing matches "${query.trim()}". Try a simpler word like "heart", "arrow" or "sunset".`} />;
  }

  return (
    <>
      {shapes.length ? (
        <PanelSection title="Shapes" action={shapes.length > 8 ? <PanelLink onClick={() => open("shapes", query)}>See all</PanelLink> : undefined}>
          <ItemGrid columns={4} gap={8}>
            {shapes.slice(0, 8).map((p) => (
              <ShapeCell key={p.id} preset={p} />
            ))}
          </ItemGrid>
        </PanelSection>
      ) : null}
      {hasLines ? (
        <PanelSection title="Lines" action={<PanelLink onClick={() => open("lines", query)}>See all</PanelLink>}>
          <LinesSection query={q} limit={4} />
        </PanelSection>
      ) : null}
      {graphics.length ? (
        <PanelSection title="Graphics" action={graphics.length > 6 ? <PanelLink onClick={() => open("graphics", query, "illustrations")}>See all</PanelLink> : undefined}>
          <Masonry items={graphics.slice(0, 6)} columns={2} gap={8} aspectOf={graphicAspect} keyOf={(d) => d.id} renderItem={(d) => <GraphicCell def={d} />} />
        </PanelSection>
      ) : null}
      {photos.length ? (
        <PanelSection title="Photos" action={photos.length > 4 ? <PanelLink onClick={() => open("photos", query)}>See all</PanelLink> : undefined}>
          <Masonry items={photos.slice(0, 4)} columns={2} gap={8} aspectOf={(p) => p.height / p.width} keyOf={(p) => p.id} renderItem={(p) => <PhotoCell def={p} />} />
        </PanelSection>
      ) : null}
      {iconHits.length ? (
        <PanelSection title="Icons" action={iconHits.length > 8 ? <PanelLink onClick={() => open("graphics", query, "icons")}>See all</PanelLink> : undefined}>
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
