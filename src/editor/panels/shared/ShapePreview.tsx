import { getShape, shapeFillRule, shapePathData, type ShapeParams } from "@/render/shapePaths";

export interface ShapePreviewProps {
  /** id of a shape in the shape catalogue */
  kind: string;
  /** edge of the square drawing area in px */
  box?: number;
  /** override the shape's natural width / height */
  aspect?: number;
  /** corner radius as a fraction of the shorter side (rect-like shapes) */
  radiusRatio?: number;
  params?: ShapeParams;
  /** draw an outline instead of a fill */
  outline?: boolean;
  className?: string;
}

/** The real geometry of a catalogue shape drawn as a `currentColor` SVG that fits a square box. */
export function ShapePreview({ kind, box = 40, aspect, radiusRatio = 0, params, outline = false, className }: ShapePreviewProps) {
  const a = aspect ?? getShape(kind)?.aspect ?? 1;
  const pad = outline ? 2 : 1;
  const inner = box - pad * 2;
  const w = a >= 1 ? inner : inner * a;
  const h = a >= 1 ? inner / a : inner;
  const d = shapePathData(kind, w, h, { radius: Math.min(w, h) * radiusRatio, params });
  return (
    <svg className={className} viewBox={`0 0 ${box} ${box}`} width={box} height={box} aria-hidden="true">
      <path
        d={d}
        transform={`translate(${(box - w) / 2} ${(box - h) / 2})`}
        fill={outline ? "none" : "currentColor"}
        stroke={outline ? "currentColor" : undefined}
        strokeWidth={outline ? 1.6 : undefined}
        strokeLinejoin="round"
        fillRule={shapeFillRule(kind)}
      />
    </svg>
  );
}
