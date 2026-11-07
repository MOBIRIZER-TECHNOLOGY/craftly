import { memo, useEffect, useRef, useState } from "react";
import type { Design, Page, Template } from "@/core/types";
import { onFontsChange } from "@/render/fonts";
import { renderPageToCanvas } from "@/render/renderPage";

/**
 * Renders a page through the real renderer into a small <canvas>.
 * Painting is lazy (only when scrolled into view) and re-runs when the page
 * object changes or a font finishes loading. Page objects are immutable, so a
 * repaint only happens for pages that actually changed.
 */
export interface PageThumbProps {
  design: Pick<Design, "width" | "height">;
  page: Page;
  /** CSS width in px; height follows the design aspect ratio */
  width: number;
  className?: string;
  /** render at devicePixelRatio (default true) */
  sharp?: boolean;
  /** background shown while rendering */
  placeholder?: string;
}

const MAX_PX = 900;

export const PageThumb = memo(function PageThumb({ design, page, width, className, sharp = true, placeholder = "#eceef3" }: PageThumbProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const height = Math.round((width * design.height) / design.width);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => onFontsChange(() => setEpoch((n) => n + 1)), []);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const px = Math.min(MAX_PX, Math.round(width * (sharp ? Math.min(2, window.devicePixelRatio || 1) : 1)));
    renderPageToCanvas(design, page, { width: px }).then(
      (c) => {
        const target = canvasRef.current;
        if (!live || !target) return;
        target.width = c.width;
        target.height = c.height;
        target.getContext("2d")?.drawImage(c, 0, 0);
      },
      () => {
        /* a page that cannot be drawn keeps the placeholder colour */
      },
    );
    return () => {
      live = false;
    };
  }, [visible, design.width, design.height, page, width, sharp, epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={hostRef} className={className} style={{ width, height, background: placeholder, position: "relative", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
});

/** First page of a template. */
export function TemplateThumb({ template, width, className }: { template: Template; width: number; className?: string }) {
  return <PageThumb design={template} page={template.pages[0]} width={width} className={className} placeholder={template.accent} />;
}
