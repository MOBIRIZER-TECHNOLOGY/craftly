import { useEffect, useRef } from "react";
import { isLight } from "@/core/color";
import { clamp } from "@/core/geometry";
import type { DesignElement, LineElement, Page, TextElement } from "@/core/types";
import { cssFontFamily, ensureFont } from "@/render/fonts";
import { renderPage } from "@/render/renderPage";
import { PreviewCanvas } from "./PreviewCanvas";

const THUMB = 28;

/** Properties that do not change how an element looks in its thumbnail. */
const NOT_VISUAL = new Set(["x", "y", "rotation", "id", "name", "locked", "hidden", "alt", "link"]);

function sameLook(a: DesignElement, b: DesignElement): boolean {
  if (a.type !== b.type) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of ka) if (!NOT_VISUAL.has(k) && ra[k] !== rb[k]) return false;
  return true;
}

/** Counts up only when the element's appearance changed, so dragging an element on the canvas does not repaint its thumbnail. */
function useVisualRevision(el: DesignElement): number {
  const ref = useRef({ el, rev: 0 });
  if (ref.current.el !== el) {
    if (!sameLook(ref.current.el, el)) ref.current.rev += 1;
    ref.current.el = el;
  }
  return ref.current.rev;
}

function TextThumb({ el }: { el: TextElement }) {
  useEffect(() => {
    void ensureFont(el.fontFamily, el.fontWeight, el.italic);
  }, [el.fontFamily, el.fontWeight, el.italic]);
  const color = el.gradient?.stops[0]?.color ?? el.color;
  return (
    <span
      className="cf-layer__thumb cf-layer__thumb--text"
      data-on={isLight(color) ? "dark" : "light"}
      style={{ color, fontFamily: cssFontFamily(el.fontFamily), fontStyle: el.italic ? "italic" : "normal", fontWeight: clamp(el.fontWeight, 400, 800) }}
    >
      Aa
    </span>
  );
}

function LineThumb({ el }: { el: LineElement }) {
  return (
    <span className="cf-layer__thumb">
      <span className="cf-layer__line" style={{ background: el.stroke.color, height: clamp(el.stroke.width / 2, 2, 6) }} />
    </span>
  );
}

function PaintedThumb({ el }: { el: DesignElement }) {
  const rev = useVisualRevision(el);
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => {
    const iw = Math.max(1, el.width);
    const ih = Math.max(1, el.height);
    const pw = w * dpr;
    const ph = h * dpr;
    const k = Math.min((pw - 2) / iw, (ph - 2) / ih);
    const ox = (pw - iw * k) / 2;
    const oy = (ph - ih * k) / 2;
    const probe = { ...el, x: 0, y: 0, rotation: 0, opacity: 1, hidden: false, shadow: null, blur: 0 } as DesignElement;
    const page: Page = { id: "thumb", background: { type: "solid", color: "#ffffff" }, elements: [probe] };
    return renderPage(ctx, { width: iw, height: ih }, page, { scale: k, clip: { x: -ox / k, y: -oy / k, w: pw / k, h: ph / k }, transparent: true });
  };
  return (
    <span className="cf-layer__thumb">
      <PreviewCanvas width={THUMB} height={THUMB} draw={draw} deps={[rev]} lazy />
    </span>
  );
}

/** A 28px picture of the element: real rendering for graphics, photos and shapes, an "Aa" tile for text. */
export function LayerThumb({ el }: { el: DesignElement }) {
  if (el.type === "text") return <TextThumb el={el} />;
  if (el.type === "line") return <LineThumb el={el} />;
  return <PaintedThumb el={el} />;
}
