/**
 * Small inline icons the toolbars need that the UI kit (lucide) does not offer:
 * arrowhead previews, border styles, the transparency checkerboard ...
 * They follow `currentColor` and are sized by the surrounding button / menu CSS.
 */
import type { ReactNode, SVGProps } from "react";
import type { ArrowKind, StrokeStyle } from "@/core/types";

type IconProps = SVGProps<SVGSVGElement>;

const BASE: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

/** Checkerboard in a rounded frame - the transparency control. */
export function IconChecker(props: IconProps) {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) cells.push([c, r]);
  return (
    <svg {...BASE} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" strokeWidth="1.6" />
      <g fill="currentColor" stroke="none">
        {cells.map(([c, r]) => (
          <rect key={`${c}${r}`} x={4.8 + c * 3.6} y={4.8 + r * 3.6} width="3.6" height="3.6" />
        ))}
      </g>
    </svg>
  );
}

/** A bold outlined square - the "Border" control. */
export function IconBorderBox(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3" strokeWidth="2.6" />
    </svg>
  );
}

/** Three lines of growing weight - the "Weight" control. */
export function IconStrokeWeight(props: IconProps) {
  return (
    <svg {...BASE} strokeLinecap="butt" {...props}>
      <path d="M3.5 6.2h17" strokeWidth="1.2" />
      <path d="M3.5 12h17" strokeWidth="2.4" />
      <path d="M3.5 18.3h17" strokeWidth="3.8" />
    </svg>
  );
}

/** Border / line style glyphs: none, solid, dashed, dotted. */
export function IconStrokeStyle({ kind, ...props }: IconProps & { kind: "none" | StrokeStyle }) {
  if (kind === "none") {
    return (
      <svg {...BASE} {...props}>
        <circle cx="12" cy="12" r="8" strokeWidth="1.8" />
        <path d="M6.4 17.6 17.6 6.4" strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === "dashed") {
    return (
      <svg {...BASE} strokeLinecap="butt" {...props}>
        <path d="M2.5 12h4.6M9.7 12h4.6M16.9 12h4.6" strokeWidth="3" />
      </svg>
    );
  }
  if (kind === "dotted") {
    return (
      <svg {...BASE} {...props}>
        <path d="M4 12h.01M8.7 12h.01M13.4 12h.01M18.1 12h.01" strokeWidth="3.4" />
      </svg>
    );
  }
  return (
    <svg {...BASE} strokeLinecap="butt" {...props}>
      <path d="M2.5 12h19" strokeWidth="3" />
    </svg>
  );
}

/** Person-in-circle: alternative text. */
export function IconAccessibility(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="9.5" strokeWidth="1.8" />
      <circle cx="12" cy="7.6" r="1.15" fill="currentColor" stroke="none" />
      <path d="M7.4 10.4 12 11.2l4.6-.8M12 11.2v3.1M9.7 18l2.3-3.7 2.3 3.7" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * A short horizontal line with an arrowhead, mirroring how the canvas draws `ArrowKind`
 * (see renderPage.arrowHead). `end` picks which side carries the head.
 */
export function ArrowheadPreview({ kind, end = "end", ...props }: IconProps & { kind: ArrowKind; end?: "start" | "end" }) {
  // Drawn for the end of a line pointing right: shaft from x=2, head with its tip at x=21.5.
  let shaftEnd = 21.5;
  let head: ReactNode = null;
  switch (kind) {
    case "arrow":
    case "triangle":
      shaftEnd = 15.5;
      head = <path d="M21.5 12 14.6 7.9v8.2z" fill="currentColor" strokeWidth="1.2" />;
      break;
    case "open-arrow":
      shaftEnd = 21;
      head = <path d="M15 7 21 12 15 17" />;
      break;
    case "circle":
      shaftEnd = 16;
      head = <circle cx="18.6" cy="12" r="3" fill="currentColor" strokeWidth="1" />;
      break;
    case "square":
      shaftEnd = 15.4;
      head = <rect x="15.6" y="8.8" width="6.2" height="6.4" fill="currentColor" strokeWidth="1" />;
      break;
    case "diamond":
      shaftEnd = 15.3;
      head = <path d="M21.6 12 18.1 8.4 14.6 12l3.5 3.6z" fill="currentColor" strokeWidth="1" />;
      break;
    case "bar":
      shaftEnd = 21;
      head = <path d="M21 7v10" />;
      break;
    default:
      break;
  }
  return (
    <svg {...BASE} {...props}>
      <g transform={end === "start" ? "translate(24 0) scale(-1 1)" : undefined}>
        <path d={`M2.5 12H${shaftEnd}`} />
        {head}
      </g>
    </svg>
  );
}
