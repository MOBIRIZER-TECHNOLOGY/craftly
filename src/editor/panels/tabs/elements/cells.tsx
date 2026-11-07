/**
 * Small, reusable cells of the Elements tab: one per kind of content. The sub-pages lay them out in grids and the
 * overview's grouped search results reuse the very same cells, so click and drag behave identically everywhere.
 */
import { useEffect, useState } from "react";
import { createGraphic } from "@/core/factory";
import { getActions } from "@/core/store";
import type { DesignElement } from "@/core/types";
import { createGraphicElement } from "@/data/graphics";
import type { GraphicDef } from "@/data/graphicTypes";
import { getIconSvg, type IconDef } from "@/data/icons";
import { getPhotoThumb, type PhotoDef } from "@/data/photos";
import type { ShapePreset } from "@/data/shapes";
import { insertImage } from "@/editor/insert";
import { Skeleton, cx } from "@/ui";
import { DraggableItem } from "../../shared/DraggableItem";
import { LazyBox } from "../../shared/ItemGrid";
import { designMin } from "../../shared/panelActions";
import { ShapePreview } from "../../shared/ShapePreview";
import "./cells.css";

/** Adds elements to the active page, centred. */
export const addToPage = (els: DesignElement[]) => void getActions().addElements(els);

/* ------------------------------------------------------------------ */
/* shapes                                                              */
/* ------------------------------------------------------------------ */

export function ShapeCell({ preset }: { preset: ShapePreset }) {
  const make = () => preset.create(designMin());
  const look = preset.preview ?? { kind: preset.id };
  return (
    <DraggableItem label={preset.name} onInsert={() => addToPage([make()])} getPayload={() => ({ type: "elements", elements: [make()] })} className="cf-cell cf-cell--shape">
      <ShapePreview kind={look.kind} box={44} aspect={look.aspect} radiusRatio={look.radiusRatio} />
    </DraggableItem>
  );
}

/* ------------------------------------------------------------------ */
/* illustrations / stickers                                            */
/* ------------------------------------------------------------------ */

const viewBoxRatio = (svg: string): number => {
  const m = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!m) return 1;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 && h > 0 ? h / w : 1;
};

/** height / width of a graphic's viewBox, clamped so extreme strips do not break the masonry. */
export const graphicAspect = (def: GraphicDef): number => Math.min(1.5, Math.max(0.4, viewBoxRatio(def.svg)));

export function GraphicCell({ def }: { def: GraphicDef }) {
  const make = () => createGraphicElement(def, designMin());
  return (
    <DraggableItem label={def.name} onInsert={() => addToPage([make()])} getPayload={() => ({ type: "elements", elements: [make()] })} className="cf-cell cf-cell--graphic">
      <LazyBox aspect={graphicAspect(def)} radius={12} className="cf-cell__box">
        {/* the markup is the bundled illustration catalogue (trusted data, the same SVG the renderer draws) */}
        <div className={cx("cf-cell__svg", def.kind === "sticker" && "is-sticker")} dangerouslySetInnerHTML={{ __html: def.svg }} />
      </LazyBox>
    </DraggableItem>
  );
}

/* ------------------------------------------------------------------ */
/* icons                                                               */
/* ------------------------------------------------------------------ */

const iconCache = new Map<string, string>();

/** Markup of one library icon, fetched lazily and cached for the session. */
export function useIconSvg(id: string): string | null {
  const [svg, setSvg] = useState<string | null>(() => iconCache.get(id) ?? null);
  useEffect(() => {
    const hit = iconCache.get(id);
    if (hit) {
      setSvg(hit);
      return;
    }
    let alive = true;
    // best effort: when the icon library cannot be fetched the cell simply stays a placeholder
    void getIconSvg(id)
      .then((s) => {
        if (!s) return;
        iconCache.set(id, s);
        if (alive) setSvg(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  return svg;
}

const ICON_INK = "#0e1318";

async function makeIcon(def: IconDef) {
  const svg = (await getIconSvg(def.id)) ?? "";
  return createGraphic({ svg, colors: { currentColor: ICON_INK }, source: { kind: "icon", id: def.id }, width: 160, height: 160 });
}

export function IconCell({ def }: { def: IconDef }) {
  const svg = useIconSvg(def.id);
  const insert = async () => {
    const el = await makeIcon(def);
    if (el.svg) addToPage([el]);
  };
  return (
    <DraggableItem
      label={def.name}
      onInsert={() => void insert()}
      // dragstart must hand over the payload synchronously, so it uses the markup the cell already holds
      getPayload={() =>
        svg ? { type: "elements", elements: [createGraphic({ svg, colors: { currentColor: ICON_INK }, source: { kind: "icon", id: def.id }, width: 160, height: 160 })] } : null
      }
      className="cf-cell cf-cell--icon"
    >
      {/* lucide icon markup built by data/icons.ts from the bundled icon table (trusted) */}
      {svg ? <div className="cf-cell__icon" dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton width={26} height={26} radius={6} />}
    </DraggableItem>
  );
}

/* ------------------------------------------------------------------ */
/* photos                                                              */
/* ------------------------------------------------------------------ */

export const photoSrc = (def: PhotoDef) => `builtin:${def.id}`;

/** Thumbnail of a procedural photo (rendered on demand, shimmer until it is ready). */
export function PhotoThumb({ def, maxSide = 360 }: { def: PhotoDef; maxSide?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getPhotoThumb(def.id, maxSide)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [def.id, maxSide]);
  return url ? <img className="cf-cell__img" src={url} alt="" draggable={false} /> : <Skeleton width="100%" height="100%" radius={0} className="cf-cell__shimmer" />;
}

export function PhotoCell({ def }: { def: PhotoDef }) {
  return (
    <DraggableItem
      label={def.name}
      onInsert={() => void insertImage(photoSrc(def), def.width, def.height)}
      getPayload={() => ({ type: "image", src: photoSrc(def), naturalWidth: def.width, naturalHeight: def.height, name: def.name })}
      className="cf-cell cf-cell--photo"
      tooltip={false}
    >
      <LazyBox aspect={def.height / def.width} radius={12} className="cf-cell__box">
        <PhotoThumb def={def} />
      </LazyBox>
      <span className="cf-cell__caption">{def.name}</span>
    </DraggableItem>
  );
}
