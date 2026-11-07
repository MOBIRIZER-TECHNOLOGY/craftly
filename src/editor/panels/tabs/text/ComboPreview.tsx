import { memo, useMemo } from "react";
import { PageThumb } from "@/components/PageThumb";
import { createPage, solid } from "@/core/factory";
import { boundsOfElements } from "@/core/geometry";
import { scaleElement } from "@/core/ops";
import type { Page } from "@/core/types";
import type { TextCombo } from "@/data/textCombos";

/** Design the preview pages pretend to be (a landscape card). */
export const PREVIEW_DESIGN = { width: 1000, height: 680 };

/**
 * A throw-away page showing a font combination: the real text boxes it would insert, scaled to fill the card and
 * centred. It is rendered by the real renderer (`PageThumb`), so fonts, case, tracking and effects are faithful.
 */
export function buildComboPage(combo: TextCombo): Page {
  const els = combo.build({ width: 1000, height: 1000 });
  const b = boundsOfElements(els);
  if (b && b.w > 0 && b.h > 0) {
    const s = Math.min((PREVIEW_DESIGN.width * 0.86) / b.w, (PREVIEW_DESIGN.height * 0.8) / b.h, 1.4);
    for (const el of els) {
      scaleElement(el, s, s);
    }
    const nb = boundsOfElements(els);
    if (nb) {
      const dx = PREVIEW_DESIGN.width / 2 - (nb.x + nb.w / 2);
      const dy = PREVIEW_DESIGN.height / 2 - (nb.y + nb.h / 2);
      for (const el of els) {
        el.x += dx;
        el.y += dy;
      }
    }
  }
  return createPage({ background: solid("#fbfbfd"), elements: els });
}

export const ComboPreview = memo(function ComboPreview({ combo, width }: { combo: TextCombo; width: number }) {
  const page = useMemo(() => buildComboPage(combo), [combo]);
  return <PageThumb design={PREVIEW_DESIGN} page={page} width={width} placeholder="var(--c-bg-subtle)" />;
});
