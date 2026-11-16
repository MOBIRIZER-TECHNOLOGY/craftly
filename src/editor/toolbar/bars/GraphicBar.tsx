/** Contextual toolbar of graphics (SVG illustrations, icons, stickers, QR codes). */
import { extractSvgColors } from "@/core/svg";
import { useEditor } from "@/core/store";
import type { GraphicElement } from "@/core/types";
import { m } from "@/i18n";
import { Divider } from "@/ui";
import { AnimateButton, CopyStyleButton, EffectsButton, FlipMenu, MoreButton, MultiActions, PositionButton, Swatch, TransparencyButton, type BarProps } from "../common";
import { IconStrokeWeight } from "../icons";
import { PopoverButton, SliderField, TBIcon, toggleContext } from "../kit";
import { editElements, only, uniform } from "../selection";

type Extra = { copyEnabled: boolean };

const MAX_SWATCHES = 6;

/** Outline icons (lucide style) draw with `stroke="currentColor"` on the root element. */
function rootStrokeWidth(svg: string): number | null {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  if (!/\sstroke\s*=\s*["'](?!none)/i.test(root)) return null;
  const w = root.match(/\sstroke-width\s*=\s*["']([\d.]+)["']/i);
  return w ? parseFloat(w[1]) : 2;
}

const isStrokeBased = (el: GraphicElement) => el.strokeWidth !== undefined || rootStrokeWidth(el.svg) !== null;
const currentStrokeWidth = (el: GraphicElement) => el.strokeWidth ?? rootStrokeWidth(el.svg) ?? 2;

export function GraphicBar({ els, ids, copyEnabled }: BarProps<GraphicElement> & Extra) {
  const single = els.length === 1 ? els[0] : null;
  const keys = single ? extractSvgColors(single.svg).slice(0, MAX_SWATCHES) : [];
  const openKey = useEditor((s) => (s.context?.kind === "color" && s.context.target === "graphic" ? (s.context.key ?? "") : null));
  const stroked = els.every(isStrokeBased);
  const strokeWidth = uniform(els, (e) => Math.round(currentStrokeWidth(e) * 10) / 10);

  return (
    <>
      {single &&
        keys.map((key, i) => {
          const shown = single.colors[key] ?? (key === "currentColor" ? "var(--c-ink)" : key);
          return (
            <TBIcon
              key={key}
              label={m.editor.graphicBar.colorN(i + 1)}
              tip={keys.length > 1 ? m.editor.graphicBar.colorNOf(i + 1, keys.length) : m.editor.toolbar.color}
              icon={<Swatch large css={shown} />}
              active={openKey === key}
              onClick={() => toggleContext({ kind: "color", target: "graphic", key })}
            />
          );
        })}

      {stroked && (
        <PopoverButton label={m.editor.graphicBar.strokeWidth} tip={m.editor.graphicBar.strokeWidth} icon={<IconStrokeWeight />} panelClass="cf-tbpop--narrow">
          {() => (
            <SliderField
              label={m.editor.graphicBar.strokeWidth}
              value={strokeWidth.value ?? 2}
              mixed={strokeWidth.mixed}
              min={0.5}
              max={4}
              step={0.1}
              onChange={(v) =>
                editElements(
                  ids,
                  only("graphic", (g) => {
                    g.strokeWidth = Math.round(v * 10) / 10;
                  }),
                  "strokeWidth",
                )
              }
            />
          )}
        </PopoverButton>
      )}

      <FlipMenu />
      <TransparencyButton els={els} ids={ids} />
      <EffectsButton />
      <AnimateButton />
      <PositionButton />
      {ids.length > 1 && <MultiActions ids={ids} />}
      <Divider vertical className="cf-tb__div" />
      <CopyStyleButton els={els} enabled={copyEnabled} />
      <MoreButton />
    </>
  );
}
