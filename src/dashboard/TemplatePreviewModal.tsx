import { useRef, useState } from "react";
import { Badge, Button, IconPen, IconStar, Modal, cx, useResizeObserver } from "@/ui";
import type { Template } from "@/core/types";
import { PageThumb } from "@/components/PageThumb";
import { describeSize, getDesignType } from "@/data/designTypes";
import { TEMPLATE_CATEGORY_LABELS } from "@/data/templates";
import { createFromTemplate } from "./actions";
import { toggleFavouriteTemplate, useFavouriteTemplates } from "./data";
import { plural } from "./format";
import { closeTemplatePreview, usePreviewTemplate } from "./templatePreview";
import "./TemplatePreviewModal.css";

/** The modal that previews a template (all pages) and starts a design from it. Mounted once by the Dashboard. */
export function TemplatePreviewHost() {
  const template = usePreviewTemplate();
  // keep the last template rendered while the modal plays its exit animation
  const shown = useRef<Template | null>(null);
  if (template) shown.current = template;
  const view = shown.current;
  return (
    <Modal
      open={template !== null}
      onClose={closeTemplatePreview}
      size="xl"
      flush
      className="cf-tpreview-modal"
      aria-label={view ? `Template preview: ${view.name}` : "Template preview"}
    >
      {view ? <PreviewBody key={view.id} template={view} /> : null}
    </Modal>
  );
}

function PreviewBody({ template }: { template: Template }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(560);
  const favourites = useFavouriteTemplates();
  const isFavourite = favourites.has(template.id);

  useResizeObserver(stageRef, (entry) => setStageWidth(entry.contentRect.width));

  const type = getDesignType(template.typeId);
  const aspect = template.width / Math.max(1, template.height);
  const maxHeight = Math.max(260, Math.round(window.innerHeight * 0.56));
  const previewWidth = Math.max(160, Math.floor(Math.min(560, stageWidth, maxHeight * aspect)));
  const thumbWidth = Math.max(44, Math.min(104, Math.round(60 * aspect)));
  const page = template.pages[Math.min(pageIndex, template.pages.length - 1)];

  const customize = async () => {
    setBusy(true);
    await createFromTemplate(template);
    setBusy(false);
  };

  return (
    <div className="cf-tpreview">
      <div className="cf-tpreview__stage" ref={stageRef}>
        <div className="cf-tpreview__page" style={{ width: previewWidth }}>
          <PageThumb key={`${template.id}:${page.id}`} design={template} page={page} width={previewWidth} className="cf-tpreview__canvas" placeholder={template.accent} />
        </div>
        {template.pages.length > 1 ? (
          <div
            className="cf-tpreview__strip"
            role="group"
            aria-label="Pages"
            onKeyDown={(event) => {
              const last = template.pages.length - 1;
              const next =
                event.key === "ArrowRight"
                  ? Math.min(last, pageIndex + 1)
                  : event.key === "ArrowLeft"
                    ? Math.max(0, pageIndex - 1)
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? last
                        : null;
              if (next === null) return;
              event.preventDefault();
              const strip = event.currentTarget;
              setPageIndex(next);
              requestAnimationFrame(() => strip.querySelectorAll<HTMLElement>(".cf-tpreview__thumb")[next]?.focus());
            }}
          >
            {template.pages.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={cx("cf-tpreview__thumb", index === pageIndex && "is-active")}
                aria-label={`Page ${index + 1} of ${template.pages.length}`}
                aria-current={index === pageIndex ? "true" : undefined}
                onClick={() => setPageIndex(index)}
              >
                <PageThumb design={template} page={item} width={thumbWidth} sharp={false} placeholder={template.accent} />
                <span className="cf-tpreview__num" aria-hidden="true">
                  {index + 1}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="cf-tpreview__info">
        <p className="cf-tpreview__kicker">Template</p>
        <h2 className="cf-tpreview__name">{template.name}</h2>
        <dl className="cf-tpreview__facts">
          <div>
            <dt>Category</dt>
            <dd>{TEMPLATE_CATEGORY_LABELS[template.category] ?? template.category}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{describeSize(template.width, template.height, type?.unit ?? "px")}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{plural(template.pages.length, "page")}</dd>
          </div>
        </dl>
        {template.tags.length > 0 ? (
          <ul className="cf-tpreview__tags" aria-label="Tags">
            {template.tags.slice(0, 10).map((tag) => (
              <li key={tag}>
                <Badge>{tag}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="cf-tpreview__actions">
          <Button variant="primary" size="lg" block loading={busy} icon={<IconPen aria-hidden="true" />} onClick={() => void customize()} data-autofocus="">
            Customize this template
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            icon={<IconStar aria-hidden="true" className={isFavourite ? "cf-tpreview__star is-on" : "cf-tpreview__star"} />}
            aria-pressed={isFavourite}
            onClick={() => void toggleFavouriteTemplate(template.id, template.name)}
          >
            {isFavourite ? "In your favourites" : "Add to favourites"}
          </Button>
        </div>
        <p className="cf-tpreview__note">Customizing makes a copy in your projects. The original template stays as it is.</p>
      </div>
    </div>
  );
}
