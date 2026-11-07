import { memo, useState } from "react";
import { Button, IconButton, IconEye, IconMore, IconStar, MenuPopover, cx, openContextMenu, type MenuEntry } from "@/ui";
import type { Template } from "@/core/types";
import { TemplateThumb } from "@/components/PageThumb";
import { toggleFavouriteTemplate, useFavouriteTemplates } from "./data";
import { templateMenuItems } from "./menus";
import { openTemplatePreview } from "./templatePreview";
import "./TemplateCard.css";

const NO_ITEMS: MenuEntry[] = [];

export interface TemplateCardProps {
  template: Template;
  /** card width in px */
  width?: number;
  /** alternatively a height; the width then follows the template's aspect ratio (clamped) */
  height?: number;
  /** show the template name under the thumbnail */
  showName?: boolean;
}

export const templateWidthFor = (template: Template, height: number): number => {
  const aspect = template.width / Math.max(1, template.height);
  return Math.max(110, Math.min(340, Math.round(height * aspect)));
};

/**
 * A template thumbnail (real renderer). Hover or focus reveals Preview, Star (favourite) and a "..." menu;
 * clicking the picture opens the preview modal.
 */
export const TemplateCard = memo(function TemplateCard({ template, width, height = 190, showName = false }: TemplateCardProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const favourites = useFavouriteTemplates();
  const isFavourite = favourites.has(template.id);
  const cardWidth = Math.round(width ?? templateWidthFor(template, height));

  return (
    <article
      className={cx("cf-tcard", menuAnchor && "is-menu-open", isFavourite && "is-favourite")}
      style={{ width: cardWidth }}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({ x: event.clientX, y: event.clientY, items: templateMenuItems(template, isFavourite) });
      }}
    >
      <button type="button" className="cf-tcard__open" onClick={() => openTemplatePreview(template)} aria-label={`Preview template ${template.name}`}>
        <TemplateThumb template={template} width={cardWidth} className="cf-tcard__thumb" />
      </button>

      <div className="cf-tcard__actions">
        <Button className="cf-tcard__preview" size="sm" variant="secondary" icon={<IconEye aria-hidden="true" />} onClick={() => openTemplatePreview(template)}>
          Preview
        </Button>
        <span className="cf-tcard__tools">
          <IconButton
            className="cf-tcard__star"
            size="sm"
            label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            active={isFavourite}
            icon={<IconStar aria-hidden="true" />}
            onClick={() => void toggleFavouriteTemplate(template.id, template.name)}
          />
          <IconButton
            className="cf-tcard__more"
            size="sm"
            label="More actions"
            icon={<IconMore aria-hidden="true" />}
            aria-haspopup="menu"
            aria-expanded={menuAnchor !== null}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          />
        </span>
      </div>

      {showName ? <p className="cf-tcard__name">{template.name}</p> : null}

      <MenuPopover
        open={menuAnchor !== null}
        anchor={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        items={menuAnchor ? templateMenuItems(template, isFavourite) : NO_ITEMS}
        placement="bottom-end"
        aria-label={`Actions for template ${template.name}`}
      />
    </article>
  );
});
