import { useMemo, useState } from "react";
import { createText, textPresetSizes } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { useCustomFamilies } from "@/components/CustomFonts";
import { englishName } from "@/data/names";
import { m } from "@/i18n";
import { FONT_CATALOG, cssFontFamily, customFontDefs, type FontDef } from "@/render/fonts";
import { TEXT_COMBOS, type TextCombo } from "@/data/textCombos";
import { TEXT_STYLE_PRESETS, type TextStylePreset } from "@/data/textStyles";
import { Button, IconBrand, IconSearch, IconText, Skeleton, cx } from "@/ui";
import { DraggableItem } from "../shared/DraggableItem";
import { EmptyHint } from "../shared/EmptyHint";
import { useBrandKit, useDebounced, useElementWidth } from "../shared/hooks";
import { Panel, PanelLink, PanelScroll, PanelSection, PanelTop } from "../shared/PanelLayout";
import { PanelSearch } from "../shared/PanelSearch";
import { addTextAndEdit, addTextInFont, designMin } from "../shared/panelActions";
import { IconHash } from "../shared/icons";
import { ComboPreview } from "./text/ComboPreview";
import { FontRow } from "./text/FontRow";
import "./TextTab.css";

const GAP = 8;

/** The family names, categories and words people type ("serif", "script", "mono" ...) a font is found by. */
const haystackOf = (f: FontDef) => ({ def: f, hay: `${f.family} ${f.category} ${f.variable ? "variable" : ""} ${f.italic ? "italic" : ""}`.toLowerCase() });
const FONT_HAYSTACK = FONT_CATALOG.map(haystackOf);

const matchesWords = (hay: string, q: string) =>
  q
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));

/**
 * Text: add a text box, the default heading / subheading / body styles, brand fonts, page numbers and ready-made
 * font combinations. Typing in the search field filters every installed font (shown in its own face) and the combinations.
 */
export default function TextTab() {
  const design = useEditor((s) => s.design);
  const setLeftTab = useEditor((s) => s.actions.setLeftTab);
  const [kit] = useBrandKit();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 120);
  const q = debounced.trim().toLowerCase();
  const searching = query.trim().length > 0;

  // the fonts the person uploaded are found by their names, before the bundled ones
  const uploaded = useCustomFamilies();
  const fonts = useMemo(
    () =>
      q
        ? [...(uploaded ? customFontDefs().map((f) => ({ def: f, hay: f.family.toLowerCase() })) : []), ...FONT_HAYSTACK].filter((f) => matchesWords(f.hay, q)).map((f) => f.def)
        : [],
    [q, uploaded],
  );
  const combos = useMemo(
    () => (q ? TEXT_COMBOS.filter((c) => matchesWords(`${c.name} ${englishName("textCombos", c.id)} ${c.fonts.join(" ")}`.toLowerCase(), q)) : TEXT_COMBOS),
    [q],
  );

  if (!design) return null;

  const addTextBox = () => {
    const size = Math.round(designMin() * 0.05);
    addTextAndEdit(createText({ text: "Text", fontSize: size }));
  };

  return (
    <Panel>
      <PanelTop>
        <PanelSearch value={query} onChange={setQuery} placeholder={m.panelsTabs.text.search} />
        <Button variant="primary" size="lg" block icon={<IconText />} onClick={addTextBox}>
          {m.panelsTabs.text.addTextBox}
        </Button>
      </PanelTop>
      <PanelScroll>
        {searching ? (
          <>
            <PanelSection title={m.panelsTabs.text.fonts(fonts.length)}>
              {fonts.length ? (
                <div className="cf-text__fonts">
                  {fonts.map((f) => (
                    <FontRow
                      key={f.family}
                      family={f.family}
                      onPick={() =>
                        void addTextInFont("Add a heading", f.family, {
                          fontSize: textPresetSizes(design.width, design.height).heading,
                          fontWeight: f.weights.includes(700) ? 700 : f.weights[f.weights.length - 1],
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyHint icon={<IconSearch />} title={m.panelsTabs.text.noFonts} text={m.panelsTabs.text.noFontsText(debounced.trim())} compact />
              )}
            </PanelSection>
            {combos.length ? (
              <PanelSection title={m.panelsTabs.text.combinations}>
                <Combos combos={combos} />
              </PanelSection>
            ) : null}
          </>
        ) : (
          <>
            <BrandFonts
              kit={kit}
              onEdit={() => setLeftTab("brand")}
              onPick={(family) => void addTextInFont("Add a heading", family, { fontSize: textPresetSizes(design.width, design.height).heading, fontWeight: 700 })}
            />
            <PanelSection title={m.panelsTabs.text.defaultStyles}>
              <div className="cf-text__styles">
                {TEXT_STYLE_PRESETS.map((p) => (
                  <StyleButton key={p.id} preset={p} />
                ))}
              </div>
            </PanelSection>
            <PanelSection title={m.panelsTabs.text.dynamic}>
              <PageNumbers />
            </PanelSection>
            <PanelSection title={m.panelsTabs.text.combinations}>
              <Combos combos={combos} />
            </PanelSection>
          </>
        )}
      </PanelScroll>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* brand kit fonts                                                      */
/* ------------------------------------------------------------------ */

function BrandFonts({ kit, onEdit, onPick }: { kit: ReturnType<typeof useBrandKit>[0]; onEdit: () => void; onPick: (family: string) => void }) {
  return (
    <PanelSection
      title={
        <span className="cf-text__brandtitle">
          <IconBrand aria-hidden="true" />
          {m.panelsTabs.text.brandKit}
        </span>
      }
      action={<PanelLink onClick={onEdit}>{m.panelsTabs.text.edit}</PanelLink>}
    >
      {kit === null ? (
        <Skeleton height={44} radius={12} />
      ) : kit.fonts.length ? (
        <div className="cf-text__fonts">
          {kit.fonts.slice(0, 4).map((family) => (
            <FontRow key={family} family={family} sample={family} onPick={() => onPick(family)} label={m.panelsTabs.text.headingIn(family)} />
          ))}
        </div>
      ) : (
        <Button variant="secondary" block onClick={onEdit}>
          {m.panelsTabs.text.addBrandFonts}
        </Button>
      )}
    </PanelSection>
  );
}

/* ------------------------------------------------------------------ */
/* default text styles                                                  */
/* ------------------------------------------------------------------ */

function StyleButton({ preset }: { preset: TextStylePreset }) {
  const make = () => {
    const d = useEditor.getState().design;
    const sizes = textPresetSizes(d?.width ?? 1920, d?.height ?? 1080);
    return createText({ text: preset.label, fontFamily: preset.fontFamily, fontWeight: preset.fontWeight, fontSize: sizes[preset.id] });
  };
  return (
    <DraggableItem
      label={preset.label}
      onInsert={() => addTextAndEdit(make())}
      getPayload={() => ({ type: "elements", elements: [make()] })}
      className={cx("cf-text__style", `is-${preset.id}`)}
      tooltip={false}
    >
      <span style={{ fontFamily: cssFontFamily(preset.fontFamily), fontWeight: preset.fontWeight }}>{preset.label}</span>
    </DraggableItem>
  );
}

/* ------------------------------------------------------------------ */
/* dynamic text                                                         */
/* ------------------------------------------------------------------ */

function PageNumbers() {
  const index = useEditor((s) =>
    s.design
      ? Math.max(
          0,
          s.design.pages.findIndex((p) => p.id === s.activePageId),
        )
      : 0,
  );
  const make = () => {
    const d = useEditor.getState().design;
    const pageNo = d
      ? Math.max(
          0,
          d.pages.findIndex((p) => p.id === useEditor.getState().activePageId),
        ) + 1
      : 1;
    return createText({ text: String(pageNo), fontSize: Math.round(designMin() * 0.045), fontWeight: 600 });
  };
  return (
    <DraggableItem
      label={m.panelsTabs.text.addPageNumbers}
      onInsert={() => void getActions().addElement(make())}
      getPayload={() => ({ type: "elements", elements: [make()] })}
      className="cf-text__dynamic"
      tooltip={false}
    >
      <span className="cf-text__dynamic-art" aria-hidden="true">
        <IconHash />
        <b>{index + 1}</b>
      </span>
      <span className="cf-text__dynamic-text">
        <strong>{m.panelsTabs.text.pageNumbers}</strong>
        <span>{m.panelsTabs.text.pageNumbersText(index + 1)}</span>
      </span>
    </DraggableItem>
  );
}

/* ------------------------------------------------------------------ */
/* font combinations                                                    */
/* ------------------------------------------------------------------ */

function Combos({ combos }: { combos: TextCombo[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const cardW = width > 0 ? Math.floor((width - GAP) / 2) : 0;
  return (
    <div ref={ref} className="cf-text__combos">
      {cardW > 0
        ? combos.map((c) => (
            <DraggableItem
              key={c.id}
              label={m.panelsTabs.text.combination(c.name, c.fonts.join(", "))}
              onInsert={() => {
                const d = useEditor.getState().design;
                if (d) void getActions().addElements(c.build({ width: d.width, height: d.height }));
              }}
              getPayload={() => {
                const d = useEditor.getState().design;
                return d ? { type: "elements", elements: c.build({ width: d.width, height: d.height }) } : null;
              }}
              className="cf-text__combo"
              tooltip={false}
            >
              <ComboPreview combo={c} width={cardW} />
              <span className="cf-text__combo-name">{c.name}</span>
            </DraggableItem>
          ))
        : null}
    </div>
  );
}
