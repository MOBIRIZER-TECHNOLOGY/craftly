import type { SVGProps } from "react";

/** Two chart-type icons the UI kit does not have (area and donut). Same 24px / 2px stroke style as the kit's icons. */
const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

export function IconChartArea(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 19V13l5-4 4 3 5-6 4 3v10z" fill="currentColor" fillOpacity={0.18} />
      <path d="M3 13l5-4 4 3 5-6 4 3" />
      <path d="M3 19h18" />
    </svg>
  );
}

export function IconChartDonut(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 8a4 4 0 1 0 4 4" />
      <path d="M15 3.6A9 9 0 0 1 20.4 9" />
    </svg>
  );
}
