/**
 * Contextual toolbar of text elements: font, size, colour, B I U S, case, alignment, list,
 * spacing, transparency, effects, position.
 *
 * While a text box is being edited with a range selected, the character level controls (bold, italic,
 * underline, strikethrough, size) format the selected characters through `textEditing.applyInline`.
 * Without a range - or outside editing - they change the whole element (and clear run overrides).
 */
import { useEffect, type CSSProperties } from "react";
import { getActions, useEditor } from "@/core/store";
import type { ListKind, TextAlign, TextCase, TextElement } from "@/core/types";
import { isTyping } from "@/editor/canvas/controller";
import { textEditing, useTextSelectionStyle, type InlineFormat } from "@/editor/canvas/textEditing";
import {
  Divider,
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconChevronDown,
  IconItalic,
  IconLetterSpacing,
  IconList,
  IconListOrdered,
  IconStrikethrough,
  IconUnderline,
  NumberField,
  Tooltip,
  useLatest,
} from "@/ui";
import { AnimateButton, CopyStyleButton, EffectsButton, MoreButton, MultiActions, PositionButton, TransparencyButton, type BarProps } from "../common";
import { captureEditorSelection, editorHasFocus, restoreEditorSelection, trackEditorSelection } from "../editorSelection";
import { PopoverButton, SliderField, TBIcon, TBText, toggleContext, useContextActive } from "../kit";
import { MIXED_BAR_CSS, clampNumber, editElements, only, parasUniform, runsUniform, textPaint, uniform, type TextPaint, type Uniform } from "../selection";

type Flag = "bold" | "italic" | "underline" | "strike";

const CASES: TextCase[] = ["none", "upper", "lower", "title"];
const CASE_NAME: Record<TextCase, string> = { none: "Normal case", upper: "Uppercase", lower: "Lowercase", title: "Title case" };
const CASE_GLYPH: Record<TextCase, string> = { none: "aA", upper: "AA", lower: "aa", title: "Aa" };

const ALIGNS: TextAlign[] = ["left", "center", "right", "justify"];
const ALIGN_NAME: Record<TextAlign, string> = { left: "Left", center: "Center", right: "Right", justify: "Justified" };
const ALIGN_ICON = { left: IconAlignLeft, center: IconAlignCenter, right: IconAlignRight, justify: IconAlignJustify } as const;

/** pending "give the editor its focus back" after +/- presses (0 = none) */
let refocusTimer = 0;

const LISTS: Array<ListKind | null> = [null, "bullet", "number"];
const LIST_NAME = { none: "No list", bullet: "Bulleted list", number: "Numbered list" } as const;

/**
 * While a box is open in the text editor its paragraph blocks carry their own `data-list` / text-align
 * attributes (the editor builds them once). Keep them in step with the model so the next keystroke does not
 * write the old values back.
 */
function syncEditorBlocks(patch: { list?: ListKind | null; clearAlign?: boolean }): void {
  document.querySelectorAll<HTMLElement>("[data-cf-text-editor] > div").forEach((block) => {
    if (patch.list !== undefined) {
      if (patch.list) block.setAttribute("data-list", patch.list);
      else block.removeAttribute("data-list");
    }
    if (patch.clearAlign) block.style.textAlign = "";
  });
}

function TextColorGlyph({ paint }: { paint: TextPaint }) {
  const css = paint.kind === "solid" ? paint.color : paint.kind === "gradient" ? paint.css : MIXED_BAR_CSS;
  return (
    <span className="cf-tb__tcolor" aria-hidden="true">
      <svg viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 17 12 2.5 19.5 17M7.6 12h8.8" />
      </svg>
      <span className="cf-tb__tbar" style={{ "--cf-sw": css } as CSSProperties} />
    </span>
  );
}

export function TextBar({ els, ids, copyEnabled }: BarProps<TextElement> & { copyEnabled: boolean }) {
  const editingId = useEditor((s) => s.editingTextId);
  const sel = useTextSelectionStyle((s) => s);
  const fontOpen = useContextActive({ kind: "font" });
  const colorOpen = useContextActive({ kind: "color", target: "text" });
  const editing = !!editingId && ids.length === 1 && ids[0] === editingId;
  /** characters are selected in the open editor: character controls format only those */
  const range = editing && sel.active && !sel.collapsed;
  const multi = ids.length > 1;
  const actions = getActions();
  const idKey = ids.join(",");

  /* ---------------- character level state ---------------- */

  const flag = (key: Flag): Uniform<boolean> => {
    if (range) return { value: !!sel.style[key], mixed: false };
    return runsUniform(els, (el, run) => {
      if (key === "bold") return run.bold ?? el.fontWeight >= 600;
      if (key === "italic") return run.italic ?? el.italic;
      if (key === "underline") return run.underline ?? el.underline;
      return run.strike ?? el.strike;
    });
  };
  const bold = flag("bold");
  const italic = flag("italic");
  const underline = flag("underline");
  const strike = flag("strike");

  const family: Uniform<string> = range ? { value: sel.style.font, mixed: false } : runsUniform(els, (el, run) => run.font ?? el.fontFamily);
  const size: Uniform<number> = range ? { value: sel.style.size, mixed: false } : runsUniform(els, (el, run) => run.size ?? el.fontSize);
  const paint: TextPaint = range ? { kind: "solid", color: sel.style.color ?? els[0].color } : textPaint(els);

  const toggle = (key: Flag) => {
    const cur = key === "bold" ? bold : key === "italic" ? italic : key === "underline" ? underline : strike;
    const next = cur.mixed ? true : !cur.value;
    if (range) {
      const format: InlineFormat = {};
      format[key] = next;
      if (textEditing.applyInline(format)) return;
    }
    if (key === "bold") actions.setTextProps([...ids], { fontWeight: next ? 700 : 400 });
    else if (key === "italic") actions.setTextProps([...ids], { italic: next });
    else if (key === "underline") actions.setTextProps([...ids], { underline: next });
    else actions.setTextProps([...ids], { strike: next });
  };

  const setSize = (value: number) => {
    if (!Number.isFinite(value)) return;
    const px = clampNumber(value, 1, 1500);
    // The +/- buttons keep focus in the editor, but the number field grabs it again a frame later.
    const hadEditorFocus = editing && (editorHasFocus() || refocusTimer !== 0);
    let applied = false;
    if (range) {
      const snapshot = captureEditorSelection();
      if (textEditing.applyInline({ size: px })) {
        // Resizing swaps the selected DOM nodes; select the same characters again so "+" can be repeated.
        restoreEditorSelection(snapshot);
        applied = true;
      }
    }
    if (!applied) actions.setTextProps([...ids], { fontSize: px }, { coalesce: `fontSize:${idKey}` });
    if (hadEditorFocus) {
      // NumberField re-selects its text over the next two frames (taking focus); give the editor its focus back
      // after the last press of a quick series.
      window.clearTimeout(refocusTimer);
      refocusTimer = window.setTimeout(() => {
        refocusTimer = 0;
        if (document.activeElement?.closest(".cf-tb__size")) textEditing.focus();
      }, 80);
    }
  };

  // While a box is open, remember which characters are selected (see editorSelection.ts).
  useEffect(() => (editing ? trackEditorSelection() : undefined), [editing]);

  // Ctrl+B / I / U format a selected (not edited) text element; inside the editor the browser does it natively.
  const toggleRef = useLatest(toggle);
  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      const flag: Flag | null = key === "b" ? "bold" : key === "i" ? "italic" : key === "u" ? "underline" : null;
      if (!flag) return;
      e.preventDefault();
      toggleRef.current(flag);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, toggleRef]);

  /* ---------------- element level state ---------------- */

  const textCase = uniform(els, (e) => e.textCase);
  const caseNow: TextCase = textCase.mixed ? "none" : (textCase.value ?? "none");
  const caseNext: TextCase = textCase.mixed ? "upper" : CASES[(CASES.indexOf(caseNow) + 1) % CASES.length];

  const align = parasUniform(els, (el, p) => p.align ?? el.align);
  const alignNow: TextAlign = align.mixed ? "left" : (align.value ?? "left");
  const alignNext: TextAlign = ALIGNS[(ALIGNS.indexOf(alignNow) + 1) % ALIGNS.length];
  const AlignIcon = ALIGN_ICON[alignNow];

  const list = parasUniform(els, (el, p) => p.list ?? el.list ?? null);
  const listNow: ListKind | null = list.mixed ? null : (list.value ?? null);
  const listNext: ListKind | null = list.mixed ? "bullet" : LISTS[(LISTS.indexOf(listNow) + 1) % LISTS.length];

  const letter = uniform(els, (e) => Math.round(e.letterSpacing));
  const line = uniform(els, (e) => Math.round(e.lineHeight * 100) / 100);

  return (
    <>
      <TBText
        variant="secondary"
        size="sm"
        className="cf-tb__font"
        label={`Toggle font selector, current font: ${family.mixed ? "multiple fonts" : (family.value ?? "")}`}
        tip="Font"
        iconRight={<IconChevronDown />}
        active={fontOpen}
        onClick={() => toggleContext({ kind: "font" })}
      >
        {family.mixed ? "Multiple fonts" : (family.value ?? els[0].fontFamily)}
      </TBText>

      <Tooltip content="Font size" describe={false}>
        <div
          className="cf-tb__size"
          // The number field cannot step from "mixed" (blank): step from the first size instead.
          onClickCapture={(e) => {
            const step = (e.target as HTMLElement).closest<HTMLElement>("button.cf-num__step");
            if (!step || !size.mixed || size.value === undefined) return;
            e.stopPropagation();
            setSize(size.value + (step.getAttribute("aria-label")?.startsWith("Decrease") ? -1 : 1));
          }}
        >
          <NumberField
            stepper
            size="sm"
            aria-label="Font size"
            width={112}
            value={size.mixed ? Number.NaN : Math.round((size.value ?? 0) * 10) / 10}
            min={1}
            max={1500}
            step={1}
            onChange={setSize}
          />
        </div>
      </Tooltip>

      <TBIcon
        label="Text color"
        tip={paint.kind === "mixed" ? "Text color (mixed)" : "Text color"}
        icon={<TextColorGlyph paint={paint} />}
        active={colorOpen}
        onClick={() => toggleContext({ kind: "color", target: "text" })}
      />

      <TBIcon label="Bold" shortcut="Ctrl+B" icon={<IconBold />} active={!bold.mixed && !!bold.value} mixed={bold.mixed} onClick={() => toggle("bold")} />
      <TBIcon label="Italic" shortcut="Ctrl+I" icon={<IconItalic />} active={!italic.mixed && !!italic.value} mixed={italic.mixed} onClick={() => toggle("italic")} />
      <TBIcon
        label="Underline"
        shortcut="Ctrl+U"
        icon={<IconUnderline />}
        active={!underline.mixed && !!underline.value}
        mixed={underline.mixed}
        onClick={() => toggle("underline")}
      />
      <TBIcon label="Strikethrough" icon={<IconStrikethrough />} active={!strike.mixed && !!strike.value} mixed={strike.mixed} onClick={() => toggle("strike")} />

      <TBIcon
        label={`Text case: ${CASE_NAME[caseNow]}`}
        tip={CASE_NAME[caseNext]}
        icon={<span className="cf-tb__case">{CASE_GLYPH[caseNow]}</span>}
        active={!textCase.mixed && caseNow !== "none"}
        mixed={textCase.mixed}
        onClick={() => actions.setTextProps([...ids], { textCase: caseNext })}
      />

      <TBIcon
        label={`Toggle text alignment, current alignment: ${align.mixed ? "mixed" : ALIGN_NAME[alignNow]}`}
        tip={`Align ${ALIGN_NAME[alignNext].toLowerCase()}`}
        icon={<AlignIcon />}
        mixed={align.mixed}
        onClick={() => {
          editElements(
            ids,
            only("text", (t) => {
              t.align = alignNext;
              for (const p of t.paragraphs) delete p.align;
            }),
          );
          if (editing) syncEditorBlocks({ clearAlign: true });
        }}
      />

      <TBIcon
        label={list.mixed ? "List (mixed)" : `List: ${LIST_NAME[listNow ?? "none"]}`}
        tip={LIST_NAME[listNext ?? "none"]}
        icon={listNow === "number" ? <IconListOrdered /> : <IconList />}
        active={!list.mixed && listNow !== null}
        mixed={list.mixed}
        onClick={() => {
          editElements(
            ids,
            only("text", (t) => {
              t.list = listNext;
              for (const p of t.paragraphs) delete p.list;
            }),
          );
          if (editing) syncEditorBlocks({ list: listNext });
        }}
      />

      <PopoverButton label="Advanced settings" tip="Spacing" icon={<IconLetterSpacing />}>
        {() => (
          <div className="cf-tbpop__stack">
            <SliderField
              label="Letter spacing"
              value={letter.value ?? 0}
              mixed={letter.mixed}
              min={-200}
              max={800}
              step={1}
              onChange={(v) => actions.setTextProps([...ids], { letterSpacing: v }, { coalesce: `letterSpacing:${idKey}` })}
            />
            <SliderField
              label="Line spacing"
              value={line.value ?? 1.25}
              mixed={line.mixed}
              min={0.8}
              max={3}
              step={0.05}
              numberStep={0.1}
              onChange={(v) => actions.setTextProps([...ids], { lineHeight: Math.round(v * 100) / 100 }, { coalesce: `lineHeight:${idKey}` })}
            />
          </div>
        )}
      </PopoverButton>

      <TransparencyButton els={els} ids={ids} />
      <EffectsButton />
      <AnimateButton />
      <PositionButton />
      {multi && <MultiActions ids={ids} />}

      <Divider vertical className="cf-tb__div" />
      <CopyStyleButton els={els} enabled={copyEnabled} />
      <MoreButton />
    </>
  );
}
