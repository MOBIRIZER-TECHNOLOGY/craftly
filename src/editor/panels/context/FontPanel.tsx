import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getActions, getSelectedElements, useEditor, useSelectedElements } from "@/core/store";
import { textEditing, useTextSelectionStyle } from "@/editor/canvas/textEditing";
import { useCustomFamilies } from "@/components/CustomFonts";
import { m } from "@/i18n";
import { cssFontFamily, customFontDefs, ensureFont, FONT_CATALOG, getFontDef, snapWeight, type FontCategory } from "@/render/fonts";
import { Button, cx, IconBrand, IconCheck, IconFile, IconPlus, IconText, IconUpload, SearchField, Select } from "@/ui";
import { collectDocumentFonts, filterFonts } from "./docFonts";
import { PanelEmpty, PanelShell, Section } from "./PanelShell";
import { collectTexts } from "./selectionKinds";
import { useBrandKit } from "./useLibrary";
import "./FontPanel.css";

const CATEGORIES: Array<{ id: FontCategory; label: string; sample: string }> = [
  { id: "sans", label: m.panelsContext.font.categories.sans, sample: "Inter" },
  { id: "serif", label: m.panelsContext.font.categories.serif, sample: "Playfair Display" },
  { id: "display", label: m.panelsContext.font.categories.display, sample: "Bebas Neue" },
  { id: "script", label: m.panelsContext.font.categories.script, sample: "Pacifico" },
  { id: "handwriting", label: m.panelsContext.font.categories.handwriting, sample: "Caveat" },
  { id: "mono", label: m.panelsContext.font.categories.mono, sample: "JetBrains Mono" },
];

type Filter = FontCategory | "all";

/** What the weights of a font are called. */
const WEIGHT_NAMES: Record<number, string> = m.panelsContext.font.weights;

export function FontPanel() {
  const els = useSelectedElements();
  const design = useEditor((s) => s.design);
  const texts = collectTexts(els);
  const boxes = els.filter((e) => e.type === "table" || e.type === "chart");
  // the font and weight at the caret / selection while characters are being formatted
  const inline = useTextSelectionStyle((s) => (s.active ? s : undefined));
  const inlineFont = inline?.style.font;
  const current = inlineFont ?? texts[0]?.fontFamily ?? (boxes[0] && "fontFamily" in boxes[0] ? boxes[0].fontFamily : undefined);
  const range = !!inline && !inline.collapsed && !!texts.length;

  // A selected character range uses its own family and weight; otherwise the boxes must agree on both.
  const weightDef = range
    ? getFontDef(inlineFont ?? texts[0].fontFamily)
    : texts.length && texts.every((t) => t.fontFamily === texts[0].fontFamily)
      ? getFontDef(texts[0].fontFamily)
      : undefined;
  const weights = weightDef && weightDef.weights.length > 2 ? weightDef.weights : [];
  const weightNow = weightDef
    ? range
      ? snapWeight(weightDef, inline.style.weight ?? texts[0].fontWeight)
      : texts.every((t) => t.fontWeight === texts[0].fontWeight)
        ? snapWeight(weightDef, texts[0].fontWeight)
        : null
    : null;

  const pickWeight = async (weight: number) => {
    const sample = collectTexts(getSelectedElements(useEditor.getState()))[0];
    if (!sample) return;
    const selection = useTextSelectionStyle.getState();
    const family = selection.active ? (selection.style.font ?? sample.fontFamily) : sample.fontFamily;
    const italic = selection.active ? (selection.style.italic ?? sample.italic) : sample.italic;
    // load the face first so the canvas never paints the fallback font
    await ensureFont(family, weight, italic);
    if (textEditing.applyInline({ weight })) return;
    getActions().setTextProps(null, { fontWeight: weight });
  };

  const kit = useBrandKit();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const docFonts = useMemo(() => (design ? collectDocumentFonts(design) : []), [design]);
  // the uploaded families; reading them here is also what draws this panel again when one is added, renamed or deleted
  const uploaded = useCustomFamilies();
  const ownFonts = useMemo(() => (uploaded ? filterFonts(customFontDefs(), query) : []), [uploaded, query]);
  // A family the design names that is neither bundled nor uploaded here draws in a substitute font. It is listed under its
  // own name and marked; the design is not changed. Nothing is marked before the uploaded fonts were read.
  const missing = (family: string) => uploaded !== null && getFontDef(family) === undefined;

  // the category chips are written in their own typefaces
  useEffect(() => {
    for (const c of CATEGORIES) void ensureFont(c.sample, 400);
  }, []);

  const pick = async (family: string) => {
    const now = getSelectedElements(useEditor.getState());
    const sample = collectTexts(now)[0];
    // load the face first so the canvas never paints the fallback font
    await ensureFont(family, sample?.fontWeight ?? 400, sample?.italic ?? false);
    const actions = getActions();
    if (textEditing.applyInline({ font: family })) return;
    actions.setTextProps(null, { fontFamily: family });
    actions.updateSelection((el) => {
      if (el.type === "table" || el.type === "chart") el.fontFamily = family;
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".cf-font__row") ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  if (!texts.length && !boxes.length) {
    return (
      <PanelShell title={m.panelsContext.font.title}>
        <PanelEmpty icon={<IconText />} title={m.panelsContext.shared.noTextSelected} text={m.panelsContext.font.noTextText} />
      </PanelShell>
    );
  }

  const searching = query.trim().length > 0;
  const groups = CATEGORIES.filter((c) => filter === "all" || filter === c.id)
    .map((c) => ({
      ...c,
      fonts: filterFonts(
        FONT_CATALOG.filter((f) => f.category === c.id),
        query,
      ),
    }))
    .filter((g) => g.fonts.length > 0);
  const showShortcuts = !searching && filter === "all";

  return (
    <PanelShell title={m.panelsContext.font.title}>
      <div className="cf-font" ref={listRef} onKeyDown={onKeyDown}>
        <SearchField value={query} onChange={setQuery} placeholder={m.panelsContext.font.searchPlaceholder} aria-label={m.panelsContext.font.searchLabel} />
        <div className="cf-font__chips" role="group" aria-label={m.panelsContext.font.categoriesLabel}>
          <button type="button" className={cx("cf-font__chip", filter === "all" && "is-active")} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            {m.panelsContext.font.all}
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cx("cf-font__chip", filter === c.id && "is-active")}
              aria-pressed={filter === c.id}
              style={{ fontFamily: cssFontFamily(c.sample) }}
              onClick={() => setFilter(filter === c.id ? "all" : c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {weights.length ? (
          <div className="cf-font__weight">
            <span className="cf-font__weight-name" id="cf-font-weight">
              {m.panelsContext.font.weight}
            </span>
            <Select<number>
              aria-label={m.panelsContext.font.weight}
              size="sm"
              value={weightNow !== null && weights.includes(weightNow) ? weightNow : null}
              placeholder={m.panelsContext.font.weightMixed}
              options={weights.map((w) => ({ value: w, label: m.panelsContext.font.weightName(WEIGHT_NAMES[w] ?? String(w), w), textValue: WEIGHT_NAMES[w] ?? String(w) }))}
              onChange={(w) => void pickWeight(w)}
            />
          </div>
        ) : null}

        {filter === "all" && ownFonts.length ? (
          <Section title={m.panelsContext.font.yourFonts} icon={<IconUpload />}>
            <div className="cf-font__list">
              {ownFonts.map((f) => (
                <FontRow key={f.family} family={f.family} current={f.family === current} onPick={pick} />
              ))}
            </div>
          </Section>
        ) : null}

        {showShortcuts && docFonts.length ? (
          <Section title={m.panelsContext.font.documentFonts} icon={<IconFile />}>
            <div className="cf-font__list">
              {docFonts.map((f) => (
                <FontRow key={f} family={f} current={f === current} onPick={pick} missing={missing(f)} />
              ))}
            </div>
          </Section>
        ) : null}

        {showShortcuts ? (
          <Section
            title={m.panelsContext.font.brandFonts}
            icon={<IconBrand />}
            aside={
              <button type="button" className="cf-ctx__link" onClick={() => getActions().setLeftTab("brand")}>
                {m.panelsContext.shared.edit}
              </button>
            }
          >
            {kit === null ? null : kit.fonts.length ? (
              <div className="cf-font__list">
                {kit.fonts.map((f) => (
                  <FontRow key={f} family={f} current={f === current} onPick={pick} />
                ))}
              </div>
            ) : (
              <Button block variant="secondary" icon={<IconPlus />} onClick={() => getActions().setLeftTab("brand")}>
                {m.panelsContext.font.addBrandFonts}
              </Button>
            )}
          </Section>
        ) : null}

        {groups.map((g) => (
          <Section key={g.id} title={g.label}>
            <div className="cf-font__list">
              {g.fonts.map((f) => (
                <FontRow key={f.family} family={f.family} current={f.family === current} onPick={pick} />
              ))}
            </div>
          </Section>
        ))}

        {groups.length === 0 && ownFonts.length === 0 ? <p className="cf-ctx__hint">{m.panelsContext.font.noMatch(query.trim())}</p> : null}
      </div>
    </PanelShell>
  );
}

/** One font, written in itself; its file is fetched only when the row scrolls into view. */
function FontRow({ family, current, onPick, missing = false }: { family: string; current: boolean; onPick: (family: string) => void; missing?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      void ensureFont(family, 400);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void ensureFont(family, 400);
          io.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [family]);

  return (
    <button
      ref={ref}
      type="button"
      className={cx("cf-font__row", current && "is-current")}
      aria-current={current ? "true" : undefined}
      aria-label={missing ? m.panelsContext.font.missingLabel(family) : family}
      onClick={() => onPick(family)}
    >
      <span className="cf-font__name" style={{ fontFamily: cssFontFamily(family) }}>
        {family}
      </span>
      {missing ? <span className="cf-font__missing">{m.panelsContext.font.missing}</span> : null}
      {current ? <IconCheck className="cf-font__check" aria-hidden="true" /> : null}
    </button>
  );
}
