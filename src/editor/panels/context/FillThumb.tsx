import { useEffect, useRef, useState } from "react";
import type { Fill, Page } from "@/core/types";
import { getPhotoThumb } from "@/data/photos";
import { imageUrl } from "@/render/images";
import { renderPage } from "@/render/renderPage";
import { cssUrl, paintCss } from "./paintCss";
import { PreviewCanvas } from "./PreviewCanvas";

/** A picture of a background fill: CSS for colours and gradients, the real renderer for patterns, a small preview for photos. */
export function FillThumb({ fill }: { fill: Fill }) {
  if (fill.type === "solid" || fill.type === "linear" || fill.type === "radial") {
    return <span className="cf-fill" style={{ background: paintCss(fill) }} />;
  }
  if (fill.type === "pattern") return <PatternThumb fill={fill} />;
  return <PhotoThumb src={fill.src} />;
}

function PatternThumb({ fill }: { fill: Extract<Fill, { type: "pattern" }> }) {
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => {
    // show 150 design px across the tile: several repeats of the small patterns, a whole tile of the big ones
    const span = 150;
    const page: Page = { id: "bg-thumb", background: fill, elements: [] };
    renderPage(ctx, { width: span, height: (span * h) / w }, page, { scale: (w * dpr) / span });
  };
  return (
    <span className="cf-fill">
      <PreviewCanvas width={96} height={96} fluid lazy draw={draw} deps={[fill.pattern, fill.color, fill.background, fill.scale]} />
    </span>
  );
}

function PhotoThumb({ src }: { src: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const load = () => {
      const task = src.startsWith("builtin:") ? getPhotoThumb(src.slice(8), 240) : imageUrl(src);
      task.then((u) => live && setUrl(u)).catch(() => undefined);
    };
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        live = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: "160px" },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [src]);
  return <span ref={ref} className="cf-fill cf-fill--photo" style={url ? { backgroundImage: cssUrl(url) } : undefined} />;
}
