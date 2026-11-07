import type { CSSProperties } from "react";
import { cx, type LucideIcon } from "@/ui";
import { getDesignType, type DesignType } from "@/data/designTypes";
import { genericDesignIcon, typeIcon } from "./designIcons";
import "./DesignMock.css";

/** What a mock needs to draw itself: the page shape, an accent colour (any CSS colour) and a glyph. */
export interface MockSpec {
  width: number;
  height: number;
  color: string;
  icon: LucideIcon;
}

export const mockForType = (type: DesignType): MockSpec => ({ width: type.width, height: type.height, color: type.color, icon: typeIcon(type) });

/** Mock for a saved design: its catalogue type when known, otherwise a neutral purple page of the same shape. */
export function mockForDesign(design: { typeId: string; width: number; height: number }): MockSpec {
  const type = getDesignType(design.typeId);
  if (type) return { width: design.width, height: design.height, color: type.color, icon: typeIcon(type) };
  return { width: design.width, height: design.height, color: "var(--c-primary)", icon: genericDesignIcon };
}

interface DesignMockProps {
  spec: MockSpec;
  /** height of the tinted stage in px (default 128) */
  height?: number;
  className?: string;
}

/**
 * A small illustrated page in the design's accent colour and aspect ratio on a tinted stage:
 * the tile art of the Create dialog, the Popular tiles and the placeholder for designs without a thumbnail.
 */
export function DesignMock({ spec, height, className }: DesignMockProps) {
  const ratio = spec.width > 0 && spec.height > 0 ? spec.width / spec.height : 1;
  const Icon = spec.icon;
  const style = {
    "--cf-mock-color": spec.color,
    "--cf-mock-ratio": ratio.toFixed(4),
    "--cf-mock-aspect": `${Math.round(spec.width)} / ${Math.round(spec.height)}`,
    ...(height ? { "--cf-mock-h": `${height}px` } : null),
  } as CSSProperties;
  return (
    <span className={cx("cf-mock", ratio > 2.2 && "cf-mock--wide", className)} style={style} aria-hidden="true">
      <span className="cf-mock__page">
        <Icon strokeWidth={2} />
      </span>
    </span>
  );
}
