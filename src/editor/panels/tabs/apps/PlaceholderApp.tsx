import { useMemo, useState } from "react";
import { darken, isLight, lighten } from "@/core/color";
import { createImage } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { svgToDataUrl } from "@/core/svg";
import { m } from "@/i18n";
import { Button, ColorSwatch, IconPlus, NumberField, cx } from "@/ui";
import { AppField, AppPage, ColorButton } from "./appKit";
import "./PlaceholderApp.css";

const SIZES = [
  { id: "square", label: m.panelsTabs.placeholder.square, w: 1000, h: 1000 },
  { id: "landscape", label: "4 : 3", w: 1200, h: 900 },
  { id: "wide", label: "16 : 9", w: 1280, h: 720 },
  { id: "portrait", label: "4 : 5", w: 960, h: 1200 },
  { id: "story", label: "9 : 16", w: 720, h: 1280 },
];

const COLORS = ["#e7e9ef", "#dbe4ff", "#ffe3e3", "#d3f9d8", "#fff3bf", "#e5dbff", "#c5f6fa", "#ffd8a8"];

const MIN = 16;
const MAX = 8000;

/** A flat coloured picture stand-in with crossed corners, a picture glyph and its own size as a label. */
export function placeholderSvg(w: number, h: number, color: string): string {
  const ink = isLight(color) ? darken(color, 0.42) : lighten(color, 0.55);
  const unit = Math.min(w, h);
  const icon = unit * 0.2;
  const fs = Math.max(10, unit * 0.07);
  const stroke = Math.max(1, unit * 0.004);
  const cx = w / 2;
  const top = h / 2 - icon * 0.75;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${color}"/>` +
    `<path d="M0 0L${w} ${h}M${w} 0L0 ${h}" stroke="${ink}" stroke-opacity="0.18" stroke-width="${stroke}" fill="none"/>` +
    `<g transform="translate(${cx - icon / 2} ${top}) scale(${icon / 26})" fill="${ink}" fill-opacity="0.6"><path d="M4 18 L9 11 L13 16 L16 12 L22 18 Z M17 7 A2 2 0 1 1 16.99 7 Z"/></g>` +
    `<text x="${cx}" y="${top + icon + fs * 1.5}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-weight="600" font-size="${fs}" fill="${ink}" fill-opacity="0.75">${Math.round(w)} × ${Math.round(h)}</text>` +
    `</svg>`
  );
}

/**
 * Placeholder image: pick a shape and a colour and add a stand-in picture to the layout. It behaves like a frame:
 * drop a photo on it later to replace it.
 */
export function PlaceholderApp() {
  const [w, setW] = useState(1200);
  const [h, setH] = useState(900);
  const [color, setColor] = useState(COLORS[0]);

  const svg = useMemo(() => placeholderSvg(w, h, color), [w, h, color]);
  const clamp = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)));

  const add = () => {
    const d = useEditor.getState().design;
    if (!d) return;
    // about half the page's shorter side along the longer edge of the placeholder
    const scale = (Math.min(d.width, d.height) * 0.5) / Math.max(w, h);
    getActions().addElement(
      createImage({
        src: svgToDataUrl(svg),
        naturalWidth: w,
        naturalHeight: h,
        width: Math.round(w * scale),
        height: Math.round(h * scale),
        isFrame: true,
        name: "Placeholder image",
      }),
    );
  };

  const ratio = w / h;
  const stage = ratio >= 1 ? { width: 236, height: 236 / ratio } : { width: 168 * ratio, height: 168 };

  return (
    <AppPage
      title={m.panelsTabs.placeholder.title}
      subtitle={m.panelsTabs.placeholder.subtitle}
      footer={
        <Button variant="primary" size="lg" block icon={<IconPlus />} onClick={add}>
          {m.panelsTabs.shared.addToDesign}
        </Button>
      }
    >
      <div className="cf-app__stage cf-ph__stage">
        <img className="cf-ph__img" src={svgToDataUrl(svg)} alt={m.panelsTabs.placeholder.alt(w, h)} style={{ width: stage.width, height: Math.max(40, stage.height) }} />
      </div>

      <AppField label={m.panelsTabs.placeholder.shape}>
        <div className="cf-ph__sizes" role="group" aria-label={m.panelsTabs.placeholder.shape}>
          {SIZES.map((s) => {
            const selected = s.w === w && s.h === h;
            const r = s.w / s.h;
            return (
              <button
                key={s.id}
                type="button"
                className={cx("cf-ph__size", selected && "is-selected")}
                aria-pressed={selected}
                onClick={() => {
                  setW(s.w);
                  setH(s.h);
                }}
              >
                <span className="cf-ph__glyph" style={{ width: r >= 1 ? 30 : 30 * r, height: r >= 1 ? 30 / r : 30 }} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      </AppField>

      <AppField label={m.panelsTabs.placeholder.sizeInPixels}>
        <div className="cf-app__row cf-ph__dims">
          <NumberField label={m.panelsTabs.placeholder.width} value={w} onChange={(v) => setW(clamp(v))} min={MIN} max={MAX} step={10} precision={0} />
          <NumberField label={m.panelsTabs.placeholder.height} value={h} onChange={(v) => setH(clamp(v))} min={MIN} max={MAX} step={10} precision={0} />
        </div>
      </AppField>

      <AppField label={m.panelsTabs.placeholder.colour}>
        <div className="cf-ph__colors" role="group" aria-label={m.panelsTabs.placeholder.placeholderColour}>
          {COLORS.map((c) => (
            <ColorSwatch key={c} color={c} size={28} selected={c === color} title={c} onClick={() => setColor(c)} />
          ))}
        </div>
        <ColorButton label={m.panelsTabs.placeholder.placeholderColour} value={color} onChange={setColor} />
      </AppField>
    </AppPage>
  );
}
