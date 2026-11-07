import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { addAssetFromFile, assetSrc, isAcceptedImage } from "@/core/assets";
import { textPresetSizes } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Asset, BrandKit } from "@/core/types";
import { insertImage } from "@/editor/insert";
import { FONT_CATALOG, cssFontFamily, ensureFont } from "@/render/fonts";
import {
  Button,
  ColorPicker,
  ColorSwatch,
  IconButton,
  IconClose,
  IconCopy,
  IconImage,
  IconPlus,
  IconTrash,
  IconUpload,
  Popover,
  Select,
  Skeleton,
  openContextMenu,
  toast,
} from "@/ui";
import { PanelHeader } from "../shared/PanelHeader";
import { EmptyHint } from "../shared/EmptyHint";
import { DraggableItem } from "../shared/DraggableItem";
import { useAssets, useAssetUrl, useBrandKit } from "../shared/hooks";
import { ItemGrid } from "../shared/ItemGrid";
import { Panel, PanelScroll, PanelSection, PanelTop } from "../shared/PanelLayout";
import { addTextInFont, applyColorToSelection, applyFontToSelection } from "../shared/panelActions";
import { FontRow } from "./text/FontRow";
import "./BrandTab.css";

const MAX_COLORS = 24;
const sameColor = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

let warmed = false;
/** Start loading the regular face of every catalogue font so the "Add a font" list can show them in their own face. */
function warmFonts() {
  if (warmed) return;
  warmed = true;
  for (const f of FONT_CATALOG) void ensureFont(f.family, 400);
}

/**
 * Brand: the logos, colours and fonts you reuse. Colours apply to the selection (or the page background when
 * nothing is selected), fonts apply to selected text or add a heading, logos go straight onto the page.
 * Everything is stored in the local brand kit and shared with the Brand page of the dashboard.
 */
export default function BrandTab() {
  const [kit, save] = useBrandKit();

  return (
    <Panel>
      <PanelTop>
        <PanelHeader title="Brand kit" subtitle="Logos, colours and fonts you use again and again" />
      </PanelTop>
      <PanelScroll>
        {kit === null ? (
          <div className="cf-brandtab__loading">
            <Skeleton height={20} width={100} radius={6} />
            <Skeleton height={92} radius={12} />
            <Skeleton height={20} width={140} radius={6} />
            <Skeleton height={44} radius={12} />
          </div>
        ) : (
          <>
            <Logos kit={kit} save={save} />
            <Colors kit={kit} save={save} />
            <Fonts kit={kit} save={save} />
          </>
        )}
      </PanelScroll>
    </Panel>
  );
}

type SectionProps = { kit: BrandKit; save: (kit: BrandKit) => Promise<void> };

/* ------------------------------------------------------------------ */
/* logos                                                                */
/* ------------------------------------------------------------------ */

function Logos({ kit, save }: SectionProps) {
  const assets = useAssets();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const logos = useMemo(() => {
    const byId = new Map((assets ?? []).map((a) => [a.id, a]));
    return kit.logos.map((id) => byId.get(id)).filter((a): a is Asset => !!a);
  }, [assets, kit.logos]);

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(isAcceptedImage);
    if (fileRef.current) fileRef.current.value = "";
    if (!list.length) {
      if (files?.length) toast.error("Logos must be images: PNG, JPG, WebP, GIF or SVG.");
      return;
    }
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of list) added.push((await addAssetFromFile(file)).id);
      await save({ ...kit, logos: [...kit.logos, ...added] });
      toast.success(added.length === 1 ? "Logo added to your brand kit" : `${added.length} logos added to your brand kit`);
    } catch {
      toast.error("The logo could not be saved. Try a smaller file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelSection
      title="Logos"
      action={
        logos.length ? (
          <Button variant="soft" size="sm" icon={<IconUpload />} loading={busy} onClick={() => fileRef.current?.click()}>
            Upload
          </Button>
        ) : undefined
      }
    >
      {logos.length ? (
        <ItemGrid columns={2} gap={8}>
          {logos.map((a) => (
            <LogoCard key={a.id} asset={a} onRemove={() => void save({ ...kit, logos: kit.logos.filter((id) => id !== a.id) })} />
          ))}
        </ItemGrid>
      ) : (
        <button type="button" className="cf-brandtab__drop" onClick={() => fileRef.current?.click()} disabled={busy}>
          <span className="cf-brandtab__drop-icon">
            <IconImage aria-hidden="true" />
          </span>
          <strong>{busy ? "Saving your logo..." : "Upload your logo"}</strong>
          <span>PNG, JPG or SVG. Click it to place it on any design.</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
    </PanelSection>
  );
}

function LogoCard({ asset, onRemove }: { asset: Asset; onRemove: () => void }) {
  const url = useAssetUrl(asset.id);
  return (
    <div className="cf-brandtab__logo">
      <DraggableItem
        label={`Add logo ${asset.name}`}
        onInsert={() => void insertImage(assetSrc(asset.id), asset.width, asset.height)}
        getPayload={() => ({ type: "image", src: assetSrc(asset.id), naturalWidth: asset.width, naturalHeight: asset.height, name: asset.name })}
        className="cf-brandtab__logo-card"
        tooltip={false}
      >
        {url ? <img src={url} alt="" draggable={false} /> : <Skeleton width="100%" height="100%" radius={0} />}
      </DraggableItem>
      <IconButton label={`Remove ${asset.name} from the brand kit`} icon={<IconClose />} size="sm" className="cf-brandtab__remove" onClick={onRemove} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* colours                                                              */
/* ------------------------------------------------------------------ */

function Colors({ kit, save }: SectionProps) {
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState("#7c3aed");

  const apply = (color: string) => {
    const result = applyColorToSelection(color);
    if (result === "none") toast.info("Select some text, a shape or a line first, or click an empty part of the page to colour its background.");
  };

  const remove = (color: string) => void save({ ...kit, colors: kit.colors.filter((c) => !sameColor(c, color)) });

  const menu = (e: ReactMouseEvent, color: string) => {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: "apply", label: "Apply colour", onSelect: () => apply(color) },
        {
          id: "copy",
          label: `Copy ${color.toUpperCase()}`,
          icon: <IconCopy />,
          onSelect: () => void navigator.clipboard?.writeText(color).then(() => toast.success(`Copied ${color.toUpperCase()}`)),
        },
        { type: "divider" },
        { id: "remove", label: "Remove from brand kit", icon: <IconTrash />, danger: true, onSelect: () => remove(color) },
      ],
    });
  };

  const add = () => {
    const color = draft.trim();
    setAdding(false);
    if (!color || kit.colors.some((c) => sameColor(c, color))) {
      if (color) toast.info("That colour is already in your brand kit.");
      return;
    }
    void save({ ...kit, colors: [...kit.colors, color].slice(0, MAX_COLORS) });
  };

  return (
    <PanelSection title={`Brand colours${kit.colors.length ? ` (${kit.colors.length})` : ""}`}>
      <div className="cf-brandtab__colors" role="group" aria-label="Brand colours">
        {kit.colors.map((c) => (
          <span
            key={c}
            className="cf-brandtab__color"
            onContextMenu={(e) => menu(e, c)}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                remove(c);
              }
            }}
          >
            <ColorSwatch color={c} size={42} shape="square" title={`${c.toUpperCase()} - click to apply, right-click for more`} onClick={() => apply(c)} />
          </span>
        ))}
        {kit.colors.length < MAX_COLORS ? (
          <button ref={addRef} type="button" className="cf-brandtab__add" aria-label="Add a brand colour" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <IconPlus aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="cf-brandtab__hint">Click a colour to use it on the selected text or shape, or on the page background. Right-click one to remove it.</p>
      <Popover open={adding} anchor={addRef.current} onClose={() => setAdding(false)} placement="bottom-start" className="cf-brandtab__picker" aria-label="Add a brand colour">
        <ColorPicker value={draft} onChange={setDraft} />
        <div className="cf-brandtab__picker-actions">
          <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={add}>
            Add colour
          </Button>
        </div>
      </Popover>
    </PanelSection>
  );
}

/* ------------------------------------------------------------------ */
/* fonts                                                                */
/* ------------------------------------------------------------------ */

function Fonts({ kit, save }: SectionProps) {
  const design = useEditor((s) => s.design);

  const options = useMemo(
    () =>
      FONT_CATALOG.filter((f) => !kit.fonts.includes(f.family)).map((f) => ({
        value: f.family,
        textValue: f.family,
        label: <span style={{ fontFamily: cssFontFamily(f.family), fontSize: 16 }}>{f.family}</span>,
      })),
    [kit.fonts],
  );

  const use = (family: string) => {
    if (applyFontToSelection(family)) return;
    const sizes = textPresetSizes(design?.width ?? 1920, design?.height ?? 1080);
    void addTextInFont("Add a heading", family, { fontSize: sizes.heading, fontWeight: 700 });
  };

  return (
    <PanelSection title={`Brand fonts${kit.fonts.length ? ` (${kit.fonts.length})` : ""}`}>
      {kit.fonts.length ? (
        <div className="cf-brandtab__fonts">
          {kit.fonts.map((family) => (
            <FontRow
              key={family}
              family={family}
              label={`Use ${family}`}
              onPick={() => use(family)}
              trailing={
                <IconButton
                  label={`Remove ${family} from the brand kit`}
                  icon={<IconClose />}
                  size="sm"
                  onClick={() => void save({ ...kit, fonts: kit.fonts.filter((f) => f !== family) })}
                />
              }
            />
          ))}
        </div>
      ) : (
        <EmptyHint compact icon={<IconImage />} title="No brand fonts yet" text="Pick the fonts you use for headings and body text." />
      )}
      <div className="cf-brandtab__addfont" onPointerEnter={warmFonts} onFocusCapture={warmFonts}>
        <Select<string>
          value={null}
          placeholder="Add a font to your kit"
          aria-label="Add a font to your brand kit"
          options={options}
          onChange={(family) => void save({ ...kit, fonts: [...kit.fonts, family] })}
        />
      </div>
      <p className="cf-brandtab__hint">Click a font to apply it to the selected text, or to add a heading in that font.</p>
    </PanelSection>
  );
}
