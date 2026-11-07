import { useMemo, useState } from "react";
import { getActions, useActivePage, useEditor, useSelectedElements, type ColorTarget } from "@/core/store";
import type { LinearGradientFill, PaintFill } from "@/core/types";
import { DEFAULT_GRADIENTS, DEFAULT_SOLID_COLORS, searchColors } from "@/data/palettes";
import { useTextSelectionStyle } from "@/editor/canvas/textEditing";
import { Button, ColorPicker, ColorSwatch, IconBrand, IconEyedropper, IconPalette, IconPlus, IconTransparency, IconFile, Popover, SearchField } from "@/ui";
import { applyGradient, applySolid, describeTarget, samePaint, solidPaint } from "./colorTargets";
import { collectDocumentColors } from "./docColors";
import { PanelEmpty, PanelShell, Section } from "./PanelShell";
import { paintCss } from "./paintCss";
import { useBatch } from "./useBatch";
import { useBrandKit, useRecentColors } from "./useLibrary";
import "./ColorPanel.css";

const RAINBOW = "conic-gradient(from 90deg, #ff3b30, #ff9500, #ffd60a, #34c759, #00c7be, #0a84ff, #5e5ce6, #bf5af2, #ff2d95, #ff3b30)";
const SLOTS_COLLAPSED = 21;
const GRADIENTS_COLLAPSED = 18;

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}
const getEyeDropper = (): (new () => EyeDropperLike) | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper;

/* ---- the panel ---- */

export function ColorPanel({ target, colorKey }: { target: ColorTarget; colorKey?: string }) {
  const els = useSelectedElements();
  const page = useActivePage();
  const design = useEditor((s) => s.design);
  // while characters are selected in a text box being edited, the "current" colour is theirs
  const inlineColor = useTextSelectionStyle((s) => (s.active && !s.collapsed ? s.style.color : undefined));
  const model = useMemo(() => describeTarget(target, colorKey, els, page), [target, colorKey, els, page]);
  const current: PaintFill | null = target === "text" && inlineColor ? solidPaint(inlineColor) : model.current;

  const kit = useBrandKit();
  const [recents, remember] = useRecentColors();
  const batch = useBatch();
  const actions = getActions();

  const [query, setQuery] = useState("");
  const [showAllDoc, setShowAllDoc] = useState(false);
  const [showAllGradients, setShowAllGradients] = useState(false);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [picker, setPicker] = useState("#7c3aed");
  // the document colours must not shuffle while a colour is being dragged in the picker
  const liveDoc = useMemo(() => (design ? collectDocumentColors(design) : []), [design]);
  const [frozenDoc, setFrozenDoc] = useState<string[] | null>(null);
  const docColors = frozenDoc ?? liveDoc;

  const results = useMemo(() => (query.trim() ? searchColors(query) : []), [query]);
  const EyeDropper = getEyeDropper();

  const pickSolid = (color: string) => {
    batch.end();
    applySolid(target, colorKey, color);
    remember(color);
  };
  const pickGradient = (g: LinearGradientFill) => {
    batch.end();
    applyGradient(target, colorKey, g);
  };

  const openAdd = (anchor: HTMLElement) => {
    const start = current?.type === "solid" ? current.color : (current?.stops[0]?.color ?? "#7c3aed");
    setPicker(start.startsWith("#") ? start.slice(0, 7) : "#7c3aed");
    setFrozenDoc(liveDoc);
    setAddAnchor(anchor);
  };
  const closeAdd = () => {
    batch.end();
    setAddAnchor(null);
    setFrozenDoc(null);
  };

  const pickFromScreen = async () => {
    if (!EyeDropper) return;
    try {
      const result = await new EyeDropper().open();
      pickSolid(result.sRGBHex);
    } catch {
      // cancelled with Esc
    }
  };

  const swatches = (colors: string[], size = 36) =>
    colors.map((c, i) => <ColorSwatch key={`${i}-${c}`} color={c} size={size} title={c.toUpperCase()} selected={samePaint(current, solidPaint(c))} onClick={() => pickSolid(c)} />);

  if (!model.supported) {
    return (
      <PanelShell title={model.title}>
        <PanelEmpty icon={<IconPalette />} title={model.emptyTitle} text={model.emptyText} />
      </PanelShell>
    );
  }

  const docSlots = showAllDoc ? docColors : docColors.slice(0, SLOTS_COLLAPSED - 1 - (EyeDropper ? 1 : 0));
  const gradients = showAllGradients ? DEFAULT_GRADIENTS : DEFAULT_GRADIENTS.slice(0, GRADIENTS_COLLAPSED);
  const searching = query.trim().length > 0;

  return (
    <PanelShell title={model.title}>
      <div className="cf-color">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={"Try “blue” or “#00c4cc”"}
          aria-label="Search colors"
          onSubmit={(v) => {
            const first = searchColors(v)[0];
            if (first) pickSolid(first);
          }}
        />

        {searching ? (
          <Section title="Search results">
            {results.length ? (
              <div className="cf-color__grid cf-color__grid--7">{swatches(results)}</div>
            ) : (
              <p className="cf-ctx__hint">No colors match “{query.trim()}”. Try a color name like “teal” or a hex code like #00c4cc.</p>
            )}
          </Section>
        ) : (
          <>
            <Section title="Document colors" icon={<IconFile />}>
              <div className="cf-color__grid cf-color__grid--7">
                <button
                  type="button"
                  className="cf-color__round cf-color__add"
                  style={{ backgroundImage: RAINBOW }}
                  aria-label="Add a new color"
                  title="Add a new color"
                  aria-haspopup="dialog"
                  aria-expanded={!!addAnchor}
                  onClick={(e) => (addAnchor ? closeAdd() : openAdd(e.currentTarget))}
                >
                  <span className="cf-color__add-inner">
                    <IconPlus aria-hidden="true" />
                  </span>
                </button>
                {EyeDropper ? (
                  <button
                    type="button"
                    className="cf-color__round cf-color__eye"
                    aria-label="Pick a color from the screen"
                    title="Pick a color from the screen"
                    onClick={pickFromScreen}
                  >
                    <IconEyedropper aria-hidden="true" />
                  </button>
                ) : null}
                {swatches(docSlots)}
              </div>
              {docColors.length > docSlots.length || showAllDoc ? (
                <button type="button" className="cf-color__more" onClick={() => setShowAllDoc((v) => !v)}>
                  {showAllDoc ? "Show less" : `Show all ${docColors.length} colors`}
                </button>
              ) : null}
              <Popover open={!!addAnchor} anchor={addAnchor} onClose={closeAdd} placement="bottom-start" className="cf-color__pop" aria-label="Pick a custom color">
                <div className="cf-color__pop-body">
                  <ColorPicker
                    value={picker}
                    onChange={(c) => {
                      setPicker(c);
                      batch.run(() => applySolid(target, colorKey, c));
                    }}
                    onChangeEnd={(c) => {
                      batch.end();
                      remember(c);
                    }}
                  />
                </div>
              </Popover>
            </Section>

            <Section
              title="Brand kit"
              icon={<IconBrand />}
              aside={
                <button type="button" className="cf-ctx__link" onClick={() => actions.setLeftTab("brand")}>
                  Edit
                </button>
              }
            >
              {kit === null ? null : kit.colors.length ? (
                <div className="cf-color__grid cf-color__grid--7">{swatches(kit.colors)}</div>
              ) : (
                <Button block variant="secondary" icon={<IconPlus />} onClick={() => actions.setLeftTab("brand")}>
                  Add your brand colors
                </Button>
              )}
            </Section>

            {recents.length ? (
              <Section title="Recently used">
                <div className="cf-color__grid cf-color__grid--7">{swatches(recents)}</div>
              </Section>
            ) : null}

            <Section title="Default solid colors" icon={<IconPalette />}>
              <div className="cf-color__grid cf-color__grid--7">{swatches(DEFAULT_SOLID_COLORS)}</div>
            </Section>

            {model.gradients ? (
              <Section
                title="Default gradient colors"
                icon={<IconTransparency />}
                aside={
                  <button type="button" className="cf-ctx__link" onClick={() => setShowAllGradients((v) => !v)}>
                    {showAllGradients ? "Show less" : "See all"}
                  </button>
                }
              >
                <div className="cf-color__grid cf-color__grid--6">
                  {gradients.map((g, i) => (
                    <ColorSwatch
                      key={i}
                      color={paintCss(g)}
                      size={40}
                      title={`Gradient ${g.stops.map((s) => s.color).join(" to ")}`}
                      selected={samePaint(current, g)}
                      onClick={() => pickGradient(g)}
                    />
                  ))}
                </div>
              </Section>
            ) : null}
          </>
        )}
      </div>
    </PanelShell>
  );
}
