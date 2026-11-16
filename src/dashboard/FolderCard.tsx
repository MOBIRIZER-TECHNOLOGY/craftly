import { memo, useId, useState, type DragEvent } from "react";
import { IconButton, IconFolder, IconMore, MenuPopover, cx, openContextMenu, type MenuEntry } from "@/ui";
import type { Folder } from "@/core/types";
import { DESIGN_DRAG_TYPE } from "./DesignCard";
import { m } from "@/i18n";
import { formatRelative } from "./format";
import { folderMenuItems } from "./menus";
import "./FolderCard.css";

export interface FolderCardProps {
  folder: Folder;
  /** designs inside */
  count: number;
  now: number;
  layout?: "grid" | "row";
  /** called when a design card is dropped on this folder */
  onDropDesign?: (designId: string) => void;
}

const NO_ITEMS: MenuEntry[] = [];

const carriesDesign = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(DESIGN_DRAG_TYPE);

/** A project folder: folder glyph, name, item count, "..." menu; designs can be dragged onto it. */
export const FolderCard = memo(function FolderCard({ folder, count, now, layout = "grid", onDropDesign }: FolderCardProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [over, setOver] = useState(false);
  const titleId = useId();
  const subId = useId();

  const items = () => folderMenuItems(folder, count);

  return (
    <article
      className={cx("cf-fcard", `cf-fcard--${layout}`, over && "is-drop-target", menuAnchor && "is-menu-open")}
      aria-labelledby={titleId}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({ x: event.clientX, y: event.clientY, items: items() });
      }}
      onDragEnter={(event) => {
        if (onDropDesign && carriesDesign(event)) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragOver={(event) => {
        if (onDropDesign && carriesDesign(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!onDropDesign || !carriesDesign(event)) return;
        event.preventDefault();
        setOver(false);
        const id = event.dataTransfer.getData(DESIGN_DRAG_TYPE);
        if (id) onDropDesign(id);
      }}
    >
      <span className="cf-fcard__icon" aria-hidden="true">
        <IconFolder />
      </span>
      <div className="cf-fcard__body">
        <a id={titleId} className="cf-fcard__title" href={`#/projects/${encodeURIComponent(folder.id)}`} draggable={false} aria-describedby={subId} title={folder.name}>
          {folder.name}
        </a>
        <p className="cf-fcard__sub" id={subId}>
          {m.dashboard.counts.designs(count)}
        </p>
      </div>
      <span className="cf-fcard__cell cf-fcard__type" aria-hidden="true">
        {m.dashboard.cards.folder}
      </span>
      <span className="cf-fcard__cell cf-fcard__time" aria-hidden="true">
        {formatRelative(folder.createdAt, now)}
      </span>
      <div className="cf-fcard__actions">
        <IconButton
          className="cf-fcard__more"
          size="sm"
          label={m.dashboard.shared.moreActions}
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
        items={menuAnchor ? items() : NO_ITEMS}
        placement="bottom-end"
        aria-label={m.dashboard.cards.actionsForFolder(folder.name)}
      />
    </article>
  );
});
