import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { hsvToRgb, parseColor, rgbToHsv, toHex, type RGBA } from "@/core/color";
import "./ColorPicker.css";
import { ColorSwatch } from "./ColorSwatch";
import { cx } from "./cx";
import { IconEyedropper } from "./icons";
import { IconButton } from "./IconButton";
import { NumberField } from "./NumberField";

export interface ColorPickerProps {
  /** #rrggbb, #rrggbbaa or rgba(...) */
  value: string;
  /** fires continuously while dragging; the value is #rrggbb, or rgba(...) when alpha is shown and below 1 */
  onChange: (value: string) => void;
  /** fires once when a drag / keyboard step / hex edit / eyedropper pick finished */
  onChangeEnd?: (value: string) => void;
  /** show the opacity slider and field */
  showAlpha?: boolean;
  className?: string;
}

interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function toHsva(input: string): Hsva | null {
  const rgba = parseColor(input);
  if (!rgba) return null;
  const { h, s, v } = rgbToHsv(rgba);
  return { h, s, v, a: rgba.a };
}

function rgbOf(hsva: Hsva): RGBA {
  return hsvToRgb({ h: hsva.h, s: hsva.s, v: hsva.v });
}

function format(hsva: Hsva, withAlpha: boolean): string {
  const rgb = rgbOf(hsva);
  if (withAlpha && hsva.a < 1) {
    return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${+hsva.a.toFixed(2)})`;
  }
  return toHex(rgb);
}

/** Comparable form of a colour string so equal colours in different notations match. */
function canonical(input: string, withAlpha: boolean): string | null {
  const c = parseColor(input);
  if (!c) return null;
  const base = `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`;
  return withAlpha ? `${base},${c.a.toFixed(2)}` : base;
}

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}
type EyeDropperCtor = new () => EyeDropperLike;

function getEyeDropper(): EyeDropperCtor | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
}

export function ColorPicker({ value, onChange, onChangeEnd, showAlpha = false, className }: ColorPickerProps) {
  const [hsva, setHsvaState] = useState<Hsva>(() => toHsva(value) ?? { h: 0, s: 0, v: 0, a: 1 });
  const hsvaRef = useRef(hsva);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  // Esc drops the typed text: the blur it triggers must not apply it (blur still sees the old `hexDraft`)
  const discardHex = useRef(false);

  // Adopt outside changes (e.g. a swatch was clicked) but keep hue / saturation when the new colour is achromatic.
  const incoming = canonical(value, showAlpha);
  if (incoming !== null && incoming !== canonical(format(hsva, showAlpha), showAlpha)) {
    const parsed = toHsva(value);
    if (parsed) {
      const next: Hsva = {
        h: parsed.s === 0 || parsed.v === 0 ? hsva.h : parsed.h,
        s: parsed.v === 0 ? hsva.s : parsed.s,
        v: parsed.v,
        a: showAlpha ? parsed.a : 1,
      };
      hsvaRef.current = next;
      setHsvaState(next);
    }
  }

  const update = (next: Hsva) => {
    hsvaRef.current = next;
    setHsvaState(next);
    onChange(format(next, showAlpha));
  };
  const finish = () => onChangeEnd?.(format(hsvaRef.current, showAlpha));

  const rgb = rgbOf(hsva);
  const hex = toHex(rgb);
  const hueColor = toHex(hsvToRgb({ h: hsva.h, s: 1, v: 1 }));
  const current = format(hsva, showAlpha);

  /* ---- saturation / brightness square ---- */

  const svRef = useRef<HTMLDivElement>(null);
  const svDragging = useRef(false);

  const pickSv = (e: PointerEvent<HTMLDivElement>) => {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const s = clamp01((e.clientX - rect.left) / rect.width);
    const v = 1 - clamp01((e.clientY - rect.top) / rect.height);
    update({ ...hsvaRef.current, s, v });
  };

  const onSvKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const c = hsvaRef.current;
    let next: Hsva | null = null;
    if (e.key === "ArrowLeft") next = { ...c, s: clamp01(c.s - step) };
    else if (e.key === "ArrowRight") next = { ...c, s: clamp01(c.s + step) };
    else if (e.key === "ArrowUp") next = { ...c, v: clamp01(c.v + step) };
    else if (e.key === "ArrowDown") next = { ...c, v: clamp01(c.v - step) };
    if (!next) return;
    e.preventDefault();
    update(next);
    finish();
  };

  /* ---- hue / alpha bars ---- */

  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);
  const barDragging = useRef<"h" | "a" | null>(null);

  const pickBar = (e: PointerEvent<HTMLDivElement>, which: "h" | "a", ref: RefObject<HTMLDivElement | null>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const t = clamp01((e.clientX - rect.left) / rect.width);
    const c = hsvaRef.current;
    update(which === "h" ? { ...c, h: Math.min(359.99, t * 360) } : { ...c, a: Math.round(t * 100) / 100 });
  };

  const barKeyDown = (e: KeyboardEvent<HTMLDivElement>, which: "h" | "a") => {
    const big = e.shiftKey ? 10 : 1;
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const c = hsvaRef.current;
    update(which === "h" ? { ...c, h: Math.min(359.99, Math.max(0, c.h + dir * big)) } : { ...c, a: clamp01(Math.round((c.a + (dir * big) / 100) * 100) / 100) });
    finish();
  };

  const barHandlers = (which: "h" | "a", ref: RefObject<HTMLDivElement | null>) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      barDragging.current = which;
      e.currentTarget.querySelector<HTMLElement>("[role=slider]")?.focus({ preventScroll: true });
      pickBar(e, which, ref);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (barDragging.current === which) pickBar(e, which, ref);
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      if (barDragging.current !== which) return;
      barDragging.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      finish();
    },
    onPointerCancel: () => {
      barDragging.current = null;
    },
  });

  /* ---- hex field + eyedropper ---- */

  const commitHex = (text: string) => {
    setHexDraft(null);
    const cleaned = text.trim().replace(/^#/, "");
    if (!/^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(cleaned)) return;
    const parsed = toHsva(`#${cleaned}`);
    if (!parsed) return;
    const c = hsvaRef.current;
    const next: Hsva = {
      h: parsed.s === 0 || parsed.v === 0 ? c.h : parsed.h,
      s: parsed.v === 0 ? c.s : parsed.s,
      v: parsed.v,
      a: showAlpha && (cleaned.length === 4 || cleaned.length === 8) ? parsed.a : c.a,
    };
    if (format(next, showAlpha) === format(c, showAlpha)) return;
    update(next);
    finish();
  };

  const EyeDropper = getEyeDropper();
  const pickFromScreen = async () => {
    if (!EyeDropper) return;
    try {
      const result = await new EyeDropper().open();
      const parsed = toHsva(result.sRGBHex);
      if (!parsed) return;
      const c = hsvaRef.current;
      update({ ...parsed, a: showAlpha ? c.a : 1, h: parsed.s === 0 || parsed.v === 0 ? c.h : parsed.h });
      finish();
    } catch {
      // user cancelled the picker (Esc) - nothing to do
    }
  };

  const svStyle = { "--cf-hue": hueColor } as CSSProperties;

  return (
    <div className={cx("cf-cp", className)}>
      <div
        ref={svRef}
        className="cf-cp__sv"
        style={svStyle}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsva.s * 100)}
        aria-valuetext={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
        onKeyDown={onSvKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus({ preventScroll: true });
          svDragging.current = true;
          pickSv(e);
        }}
        onPointerMove={(e) => {
          if (svDragging.current) pickSv(e);
        }}
        onPointerUp={(e) => {
          if (!svDragging.current) return;
          svDragging.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          finish();
        }}
        onPointerCancel={() => {
          svDragging.current = false;
        }}
      >
        <div className="cf-cp__sv-thumb" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, "--cf-thumb": hex } as CSSProperties} />
      </div>

      <div className="cf-cp__row">
        {EyeDropper ? <IconButton label="Pick colour from screen" icon={<IconEyedropper />} onClick={pickFromScreen} /> : null}
        <div className="cf-cp__bars">
          <div ref={hueRef} className="cf-cp__bar cf-cp__bar--hue" {...barHandlers("h", hueRef)}>
            <div
              className="cf-cp__bar-thumb"
              style={{ left: `${(hsva.h / 360) * 100}%`, "--cf-thumb": hueColor } as CSSProperties}
              role="slider"
              tabIndex={0}
              aria-label="Hue"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsva.h)}
              onKeyDown={(e) => barKeyDown(e, "h")}
            />
          </div>
          {showAlpha ? (
            <div ref={alphaRef} className="cf-cp__bar cf-cp__bar--alpha" style={{ "--cf-alpha-to": hex } as CSSProperties} {...barHandlers("a", alphaRef)}>
              <div
                className="cf-cp__bar-thumb"
                style={{ left: `${hsva.a * 100}%`, "--cf-thumb": current } as CSSProperties}
                role="slider"
                tabIndex={0}
                aria-label="Opacity"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hsva.a * 100)}
                aria-valuetext={`${Math.round(hsva.a * 100)}%`}
                onKeyDown={(e) => barKeyDown(e, "a")}
              />
            </div>
          ) : null}
        </div>
        <ColorSwatch color={current} size={36} title="Current colour" />
      </div>

      <div className="cf-cp__inputs">
        <label className="cf-cp__hex">
          <span className="cf-cp__hash" aria-hidden="true">
            #
          </span>
          <input
            className="cf-cp__hex-input"
            type="text"
            spellCheck={false}
            autoComplete="off"
            maxLength={9}
            aria-label="Hex colour"
            value={hexDraft ?? hex.slice(1).toUpperCase()}
            onChange={(e) => {
              const text = e.target.value;
              setHexDraft(text);
              // apply immediately once a complete 6-digit colour is typed
              if (/^#?[0-9a-f]{6}$/i.test(text.trim())) commitHex(text);
            }}
            onFocus={(e) => {
              discardHex.current = false;
              setHexDraft(hex.slice(1).toUpperCase());
              e.currentTarget.select();
            }}
            onBlur={() => {
              if (discardHex.current) {
                discardHex.current = false;
                return;
              }
              if (hexDraft !== null) commitHex(hexDraft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                e.preventDefault();
                discardHex.current = true;
                setHexDraft(null);
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        {showAlpha ? (
          <NumberField
            value={Math.round(hsva.a * 100)}
            onChange={(v) => update({ ...hsvaRef.current, a: v / 100 })}
            onCommit={finish}
            min={0}
            max={100}
            step={1}
            precision={0}
            prefix={<span>A</span>}
            suffix="%"
            label="Opacity"
            width={96}
          />
        ) : null}
      </div>
    </div>
  );
}
