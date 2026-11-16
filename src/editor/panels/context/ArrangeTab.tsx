import { useReducer, useRef, type ReactNode } from "react";
import { boundsOfElements } from "@/core/geometry";
import { canArrange, type AlignMode, type ArrangeMode } from "@/core/ops";
import { getActions, getActivePage, useActivePage, useEditor, useSelectedElements } from "@/core/store";
import type { DesignElement, ID, Point } from "@/core/types";
import { m } from "@/i18n";
import {
  Button,
  IconAlignObjBottom,
  IconAlignObjCenter,
  IconAlignObjLeft,
  IconAlignObjMiddle,
  IconAlignObjRight,
  IconAlignObjTop,
  IconBringForward,
  IconBringToFront,
  IconDistributeH,
  IconDistributeV,
  IconLock,
  IconPosition,
  IconSendBackward,
  IconSendToBack,
  IconButton,
  IconUnlock,
  NumberField,
} from "@/ui";
import { defaultRatioLock, describePosition, normalizeRotation, resizeSingle, rotateFromSnapshot, scaleAbout, topElements, translate } from "./boxEdit";
import { PanelEmpty, Section } from "./PanelShell";
import { useBatch } from "./useBatch";
import "./ArrangeTab.css";

const ARRANGE: Array<{ mode: ArrangeMode; label: string; icon: ReactNode }> = [
  { mode: "forward", label: m.panelsContext.arrange.modes.forward, icon: <IconBringForward /> },
  { mode: "backward", label: m.panelsContext.arrange.modes.backward, icon: <IconSendBackward /> },
  { mode: "front", label: m.panelsContext.arrange.modes.front, icon: <IconBringToFront /> },
  { mode: "back", label: m.panelsContext.arrange.modes.back, icon: <IconSendToBack /> },
];

/** Laid out like the real panel: Top | Left, Middle | Center, Bottom | Right. */
const ALIGN: Array<{ mode: AlignMode; label: string; group: string; icon: ReactNode }> = [
  { mode: "top", label: m.panelsContext.arrange.align.top, group: m.panelsContext.arrange.alignGroup.top, icon: <IconAlignObjTop /> },
  { mode: "left", label: m.panelsContext.arrange.align.left, group: m.panelsContext.arrange.alignGroup.left, icon: <IconAlignObjLeft /> },
  { mode: "middle", label: m.panelsContext.arrange.align.middle, group: m.panelsContext.arrange.alignGroup.middle, icon: <IconAlignObjMiddle /> },
  { mode: "center", label: m.panelsContext.arrange.align.center, group: m.panelsContext.arrange.alignGroup.center, icon: <IconAlignObjCenter /> },
  { mode: "bottom", label: m.panelsContext.arrange.align.bottom, group: m.panelsContext.arrange.alignGroup.bottom, icon: <IconAlignObjBottom /> },
  { mode: "right", label: m.panelsContext.arrange.align.right, group: m.panelsContext.arrange.alignGroup.right, icon: <IconAlignObjRight /> },
];

/** Icon row order for "Align selection": left, center, right | top, middle, bottom. */
const ROW_ORDER: AlignMode[] = ["left", "center", "right", "top", "middle", "bottom"];
const ALIGN_ROW = ALIGN.slice().sort((a, b) => ROW_ORDER.indexOf(a.mode) - ROW_ORDER.indexOf(b.mode));

/** Lock preference per selection; survives the panel being closed and reopened. */
const lockPrefs = new Map<string, boolean>();

function useRatioLock(ids: ID[], els: DesignElement[]): [boolean, () => void] {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const key = ids.join("|");
  const locked = lockPrefs.get(key) ?? defaultRatioLock(els);
  return [
    locked,
    () => {
      if (lockPrefs.size > 200) lockPrefs.clear();
      lockPrefs.set(key, !locked);
      rerender();
    },
  ];
}

/** The selection as it is in the store right now (handlers must not trust render-time values while a gesture runs). */
function latest() {
  const s = useEditor.getState();
  const page = getActivePage(s);
  if (!page) return null;
  const tops = topElements(page, s.selection);
  const model = describePosition(tops);
  if (!model) return null;
  const editable = tops.filter((e) => !e.locked);
  return { tops, model, editable, ids: editable.map((e) => e.id) };
}

export function ArrangeTab() {
  const page = useActivePage();
  const els = useSelectedElements();
  const actions = getActions();

  if (!page || els.length === 0) {
    return <PanelEmpty icon={<IconPosition />} title={m.panelsContext.shared.nothingSelected} text={m.panelsContext.arrange.emptyText} />;
  }

  const ids = els.map((e) => e.id);
  const count = ids.length;
  return (
    <div className="cf-arr">
      <Section>
        <div className="cf-arr__grid">
          {ARRANGE.map((a) => (
            <Button key={a.mode} block className="cf-arr__btn" icon={a.icon} disabled={!canArrange(page, ids, a.mode)} onClick={() => actions.arrange(a.mode)}>
              {a.label}
            </Button>
          ))}
        </div>
      </Section>

      <Section title={m.panelsContext.arrange.alignToPage}>
        <div className="cf-arr__grid">
          {ALIGN.map((a) => (
            <Button key={a.mode} block className="cf-arr__btn" icon={a.icon} onClick={() => actions.align(a.mode, "page")}>
              {a.label}
            </Button>
          ))}
        </div>
      </Section>

      {count > 1 ? (
        <Section title={m.panelsContext.arrange.alignSelection}>
          <div className="cf-arr__icons">
            {ALIGN_ROW.map((a) => (
              <IconButton key={a.mode} className="cf-arr__ibtn" label={a.group} icon={a.icon} onClick={() => actions.align(a.mode, "selection")} />
            ))}
          </div>
        </Section>
      ) : null}

      {count > 2 ? (
        <Section title={m.panelsContext.arrange.distribute}>
          <div className="cf-arr__grid">
            <Button block className="cf-arr__btn" icon={<IconDistributeH />} onClick={() => actions.distribute("horizontal")}>
              {m.panelsContext.arrange.horizontally}
            </Button>
            <Button block className="cf-arr__btn" icon={<IconDistributeV />} onClick={() => actions.distribute("vertical")}>
              {m.panelsContext.arrange.vertically}
            </Button>
          </div>
        </Section>
      ) : null}

      <Section title={m.panelsContext.arrange.advanced}>
        <AdvancedFields ids={ids} els={els} />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Advanced: Width, Height, Ratio, X, Y, Rotate                         */
/* ------------------------------------------------------------------ */

function AdvancedFields({ ids, els }: { ids: ID[]; els: DesignElement[] }) {
  const page = useActivePage();
  const tops = page ? topElements(page, ids) : [];
  const model = describePosition(tops);
  const [lock, toggleLock] = useRatioLock(ids, els);
  const batch = useBatch();
  const rotation = useRef<{ orig: Map<ID, DesignElement>; centre: Point } | null>(null);
  const actions = getActions();

  if (!model) return null;
  const disabled = model.allLocked;
  const commit = () => {
    rotation.current = null;
    batch.end();
  };

  const setWidth = (value: number) =>
    batch.run(() => {
      const c = latest();
      if (!c || value <= 0) return;
      if (c.model.single) {
        const el = c.tops[0];
        if (el.locked) return;
        const nh = lock && !c.model.heightReadOnly ? value * (el.height / Math.max(1, el.width)) : el.height;
        actions.updateElements([el.id], (d) => resizeSingle(d, value, nh, lock));
      } else {
        const sx = value / Math.max(1, c.model.width);
        actions.updateElements(c.ids, (d) => scaleAbout(d, sx, lock ? sx : 1, c.model.x, c.model.y));
      }
    });

  const setHeight = (value: number) =>
    batch.run(() => {
      const c = latest();
      if (!c || value <= 0 || c.model.heightReadOnly) return;
      if (c.model.single) {
        const el = c.tops[0];
        if (el.locked) return;
        const nw = lock ? value * (el.width / Math.max(1, el.height)) : el.width;
        actions.updateElements([el.id], (d) => resizeSingle(d, nw, value, lock));
      } else {
        const sy = value / Math.max(1, c.model.height);
        actions.updateElements(c.ids, (d) => scaleAbout(d, lock ? sy : 1, sy, c.model.x, c.model.y));
      }
    });

  const setX = (value: number) =>
    batch.run(() => {
      const c = latest();
      if (!c) return;
      const dx = value - c.model.x;
      if (dx) actions.updateElements(c.ids, (d) => translate(d, dx, 0));
    });

  const setY = (value: number) =>
    batch.run(() => {
      const c = latest();
      if (!c) return;
      const dy = value - c.model.y;
      if (dy) actions.updateElements(c.ids, (d) => translate(d, 0, dy));
    });

  const setRotation = (value: number) =>
    batch.run(() => {
      const c = latest();
      if (!c) return;
      if (c.model.single) {
        actions.updateElements(c.ids, (d) => {
          d.rotation = normalizeRotation(value);
        });
        return;
      }
      // several elements: the field is a relative turn about the middle of the whole selection
      if (!rotation.current) {
        const b = boundsOfElements(c.tops);
        if (!b) return;
        rotation.current = { orig: new Map(c.editable.map((e) => [e.id, structuredClone(e)])), centre: { x: b.x + b.w / 2, y: b.y + b.h / 2 } };
      }
      const snap = rotation.current;
      actions.updateElements(c.ids, (d) => {
        const o = snap.orig.get(d.id);
        if (o) rotateFromSnapshot(d, o, snap.centre, value);
      });
    });

  return (
    <div className="cf-arr__adv">
      <div className="cf-arr__fields">
        <Field label={m.panelsContext.arrange.width}>
          <NumberField value={model.width} onChange={setWidth} onCommit={commit} min={1} max={20000} suffix="px" aria-label={m.panelsContext.arrange.width} disabled={disabled} />
        </Field>
        <Field label={m.panelsContext.arrange.height}>
          <NumberField
            value={model.height}
            onChange={setHeight}
            onCommit={commit}
            min={1}
            max={20000}
            suffix="px"
            aria-label={m.panelsContext.arrange.height}
            disabled={disabled || model.heightReadOnly}
            title={model.heightReadOnly ? (els[0]?.type === "text" ? m.panelsContext.arrange.textHeight : m.panelsContext.arrange.lineHeight) : undefined}
          />
        </Field>
        <Field label={m.panelsContext.arrange.ratio}>
          <IconButton
            className="cf-arr__lock"
            label={lock ? m.panelsContext.arrange.unlockRatio : m.panelsContext.arrange.lockRatio}
            icon={lock ? <IconLock /> : <IconUnlock />}
            active={lock}
            disabled={disabled}
            onClick={toggleLock}
          />
        </Field>
        <Field label="X">
          <NumberField value={model.x} onChange={setX} onCommit={commit} min={-20000} max={40000} suffix="px" aria-label={m.panelsContext.arrange.xPosition} disabled={disabled} />
        </Field>
        <Field label="Y">
          <NumberField value={model.y} onChange={setY} onCommit={commit} min={-20000} max={40000} suffix="px" aria-label={m.panelsContext.arrange.yPosition} disabled={disabled} />
        </Field>
        <Field label={m.panelsContext.arrange.rotate}>
          <NumberField
            value={model.single ? Math.round(model.rotation * 100) / 100 : 0}
            onChange={setRotation}
            onCommit={commit}
            // any number of turns may be typed (725 is 5 degrees); it is brought into 0..360 when it is set
            min={-36000}
            max={36000}
            suffix="°"
            aria-label={model.single ? m.panelsContext.arrange.rotation : m.panelsContext.arrange.rotateSelectionBy}
            title={model.single ? undefined : m.panelsContext.arrange.rotateSelectionTitle}
            disabled={disabled}
          />
        </Field>
      </div>
      {disabled ? <p className="cf-ctx__hint">{m.panelsContext.arrange.lockedHint}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cf-arr__field">
      <span className="cf-ctx__label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}
