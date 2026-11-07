import { memo, useEffect, useId, useState } from "react";
import { Button, IconButton, IconMore, MenuPopover, Skeleton, cx, openContextMenu, type MenuEntry } from "@/ui";
import { getAssetUrl } from "@/core/assets";
import type { Asset } from "@/core/types";
import { createFromAsset } from "./actions";
import { formatBytes, formatRelative } from "./format";
import { assetMenuItems } from "./menus";
import "./ImageCard.css";

const NO_ITEMS: MenuEntry[] = [];

export interface ImageCardProps {
  asset: Asset;
  now: number;
  layout?: "grid" | "row";
}

/** "PNG image", "SVG image" ... from the mime type. */
const kindLabel = (mime: string): string => `${(mime.split("/")[1] ?? "image").replace(/\+.*$/, "").toUpperCase()} image`;

/** An uploaded image: preview on a checkerboard, name, size, "Use in new design" and a "..." menu. */
export const ImageCard = memo(function ImageCard({ asset, now, layout = "grid" }: ImageCardProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    let live = true;
    void getAssetUrl(asset.id).then((value) => {
      if (live) setUrl(value);
    });
    return () => {
      live = false;
    };
  }, [asset.id, asset.blob]);

  const sizeText = `${asset.width} × ${asset.height} px · ${formatBytes(asset.size)}`;

  return (
    <article
      className={cx("cf-icard", `cf-icard--${layout}`, menuAnchor && "is-menu-open")}
      aria-labelledby={titleId}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({ x: event.clientX, y: event.clientY, items: assetMenuItems(asset) });
      }}
    >
      <div className="cf-icard__stage">
        {url ? <img className="cf-icard__img" src={url} alt="" loading="lazy" decoding="async" draggable={false} /> : <Skeleton width="100%" height="100%" radius={0} />}
        <div className="cf-icard__use">
          <Button size="sm" variant="secondary" onClick={() => void createFromAsset(asset)}>
            Use in new design
          </Button>
        </div>
      </div>
      <div className="cf-icard__body">
        <p id={titleId} className="cf-icard__title" title={asset.name}>
          {asset.name}
        </p>
        <p className="cf-icard__sub">{sizeText}</p>
      </div>
      <span className="cf-icard__cell" aria-hidden="true">
        {kindLabel(asset.mime)}
      </span>
      <span className="cf-icard__cell" aria-hidden="true">
        {formatRelative(asset.createdAt, now)}
      </span>
      <div className="cf-icard__actions">
        <IconButton
          className="cf-icard__more"
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
        items={menuAnchor ? assetMenuItems(asset) : NO_ITEMS}
        placement="bottom-end"
        aria-label={`Actions for ${asset.name}`}
      />
    </article>
  );
});
