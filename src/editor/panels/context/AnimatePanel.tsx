import { useState, type ReactNode } from "react";
import {
  MAX_ANIMATION_DELAY,
  MAX_ANIMATION_DURATION,
  MAX_CLIP_PAGE_DURATION,
  MAX_PAGE_DURATION,
  MIN_PAGE_DURATION,
  PAGE_ANIMATION_PRESETS,
  animatableElements,
  currentPageAnimation,
  defaultAnimation,
  getAnimationPreset,
  isAnimated,
  pageAnimationFor,
  pageClipLength,
  pageDuration,
  presetsFor,
  type AnimPhase,
} from "@/core/animation";
import { getActions, getActivePage, useEditor, useSelectedElements } from "@/core/store";
import { MAX_TRANSITION_DURATION, TRANSITION_PRESETS, defaultTransition, getTransitionPreset } from "@/core/transition";
import type { AnimDirection, ElementAnimation, Page } from "@/core/types";
import { previewEntrances, previewRange, startPreview, stopPreview, usePreview } from "@/editor/canvas/preview";
import { m } from "@/i18n";
import { Button, Checkbox, IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp, IconButton, IconPause, IconPlay, IconSparkle, Segmented, Slider, Tabs, cx } from "@/ui";
import { PanelEmpty, PanelShell, Section } from "./PanelShell";
import { TransitionPreview } from "./TransitionPreview";
import "./AnimatePanel.css";

/**
 * Animate: what moves, when and how. "Element animations" gives the selection an entrance, an exit and an emphasis;
 * "Page animations" animates everything on the page at once, sets how long the page stays and how the presentation
 * arrives at it. Choosing or changing something plays the page on the canvas so the effect is seen straight away.
 */
export function AnimatePanel({ tab }: { tab: "element" | "page" }) {
  const previewing = usePreview((s) => s.preview !== null);
  const page = useEditor((s) => getActivePage(s));
  const tabs = (
    <Tabs
      variant="underline"
      fullWidth
      value={tab}
      aria-label={m.panelsContext.animate.whatToAnimate}
      onChange={(id) => getActions().openContext({ kind: "animate", tab: id === "page" ? "page" : "element" })}
      tabs={[
        { id: "page", label: m.panelsContext.animate.pageAnimations },
        { id: "element", label: m.panelsContext.animate.elementAnimations },
      ]}
    />
  );
  const playAll = () => (previewing ? stopPreview() : page && startPreview(0, pageDuration(page)));
  return (
    <PanelShell
      title={m.panelsContext.animate.title}
      tabs={tabs}
      headerActions={
        <IconButton
          label={previewing ? m.panelsContext.animate.stopPreview : m.panelsContext.animate.playPage}
          icon={previewing ? <IconPause /> : <IconPlay />}
          onClick={playAll}
        />
      }
    >
      {tab === "page" ? <PagePane /> : <ElementPane />}
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ */
/* tiles                                                               */
/* ------------------------------------------------------------------ */

/** A preset: a small stand-in element that plays the effect while the tile is hovered, focused or chosen. */
function Tile({
  kind,
  label,
  selected,
  onClick,
  phase = "in",
  transition,
}: {
  kind: string;
  label: string;
  selected: boolean;
  onClick: () => void;
  phase?: AnimPhase;
  transition?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx("cf-an__tile", selected && "is-selected")}
      data-kind={kind}
      data-phase={phase}
      data-transition={transition ? "" : undefined}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="cf-an__thumb">
        {kind === "none" ? (
          <span className="cf-an__none" aria-hidden="true" />
        ) : (
          <span className="cf-an__demo" aria-hidden="true">
            {transition ? (
              <>
                <i className="cf-an__from" />
                <b className="cf-an__to" />
              </>
            ) : (
              <i />
            )}
          </span>
        )}
      </span>
      <span className="cf-an__label">{label}</span>
    </button>
  );
}

const DIRECTION_OPTIONS: Array<{ value: AnimDirection; title: string; icon: ReactNode }> = [
  { value: "left", title: m.panelsContext.animate.directions.left, icon: <IconArrowLeft /> },
  { value: "right", title: m.panelsContext.animate.directions.right, icon: <IconArrowRight /> },
  { value: "up", title: m.panelsContext.animate.directions.up, icon: <IconArrowUp /> },
  { value: "down", title: m.panelsContext.animate.directions.down, icon: <IconArrowDown /> },
];

function DirectionPicker({ value, directions, onChange }: { value: AnimDirection; directions: readonly AnimDirection[]; onChange: (d: AnimDirection) => void }) {
  return (
    <div className="cf-an__field">
      <span className="cf-an__fieldlabel">{m.panelsContext.animate.direction}</span>
      <Segmented<AnimDirection>
        fullWidth
        size="sm"
        aria-label={m.panelsContext.animate.direction}
        value={value}
        onChange={onChange}
        options={DIRECTION_OPTIONS.filter((o) => directions.includes(o.value)).map(({ value: v, title, icon }) => ({ value: v, title, icon }))}
      />
    </div>
  );
}

const seconds = (v: number) => m.panelsContext.animate.seconds(v);

/* ------------------------------------------------------------------ */
/* element animations                                                  */
/* ------------------------------------------------------------------ */

function ElementPane() {
  const els = useSelectedElements();
  const page = useEditor((s) => getActivePage(s));
  if (!page) return null;
  if (!els.length) {
    return (
      <PanelEmpty
        icon={<IconSparkle />}
        title={m.panelsContext.shared.nothingSelected}
        text={m.panelsContext.animate.nothingSelectedText}
        action={
          <Button variant="secondary" size="sm" onClick={() => getActions().openContext({ kind: "animate", tab: "page" })}>
            {m.panelsContext.animate.pageAnimations}
          </Button>
        }
      />
    );
  }
  const top = new Set(page.elements.map((e) => e.id));
  const targets = els.filter((e) => top.has(e.id) && !e.locked);
  if (!targets.length) {
    return <PanelEmpty icon={<IconSparkle />} title={m.panelsContext.animate.cannotAnimate} text={m.panelsContext.animate.cannotAnimateText} />;
  }
  const ids = targets.map((e) => e.id);
  return (
    <>
      <PhaseSection phase="in" title={m.panelsContext.animate.entrance} hint={m.panelsContext.animate.entranceHint} ids={ids} targets={targets} page={page} />
      <PhaseSection phase="out" title={m.panelsContext.animate.exit} hint={m.panelsContext.animate.exitHint} ids={ids} targets={targets} page={page} />
      <PhaseSection phase="loop" title={m.panelsContext.animate.emphasis} hint={m.panelsContext.animate.emphasisHint} ids={ids} targets={targets} page={page} />
      {targets.some(isAnimated) ? (
        <div className="cf-an__remove">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const a = getActions();
              for (const phase of ["in", "out", "loop"] as const) a.setAnimation(ids, phase, null);
              stopPreview();
            }}
          >
            {m.panelsContext.animate.removeAll}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function PhaseSection({
  phase,
  title,
  hint,
  ids,
  targets,
  page,
}: {
  phase: AnimPhase;
  title: string;
  hint: string;
  ids: string[];
  targets: Array<{ animation?: { in?: ElementAnimation | null; out?: ElementAnimation | null; loop?: ElementAnimation | null } }>;
  page: Page;
}) {
  const kinds = targets.map((e) => e.animation?.[phase]?.kind ?? null);
  const same = kinds.every((k) => k === kinds[0]);
  const current = same ? kinds[0] : undefined; // undefined: the selection disagrees
  const anim = same && current ? (targets[0].animation?.[phase] ?? null) : null;

  const choose = (kind: string | null) => {
    const next = kind ? defaultAnimation(kind, phase) : null;
    getActions().setAnimation(ids, phase, next);
    if (next) {
      const r = previewRange(phase, next, page);
      startPreview(r.from, r.until);
    } else stopPreview();
  };

  return (
    <Section title={title} aside={<span className="cf-an__hint">{hint}</span>}>
      <div className="cf-an__grid" role="group" aria-label={m.panelsContext.animate.phaseGroup(title)}>
        <Tile kind="none" label={m.common.none} selected={same && current === null} onClick={() => choose(null)} />
        {presetsFor(phase).map((p) => (
          <Tile key={p.id} kind={p.id} phase={phase} label={p.label} selected={current === p.id} onClick={() => choose(p.id)} />
        ))}
      </div>
      {anim ? <PhaseSettings phase={phase} ids={ids} anim={anim} page={page} /> : null}
    </Section>
  );
}

function PhaseSettings({ phase, ids, anim, page }: { phase: AnimPhase; ids: string[]; anim: ElementAnimation; page: Page }) {
  const preset = getAnimationPreset(anim.kind);
  const patch = (p: Partial<ElementAnimation>) => getActions().patchAnimation(ids, phase, p);
  const replay = (next: ElementAnimation) => {
    const r = previewRange(phase, next, page);
    startPreview(r.from, r.until);
  };
  const dirs = preset?.directions;
  return (
    <div className="cf-an__settings">
      {dirs ? (
        <DirectionPicker
          value={anim.direction ?? preset?.defaultDirection ?? "right"}
          directions={dirs}
          onChange={(d) => {
            patch({ direction: d });
            replay({ ...anim, direction: d });
          }}
        />
      ) : null}
      <Slider
        label={phase === "loop" ? m.panelsContext.animate.cycleLength : m.panelsContext.animate.duration}
        showValue
        format={seconds}
        min={0.2}
        max={MAX_ANIMATION_DURATION}
        step={0.1}
        value={anim.duration}
        onChange={(v) => patch({ duration: v })}
        onChangeEnd={(v) => replay({ ...anim, duration: v })}
      />
      {phase !== "loop" ? (
        <Slider
          label={phase === "in" ? m.panelsContext.animate.delay : m.panelsContext.animate.leaveEarly}
          showValue
          format={seconds}
          min={0}
          max={MAX_ANIMATION_DELAY}
          step={0.1}
          value={anim.delay}
          onChange={(v) => patch({ delay: v })}
          onChangeEnd={(v) => replay({ ...anim, delay: v })}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page animations, timing and transition                              */
/* ------------------------------------------------------------------ */

function PagePane() {
  const design = useEditor((s) => s.design);
  const page = useEditor((s) => getActivePage(s));
  const [allTiming, setAllTiming] = useState(false);
  const [allTransitions, setAllTransitions] = useState(false);
  if (!design || !page) return null;
  const index = design.pages.findIndex((p) => p.id === page.id);
  const els = animatableElements(page, design);
  const active = currentPageAnimation(page, design);
  const noEntrances = els.every((e) => !e.animation?.in);
  /** how long the page's longest clip takes to play once (null: no clip) */
  const clipLength = pageClipLength(page);

  const choosePage = (id: string | null) => {
    getActions().setPageAnimation(id);
    const preset = PAGE_ANIMATION_PRESETS.find((p) => p.id === id);
    if (preset && els.length) {
      const last = pageAnimationFor(preset, els.length - 1).in!;
      const r = previewEntrances(last.delay + last.duration, page);
      startPreview(r.from, r.until);
    } else stopPreview();
  };

  const transition = page.transition ?? null;
  const tPreset = transition ? getTransitionPreset(transition.kind) : undefined;
  const setTransition = (kind: string | null) => getActions().setPageTransition(kind ? defaultTransition(kind) : null, allTransitions ? "all" : "page");
  const patchTransition = (patch: Partial<NonNullable<Page["transition"]>>) =>
    transition && getActions().setPageTransition({ ...transition, ...patch }, allTransitions ? "all" : "page");

  return (
    <>
      <Section title={m.panelsContext.animate.pageAnimation} aside={<span className="cf-an__hint">{m.panelsContext.animate.pageAnimationHint}</span>}>
        <div className="cf-an__grid" role="group" aria-label={m.panelsContext.animate.pageAnimations}>
          <Tile kind="none" label={m.common.none} selected={noEntrances} onClick={() => choosePage(null)} />
          {PAGE_ANIMATION_PRESETS.map((p) => (
            <Tile key={p.id} kind={p.kind} label={p.label} selected={active?.id === p.id} onClick={() => choosePage(p.id)} />
          ))}
        </div>
        <p className="cf-an__note">{m.panelsContext.animate.pageAnimationNote}</p>
      </Section>

      <Section title={m.panelsContext.animate.pageTiming} aside={<span className="cf-an__hint">{m.panelsContext.animate.pageTimingHint}</span>}>
        <Slider
          label={m.panelsContext.animate.pageDuration}
          showValue
          format={m.panelsContext.animate.pageSeconds}
          min={MIN_PAGE_DURATION}
          max={MAX_PAGE_DURATION}
          scale="log"
          step={0.5}
          value={pageDuration(page)}
          onChange={(v) => getActions().setPageDuration(v, allTiming ? "all" : "page")}
        />
        {clipLength !== null ? (
          // a page with a clip lasts as long as the clip until a length is set for it; then it can be given that length back
          page.duration === undefined ? (
            <p className="cf-an__note" role="status">
              {m.panelsContext.animate.followsClip(m.panelsContext.animate.pageSeconds(pageDuration(page)))}
            </p>
          ) : (
            <p className="cf-an__note">
              <Button variant="secondary" size="sm" onClick={() => getActions().resetPageDuration(allTiming ? "all" : "page")}>
                {m.panelsContext.animate.matchClip(m.panelsContext.animate.pageSeconds(Math.min(clipLength, MAX_CLIP_PAGE_DURATION)))}
              </Button>
            </p>
          )
        ) : null}
        <Checkbox checked={allTiming} onChange={setAllTiming} label={m.panelsContext.shared.applyToAllPages} />
      </Section>

      <Section title={m.panelsContext.animate.transition} aside={<span className="cf-an__hint">{m.panelsContext.animate.transitionHint}</span>}>
        {index <= 0 ? (
          <p className="cf-an__note">{m.panelsContext.animate.firstPage}</p>
        ) : (
          <>
            <TransitionPreview design={design} from={design.pages[index - 1]} to={page} transition={transition} />
            <div className="cf-an__grid" role="group" aria-label={m.panelsContext.animate.pageTransitions}>
              <Tile kind="none" label={m.common.none} transition selected={!transition} onClick={() => setTransition(null)} />
              {TRANSITION_PRESETS.map((p) => (
                <Tile key={p.id} kind={`t-${p.id}`} transition label={p.label} selected={transition?.kind === p.id} onClick={() => setTransition(p.id)} />
              ))}
            </div>
            {transition ? (
              <div className="cf-an__settings">
                {tPreset?.directions ? (
                  <DirectionPicker
                    value={transition.direction ?? tPreset.defaultDirection ?? "left"}
                    directions={tPreset.directions}
                    onChange={(d) => patchTransition({ direction: d })}
                  />
                ) : null}
                <Slider
                  label={m.panelsContext.animate.duration}
                  showValue
                  format={seconds}
                  min={0.2}
                  max={MAX_TRANSITION_DURATION}
                  step={0.1}
                  value={transition.duration}
                  onChange={(v) => patchTransition({ duration: v })}
                />
              </div>
            ) : null}
            <Checkbox checked={allTransitions} onChange={setAllTransitions} label={m.panelsContext.shared.applyToAllPages} />
          </>
        )}
      </Section>
    </>
  );
}
