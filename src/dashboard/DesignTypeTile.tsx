import { m } from "@/i18n";
import { cx } from "@/ui";
import { describeSize, type DesignType } from "@/data/designTypes";
import { DesignMock, mockForType, type MockSpec } from "./DesignMock";
import "./DesignTypeTile.css";

interface DesignTypeTileProps {
  type: DesignType;
  /** stage height: sm 96, md 124 (Create dialog), lg 148 (Popular on Craftly) */
  size?: "sm" | "md" | "lg";
  onClick: () => void;
  className?: string;
}

const STAGE_HEIGHT = { sm: 96, md: 124, lg: 148 } as const;

/** An illustrated design-type tile: the mock page, the name and the size caption. Clicking creates the design. */
export function DesignTypeTile({ type, size = "md", onClick, className }: DesignTypeTileProps) {
  const sizeText = describeSize(type.width, type.height, type.unit);
  return (
    <button type="button" className={cx("cf-tile", `cf-tile--${size}`, className)} onClick={onClick} aria-label={`${type.name}, ${sizeText}`}>
      <DesignMock spec={mockForType(type)} height={STAGE_HEIGHT[size]} className="cf-tile__art" />
      <span className="cf-tile__name">{type.name}</span>
      <span className="cf-tile__size">{sizeText}</span>
    </button>
  );
}

interface CustomSizeTileProps {
  width: number;
  height: number;
  onClick: () => void;
  size?: "sm" | "md" | "lg";
  spec: MockSpec;
}

/** Tile for a size typed into a search box ("1200 x 628"). */
export function CustomSizeTile({ width, height, onClick, size = "md", spec }: CustomSizeTileProps) {
  const sizeText = m.dashboard.shared.pxSize(width, height);
  return (
    <button type="button" className={cx("cf-tile", `cf-tile--${size}`)} onClick={onClick} aria-label={m.dashboard.create.customSizeTile(sizeText)}>
      <DesignMock spec={spec} height={STAGE_HEIGHT[size]} className="cf-tile__art" />
      <span className="cf-tile__name">{m.dashboard.shared.customSize}</span>
      <span className="cf-tile__size">{sizeText}</span>
    </button>
  );
}
