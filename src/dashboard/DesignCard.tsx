import { memo, useId, useState, type DragEvent } from "react";
import { IconButton, IconMore, IconStar, MenuPopover, Skeleton, cx, openContextMenu, type MenuEntry } from "@/ui";
import type { DesignSummary, Folder } from "@/core/types";
import { designPath } from "@/router";
import { toggleStarAction } from "./actions";
import { DesignMock, mockForDesign } from "./DesignMock";
import { formatEdited, formatRelative } from "./format";
import { shortTypeName } from "./labels";
import { designMenuItems } from "./menus";
import "./DesignCard.css";

const NO_ITEMS: MenuEntry[] = [];

/** Drag payload type for moving a design onto a folder. */
export const DESIGN_DRAG_TYPE = "application/x-craftly-design";

export interface DesignCardProps {
  design: DesignSummary;
  folders: Folder[];
  now: number;
  /** carousel: fixed width (Home); grid: fills its cell; row: a list row */
  layout?: "carousel" | "grid" | "row";
  /** allow dragging the card onto a folder */
  draggable?: boolean;
}

/**
 * A saved design: real thumbnail (placeholder when there is none yet), title, "Type - Edited 2h ago", a star
 * and a "..." menu. The whole card is one link (the title, stretched); the menu is also on right-click.
 */
export const DesignCard = memo(function DesignCard({ design, folders, now, layout = "grid", draggable = false }: DesignCardProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const subId = useId();
  const typeName = shortTypeName(design.typeId);

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData(DESIGN_DRAG_TYPE, design.id);
    event.dataTransfer.setData("text/plain", design.title);
    event.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };

  return (
    <article
      className={cx("cf-dcard", `cf-dcard--${layout}`, dragging && "is-dragging", menuAnchor && "is-menu-open", design.starred && "is-starred")}
      aria-labelledby={titleId}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? () => setDragging(false) : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({ x: event.clientX, y: event.clientY, items: designMenuItems(design, folders) });
      }}
    >
      <div className="cf-dcard__stage">
        {design.thumbnail ? (
          <img className="cf-dcard__img" src={design.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <DesignMock spec={mockForDesign(design)} height={150} className="cf-dcard__mock" />
        )}
      </div>

      <div className="cf-dcard__body">
        <a id={titleId} className="cf-dcard__title" href={`#${designPath(design.id)}`} draggable={false} aria-describedby={subId} title={design.title}>
          {design.title}
        </a>
        <p className="cf-dcard__sub" id={subId}>
          <span>{typeName}</span>
          <span className="cf-dcard__dot" aria-hidden="true">
            {" · "}
          </span>
          <span className="cf-dcard__edited">{formatEdited(design.updatedAt, now)}</span>
        </p>
      </div>

      <span className="cf-dcard__cell cf-dcard__type" aria-hidden="true">
        {typeName}
      </span>
      <span className="cf-dcard__cell cf-dcard__time" aria-hidden="true">
        {formatRelative(design.updatedAt, now)}
      </span>

      <div className="cf-dcard__actions">
        <IconButton
          className="cf-dcard__star"
          size="sm"
          label="Star"
          active={design.starred}
          icon={<IconStar aria-hidden="true" />}
          onClick={() => void toggleStarAction(design)}
        />
        <IconButton
          className="cf-dcard__more"
          size="sm"
          label="More actions"
          icon={<IconMore aria-hidden="true" />}
          aria-haspopup="menu"
          aria-expanded={menuAnchor !== null}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
        />
      </div>

      <MenuPopover
        open={menuAnchor !== null}
        anchor={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        items={menuAnchor ? designMenuItems(design, folders) : NO_ITEMS}
        placement="bottom-end"
        aria-label={`Actions for ${design.title}`}
      />
    </article>
  );
});

/** Shimmering stand-in shown while the library loads. */
export function DesignCardSkeleton({ layout = "grid" }: { layout?: "carousel" | "grid" }) {
  return (
    <div className={cx("cf-dcard-skeleton", layout === "carousel" && "cf-dcard-skeleton--carousel")} aria-hidden="true">
      <Skeleton height="auto" radius={12} className="cf-dcard-skeleton__stage" />
      <Skeleton width="70%" height={14} />
      <Skeleton width="45%" height={12} />
    </div>
  );
}
