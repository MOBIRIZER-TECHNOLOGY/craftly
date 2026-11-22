import { useState, type CSSProperties } from "react";
import { duplicateDesign, saveDesign } from "@/core/library";
import { resizeDesign as applyResize } from "@/core/ops";
import { useEditor } from "@/core/store";
import type { SizeUnit } from "@/core/types";
import { DESIGN_CATEGORY_LABELS, DESIGN_TYPES, describeSize, fromPx, toPx, type DesignCategory, type DesignType } from "@/data/designTypes";
import { checkSizeDraft, sizeDraftPx } from "@/data/sizeDraft";
import { m } from "@/i18n";
import { renderPageToCanvas } from "@/render/renderPage";
import { designPath, navigate } from "@/router";
import { Button, Checkbox, IconButton, IconLink, IconUnlink, Modal, NumberField, Select, toast, type SelectOption } from "@/ui";
import { requestSave, waitForSaved } from "../topbar/designActions";
import "./resizeDialog.css";

const MIN_PX = 40;
const MAX_PX = 8000;
const CATEGORY_ORDER: DesignCategory[] = ["presentation", "social", "print", "document", "marketing", "branding"];

const UNIT_OPTIONS: SelectOption<SizeUnit>[] = [
  { value: "px", label: "px", textValue: m.editorChrome.resize.unitNames.px },
  { value: "in", label: "in", textValue: m.editorChrome.resize.unitNames.in },
  { value: "mm", label: "mm", textValue: m.editorChrome.resize.unitNames.mm },
  { value: "cm", label: "cm", textValue: m.editorChrome.resize.unitNames.cm },
];
const PRECISION: Record<SizeUnit, number> = { px: 0, in: 2, mm: 1, cm: 2 };
const STEP: Record<SizeUnit, number> = { px: 1, in: 0.1, mm: 1, cm: 0.1 };

const clampPx = (px: number) => Math.min(MAX_PX, Math.max(MIN_PX, px));
const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

/** A little page outline with the format's proportions. */
function Shape({ type }: { type: DesignType }) {
  const box = 22;
  const ratio = type.width / type.height;
  const w = ratio >= 1 ? box : Math.max(6, Math.round(box * ratio));
  const h = ratio >= 1 ? Math.max(6, Math.round(box / ratio)) : box;
  return (
    <span className="cf-resize__tile" style={{ color: type.color } as CSSProperties} aria-hidden="true">
      <span className="cf-resize__shape" style={{ width: w, height: h }} />
    </span>
  );
}

export function ResizeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const design = useEditor.getState().design;
  const [unit, setUnit] = useState<SizeUnit>(design?.unit ?? "px");
  // width and height stay in (unrounded) design pixels while editing; they are rounded when applied
  const [size, setSize] = useState({ w: design?.width ?? 1080, h: design?.height ?? 1080 });
  const [ratio, setRatio] = useState((design?.width ?? 1) / (design?.height ?? 1));
  const [lock, setLock] = useState(true);
  const [scale, setScale] = useState(true);
  const [preset, setPreset] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // what is being typed into a side, checked at every key (B8); the field clamps it to the limits when it is committed
  const [widthDraft, setWidthDraft] = useState<string | null>(null);
  const [heightDraft, setHeightDraft] = useState<string | null>(null);

  if (!design) return null;

  const nw = Math.round(clampPx(size.w));
  const nh = Math.round(clampPx(size.h));
  const unchanged = nw === design.width && nh === design.height;
  const decimals = PRECISION[unit];
  const widthCheck = widthDraft === null ? "ok" : checkSizeDraft(widthDraft, unit, MIN_PX, MAX_PX);
  const heightCheck = heightDraft === null ? "ok" : checkSizeDraft(heightDraft, unit, MIN_PX, MAX_PX);
  const typing = widthCheck !== "ok" || heightCheck !== "ok";
  // "New" shows a side as soon as what is typed is a size (the fields only commit on Enter or blur), with the ratio lock
  // carrying it over to the other side as the commit will
  const typedWidth = widthDraft !== null ? sizeDraftPx(widthDraft, unit, MIN_PX, MAX_PX) : null;
  const typedHeight = heightDraft !== null ? sizeDraftPx(heightDraft, unit, MIN_PX, MAX_PX) : null;
  let shownW = size.w;
  let shownH = size.h;
  if (typedWidth !== null) {
    shownW = typedWidth;
    if (lock) shownH = clampPx(typedWidth / ratio);
  } else if (typedHeight !== null) {
    shownH = typedHeight;
    if (lock) shownW = clampPx(typedHeight * ratio);
  }
  const sw = Math.round(shownW);
  const sh = Math.round(shownH);
  const outOfRange =
    widthCheck === "invalid" && heightCheck === "invalid"
      ? m.editorChrome.resize.bothRange(MIN_PX, MAX_PX)
      : widthCheck === "invalid"
        ? m.editorChrome.resize.widthRange(MIN_PX, MAX_PX)
        : heightCheck === "invalid"
          ? m.editorChrome.resize.heightRange(MIN_PX, MAX_PX)
          : null;

  const setWidth = (value: number) => {
    const w = clampPx(toPx(value, unit));
    setPreset(null);
    setSize({ w, h: lock ? clampPx(w / ratio) : size.h });
  };
  const setHeight = (value: number) => {
    const h = clampPx(toPx(value, unit));
    setPreset(null);
    setSize({ w: lock ? clampPx(h * ratio) : size.w, h });
  };
  const toggleLock = () => {
    if (!lock) setRatio(size.w / size.h);
    setLock((v) => !v);
  };
  const pick = (type: DesignType) => {
    setPreset(type.id);
    setUnit(type.unit);
    setSize({ w: type.width, h: type.height });
    setRatio(type.width / type.height);
  };

  const resizeHere = () => {
    useEditor.getState().actions.resizeDesign(nw, nh, scale, unit);
    onClose();
    toast.success(m.editorChrome.resize.resized(describeSize(nw, nh, unit)));
  };

  const resizeCopy = async () => {
    setBusy(true);
    try {
      const current = useEditor.getState().design;
      if (!current) return;
      requestSave();
      if ((await waitForSaved()) !== "saved") throw new Error("The original design could not be saved.");
      const copy = await duplicateDesign(current.id);
      if (!copy) throw new Error("missing");
      applyResize(copy, nw, nh, scale);
      copy.typeId = "custom";
      copy.unit = unit;
      let thumb: string | undefined;
      try {
        thumb = (await renderPageToCanvas(copy, copy.pages[0], { width: 420 })).toDataURL("image/jpeg", 0.82);
      } catch {
        /* the thumbnail refreshes the first time the copy is opened */
      }
      await saveDesign(copy, thumb);
      onClose();
      navigate(designPath(copy.id));
      toast.success(m.editorChrome.resize.copyCreated(describeSize(nw, nh, unit)));
    } catch {
      toast.error(m.editorChrome.resize.copyFailed);
    } finally {
      setBusy(false);
    }
  };

  const groups = CATEGORY_ORDER.map((category) => ({ category, types: DESIGN_TYPES.filter((t) => t.category === category) })).filter((g) => g.types.length);
  const unitValue = (px: number) => round(fromPx(px, unit), decimals);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={m.editorChrome.resize.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button variant="secondary" loading={busy} disabled={unchanged || typing} onClick={() => void resizeCopy()}>
            {m.editorChrome.resize.makeCopy}
          </Button>
          <Button variant="primary" disabled={unchanged || busy || typing} onClick={resizeHere}>
            {m.editorChrome.resize.resize}
          </Button>
        </>
      }
    >
      <div className="cf-resize">
        <section className="cf-resize__formats" aria-labelledby="cf-resize-formats">
          <h3 id="cf-resize-formats" className="cf-resize__heading">
            {m.editorChrome.resize.formats}
          </h3>
          <div className="cf-resize__list">
            {groups.map((g) => (
              <div key={g.category} className="cf-resize__group" role="group" aria-label={DESIGN_CATEGORY_LABELS[g.category]}>
                <h4 className="cf-resize__cat">{DESIGN_CATEGORY_LABELS[g.category]}</h4>
                {g.types.map((t) => (
                  <Button key={t.id} variant="ghost" className="cf-resize__preset" icon={<Shape type={t} />} aria-pressed={preset === t.id} onClick={() => pick(t)}>
                    <span className="cf-resize__meta">
                      <span className="cf-resize__name">{t.name}</span>
                      <span className="cf-resize__dims">{describeSize(t.width, t.height, t.unit)}</span>
                    </span>
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="cf-resize__custom" aria-labelledby="cf-resize-custom">
          <h3 id="cf-resize-custom" className="cf-resize__heading">
            {m.editorChrome.resize.customSize}
          </h3>
          <div className="cf-resize__fields">
            <NumberField
              prefix={m.editorChrome.resize.widthShort}
              label={m.editorChrome.resize.width}
              value={unitValue(size.w)}
              min={unitValue(MIN_PX)}
              max={unitValue(MAX_PX)}
              step={STEP[unit]}
              precision={decimals}
              suffix={unit}
              onChange={setWidth}
              onDraft={setWidthDraft}
            />
            <IconButton
              size="sm"
              label={lock ? m.editorChrome.resize.unlockRatio : m.editorChrome.resize.lockRatio}
              active={lock}
              icon={lock ? <IconLink aria-hidden="true" /> : <IconUnlink aria-hidden="true" />}
              onClick={toggleLock}
            />
            <NumberField
              prefix={m.editorChrome.resize.heightShort}
              label={m.editorChrome.resize.height}
              value={unitValue(size.h)}
              min={unitValue(MIN_PX)}
              max={unitValue(MAX_PX)}
              step={STEP[unit]}
              precision={decimals}
              suffix={unit}
              onChange={setHeight}
              onDraft={setHeightDraft}
            />
          </div>
          <div className="cf-resize__unit">
            <span className="cf-resize__label" id="cf-resize-unit">
              {m.editorChrome.resize.units}
            </span>
            <Select<SizeUnit> value={unit} onChange={setUnit} options={UNIT_OPTIONS} aria-label={m.editorChrome.resize.units} width={120} />
          </div>
          <Checkbox checked={scale} onChange={setScale} label={m.editorChrome.resize.scaleContent} />
          <p className="cf-resize__hint">{scale ? m.editorChrome.resize.scaleHint : m.editorChrome.resize.keepHint}</p>
          <dl className="cf-resize__facts">
            <div>
              <dt>{m.editorChrome.resize.current}</dt>
              <dd>{describeSize(design.width, design.height, design.unit)}</dd>
            </div>
            <div>
              <dt>{m.editorChrome.resize.next}</dt>
              <dd>{describeSize(sw, sh, unit)}</dd>
            </div>
            {unit !== "px" ? (
              <div>
                <dt>{m.editorChrome.resize.inPixels}</dt>
                <dd>{m.editorChrome.resize.pixelSize(sw, sh)}</dd>
              </div>
            ) : null}
          </dl>
          {outOfRange ? (
            <p className="cf-resize__error" role="alert">
              {outOfRange}
            </p>
          ) : (
            <p className="cf-resize__hint">{m.editorChrome.resize.limits(MIN_PX, MAX_PX)}</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
