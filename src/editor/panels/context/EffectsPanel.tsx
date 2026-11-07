import { useEffect, useRef, type ReactNode } from "react";
import { createShape, createText, solid } from "@/core/factory";
import { getActions, getSelectedElements, useEditor, useSelectedElements } from "@/core/store";
import type { DesignElement, Page, TextEffect, TextElement } from "@/core/types";
import { drawTextElement } from "@/render/drawText";
import { ensureFont, isFontReady } from "@/render/fonts";
import { renderPage } from "@/render/renderPage";
import { measureTextElement } from "@/render/textLayout";
import { ColorSwatch, cx, IconEffects, Slider } from "@/ui";
import {
  blurFromPx,
  blurToPx,
  CONTROL_INFO,
  DEFAULT_CURVE,
  effectDefaults,
  effectValue,
  fromShadow,
  getEffectDef,
  matchShadowPreset,
  SHADOW_PRESETS,
  shadowScale,
  TEXT_EFFECTS,
  toShadow,
  type EffectControl,
  type ShadowParts,
} from "./effectModels";
import { PanelEmpty, PanelShell, Section } from "./PanelShell";
import { PreviewCanvas } from "./PreviewCanvas";
import { collectTexts, supportsShadow } from "./selectionKinds";
import { useBatch } from "./useBatch";
import "./EffectsPanel.css";

const TILE = 96;
const PREVIEW_FONT = "Plus Jakarta Sans";
const PREVIEW_WEIGHT = 800;
const PREVIEW_INK = "#7c3aed";

export function EffectsPanel() {
  const els = useSelectedElements();
  const texts = collectTexts(els);
  const textMode = texts.length > 0 && els.every((e) => e.type === "text" || e.type === "group");
  const shadowTargets = els.filter(supportsShadow);

  return (
    <PanelShell title="Effects">
      {textMode ? (
        <TextEffects texts={texts} />
      ) : shadowTargets.length > 0 ? (
        <ShadowEffects targets={shadowTargets} skipped={els.length - shadowTargets.length} />
      ) : (
        <PanelEmpty
          icon={<IconEffects />}
          title={els.length ? "No effects for this element" : "Nothing selected"}
          text={
            els.length
              ? "Effects are available for text, shapes, lines, images and graphics."
              : "Select text to add effects like shadow, neon or curve, or a shape, image or graphic to add a shadow."
          }
        />
      )}
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ */
/* shared tile                                                         */
/* ------------------------------------------------------------------ */

function Tile({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cx("cf-fx__tile", selected && "is-selected")} aria-pressed={selected} onClick={onClick}>
      <span className="cf-fx__thumb">{children}</span>
      <span className="cf-fx__label">{label}</span>
    </button>
  );
}

function ColorRow({ label, color, target }: { label: string; color: string; target: "effect" | "shadow" }) {
  return (
    <div className="cf-fx__colorrow">
      <span className="cf-fx__colorlabel">{label}</span>
      <ColorSwatch color={color} size={36} shape="square" title={`${label} (opens the colour panel)`} onClick={() => getActions().openContext({ kind: "color", target })} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

/** "Ag" painted by the real text painter with the given effect (and curve). */
function TextPreview({ effect, curve = 0, text = "Ag", size = 44 }: { effect: TextEffect; curve?: number; text?: string; size?: number }) {
  const key = JSON.stringify(effect);
  const draw = (ctx: CanvasRenderingContext2D, w: number, _h: number, dpr: number) => {
    if (!isFontReady(PREVIEW_FONT, PREVIEW_WEIGHT)) {
      void ensureFont(PREVIEW_FONT, PREVIEW_WEIGHT);
      return false;
    }
    // everything is laid out on a 96px tile and scaled to the tile's real size
    const k = w / TILE;
    const el = createText({ text, fontSize: size, fontFamily: PREVIEW_FONT, fontWeight: PREVIEW_WEIGHT, color: PREVIEW_INK, effect, curve, lineHeight: 1.2 });
    const m = measureTextElement(el);
    ctx.save();
    ctx.scale(k, k);
    ctx.translate((TILE - m.width) / 2, (TILE - m.height) / 2);
    drawTextElement(ctx, el, { scale: dpr * k });
    ctx.restore();
  };
  return <PreviewCanvas width={96} height={96} fluid draw={draw} deps={[key, curve, text, size]} />;
}

/** The sliders read the store (not the render) so a fast scrub never works from a stale effect. */
function latestTexts(): TextElement[] {
  return collectTexts(getSelectedElements(useEditor.getState()));
}

function TextEffects({ texts }: { texts: TextElement[] }) {
  const first = texts[0];
  const actions = getActions();
  const batch = useBatch();
  const sameKind = texts.every((t) => t.effect.kind === first.effect.kind);
  const activeKind = sameKind ? first.effect.kind : null;
  const def = activeKind ? getEffectDef(activeKind) : null;
  const curved = first.curve !== 0;
  const settingsRef = useRef<HTMLDivElement>(null);
  const picked = useRef(false);
  // a style picked from the grid reveals its sliders even when they start below the fold of a short panel
  useEffect(() => {
    if (picked.current) settingsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    picked.current = false;
  }, [activeKind]);

  const pickStyle = (kind: TextEffect["kind"]) => {
    // choosing the active style again switches it off
    const next = kind === activeKind && kind !== "none" ? "none" : kind;
    picked.current = true;
    actions.setTextProps(null, { effect: effectDefaults(next) });
  };

  const setControl = (control: EffectControl, value: number) =>
    batch.run(() => {
      const current = latestTexts()[0];
      if (current) actions.setTextProps(null, { effect: { ...current.effect, [control]: value } });
    });

  const setCurve = (value: number) => batch.run(() => actions.setTextProps(null, { curve: value }));

  return (
    <>
      <Section title="Style">
        <div className="cf-fx__grid" role="group" aria-label="Text effect styles">
          {TEXT_EFFECTS.map((d) => {
            const selected = d.kind === activeKind;
            // the active tile mirrors the current settings (colour, thickness ...), the others show their defaults
            return (
              <Tile key={d.kind} label={d.label} selected={selected} onClick={() => pickStyle(d.kind)}>
                <TextPreview effect={selected ? first.effect : d.defaults} />
              </Tile>
            );
          })}
        </div>
        {!sameKind ? <p className="cf-ctx__hint">The selected text boxes use different effects. Pick a style to apply it to all of them.</p> : null}
      </Section>

      {def && def.controls.length > 0 ? (
        <Section ref={settingsRef} title={`${def.label} settings`}>
          <div className="cf-ctx__rows">
            {def.controls.map((c) => {
              const info = CONTROL_INFO[c];
              return (
                <Slider
                  key={c}
                  label={info.label}
                  showValue
                  min={info.min}
                  max={info.max}
                  step={1}
                  value={effectValue(first.effect, c)}
                  onChange={(v) => setControl(c, v)}
                  onChangeEnd={() => batch.end()}
                />
              );
            })}
            {def.color ? <ColorRow label="Color" color={first.effect.color ?? first.color} target="effect" /> : null}
          </div>
        </Section>
      ) : null}

      <Section title="Shape">
        <div className="cf-fx__grid" role="group" aria-label="Text shape">
          <Tile label="None" selected={!curved} onClick={() => actions.setTextProps(null, { curve: 0 })}>
            <TextPreview effect={{ kind: "none" }} text="ABCD" size={26} />
          </Tile>
          <Tile label="Curve" selected={curved} onClick={() => actions.setTextProps(null, { curve: curved ? 0 : DEFAULT_CURVE })}>
            <TextPreview effect={{ kind: "none" }} text="ABCD" size={26} curve={curved ? first.curve : 55} />
          </Tile>
        </div>
        {curved ? (
          <div className="cf-ctx__rows cf-fx__after">
            <Slider label="Curve" showValue min={-100} max={100} step={1} value={first.curve} onChange={setCurve} onChangeEnd={() => batch.end()} />
          </div>
        ) : null}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* shapes, images, graphics: shadow                                     */
/* ------------------------------------------------------------------ */

/** A purple square casting the given shadow, painted by the real renderer. */
function ShadowPreview({ parts }: { parts: ShadowParts | null }) {
  const key = JSON.stringify(parts);
  const draw = (ctx: CanvasRenderingContext2D, w: number, _h: number, dpr: number) => {
    const el = createShape("rect", {
      x: 26,
      y: 26,
      width: 44,
      height: 44,
      radius: 10,
      fill: solid("#8b3dff"),
      // the tile is a tiny "page": shadows are scaled to it, not to a 1080px design
      shadow: parts ? toShadow(parts, 0.16) : null,
    });
    const page: Page = { id: "tile", background: solid("#ffffff"), elements: [el] };
    renderPage(ctx, { width: TILE, height: TILE }, page, { scale: dpr * (w / TILE), transparent: true });
  };
  return <PreviewCanvas width={TILE} height={TILE} fluid draw={draw} deps={[key]} />;
}

function ShadowEffects({ targets, skipped }: { targets: DesignElement[]; skipped: number }) {
  const first = targets[0];
  const design = useEditor((s) => s.design);
  const actions = getActions();
  const batch = useBatch();
  const scale = design ? shadowScale(design) : 1;
  // a glow has no offset and therefore no direction: remember the last one the user had
  const direction = useRef(45);
  const parts = first.shadow ? fromShadow(first.shadow, scale, direction.current) : null;
  if (parts && parts.offset > 0) direction.current = parts.direction;
  const activePreset = matchShadowPreset(first.shadow, scale);
  const image = targets.find((t) => t.type === "image");
  const settingsRef = useRef<HTMLDivElement>(null);
  const picked = useRef(false);
  const hasShadow = !!first.shadow;
  useEffect(() => {
    if (picked.current) settingsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    picked.current = false;
  }, [hasShadow]);

  const setShadow = (make: (el: DesignElement) => ShadowParts | null) =>
    actions.updateSelection((el) => {
      if (!supportsShadow(el)) return;
      const p = make(el);
      el.shadow = p ? toShadow(p, scale) : null;
    });

  const pick = (id: (typeof SHADOW_PRESETS)[number]["id"] | "none") => {
    const preset = SHADOW_PRESETS.find((p) => p.id === id);
    picked.current = true;
    // choosing the active preset again switches it off
    if (!preset || id === activePreset) setShadow(() => null);
    else setShadow(() => ({ ...preset.parts }));
  };

  const setPart = (key: keyof ShadowParts, value: number) =>
    batch.run(() =>
      setShadow((el) => {
        const base = el.shadow ? fromShadow(el.shadow, scale, direction.current) : { ...SHADOW_PRESETS[0].parts };
        if (key === "direction") direction.current = value;
        return { ...base, [key]: value };
      }),
    );

  const setBlur = (value: number) =>
    batch.run(() =>
      actions.updateSelection((el) => {
        if (el.type === "image") el.blur = blurToPx(value, scale);
      }),
    );

  const sliders: Array<{ key: keyof ShadowParts; label: string; min: number; max: number }> = [
    { key: "blur", label: "Blur", min: 0, max: 100 },
    { key: "offset", label: "Offset", min: 0, max: 100 },
    { key: "direction", label: "Direction", min: -180, max: 180 },
    { key: "transparency", label: "Transparency", min: 0, max: 100 },
  ];

  return (
    <>
      <Section title="Shadow">
        <div className="cf-fx__grid" role="group" aria-label="Shadow styles">
          <Tile label="None" selected={!first.shadow} onClick={() => pick("none")}>
            <ShadowPreview parts={null} />
          </Tile>
          {SHADOW_PRESETS.map((p) => (
            <Tile key={p.id} label={p.label} selected={activePreset === p.id} onClick={() => pick(p.id)}>
              <ShadowPreview parts={p.parts} />
            </Tile>
          ))}
        </div>
        {skipped > 0 ? (
          <p className="cf-ctx__hint">
            {skipped === 1 ? "One selected element does not support shadows and is left unchanged." : `${skipped} selected elements do not support shadows and are left unchanged.`}
          </p>
        ) : null}
      </Section>

      {parts ? (
        <Section ref={settingsRef} title="Shadow settings">
          <div className="cf-ctx__rows">
            {sliders.map((s) => (
              <Slider
                key={s.key}
                label={s.label}
                showValue
                min={s.min}
                max={s.max}
                step={1}
                value={parts[s.key] as number}
                // a shadow without offset (a glow) has no direction
                disabled={s.key === "direction" && parts.offset === 0}
                onChange={(v) => setPart(s.key, v)}
                onChangeEnd={() => batch.end()}
              />
            ))}
            <ColorRow label="Color" color={parts.color} target="shadow" />
          </div>
        </Section>
      ) : null}

      {image ? (
        <Section title="Image blur">
          <Slider label="Blur" showValue min={0} max={100} step={1} value={blurFromPx(image.blur ?? 0, scale)} onChange={setBlur} onChangeEnd={() => batch.end()} />
        </Section>
      ) : null}
    </>
  );
}
