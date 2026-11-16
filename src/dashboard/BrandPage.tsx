import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import {
  Button,
  ColorPicker,
  ColorSwatch,
  EmptyState,
  IconArrowLeft,
  IconArrowRight,
  IconButton,
  IconCheck,
  IconClose,
  IconImage,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  Popover,
  SearchField,
  Skeleton,
  cx,
  toast,
} from "@/ui";
import { CustomFonts, useCustomFamilies } from "@/components/CustomFonts";
import { getAssetUrl } from "@/core/assets";
import { m } from "@/i18n";
import { fadedInk, readableOn } from "@/core/color";
import type { Asset, BrandKit } from "@/core/types";
import { FONT_CATALOG, cssFontFamily, customFontDefs, ensureFont, getFontDef, isCustomFamily, preloadFonts, type FontCategory, type FontDef } from "@/render/fonts";
import { IMAGE_ACCEPT, uploadImageFiles } from "./actions";
import { updateBrandKit, useAssets, useBrand } from "./data";
import { pickFiles } from "./files";
import { Page, PageHeader } from "./Page";
import "./BrandPage.css";

const MAX_COLORS = 24;

const CATEGORY_LABEL: Record<FontCategory, string> = m.dashboard.brand.fontCategories;

/** What kind of font a known family is: a font the person uploaded says so, a bundled one names its category. */
const kindOf = (def: FontDef): string => (isCustomFamily(def.family) ? m.dashboard.brand.uploadedFont : CATEGORY_LABEL[def.category]);

/** Brand kit editor: logos, colours, fonts and a live preview card. */
export function BrandPage() {
  const { kit, ready } = useBrand();
  const { assets } = useAssets();

  const logos = useMemo(() => kit.logos.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is Asset => asset !== undefined), [kit.logos, assets]);

  // make the kit's fonts available to the cards and the preview
  const fontKey = kit.fonts.join("|");
  useEffect(() => {
    if (kit.fonts.length > 0) void preloadFonts(kit.fonts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);

  return (
    <Page className="cf-brand">
      <PageHeader title={m.dashboard.brand.title} subtitle={m.dashboard.brand.subtitle} />
      {!ready ? (
        <div className="cf-brand__layout" aria-busy="true" aria-label={m.dashboard.brand.loading}>
          <div className="cf-brand__editor">
            <Skeleton height={150} radius={16} />
            <Skeleton height={170} radius={16} />
            <Skeleton height={220} radius={16} />
          </div>
          <Skeleton height={320} radius={20} />
        </div>
      ) : (
        <div className="cf-brand__layout">
          <div className="cf-brand__editor">
            <LogosCard kit={kit} logos={logos} />
            <ColorsCard colors={kit.colors} />
            <FontsCard fonts={kit.fonts} />
            <Card title={m.dashboard.brand.yourFonts} hint={m.dashboard.brand.yourFontsHint}>
              <CustomFonts />
            </Card>
          </div>
          <aside className="cf-brand__aside" aria-label={m.dashboard.brand.preview}>
            <BrandPreview kit={kit} logo={logos[0]} />
          </aside>
        </div>
      )}
    </Page>
  );
}

function Card({ title, hint, action, children }: { title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="cf-brand__card">
      <header className="cf-brand__card-head">
        <div>
          <h2 className="cf-brand__card-title">{title}</h2>
          <p className="cf-brand__card-hint">{hint}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Logos                                                              */
/* ------------------------------------------------------------------ */

function LogosCard({ kit, logos }: { kit: BrandKit; logos: Asset[] }) {
  const upload = () => {
    void pickFiles({ accept: IMAGE_ACCEPT, multiple: true }).then(async (files) => {
      if (files.length === 0) return;
      const stored = await uploadImageFiles(files, { quiet: true });
      if (stored.length === 0) return;
      await updateBrandKit((current) => ({ ...current, logos: [...current.logos, ...stored.map((asset) => asset.id).filter((id) => !current.logos.includes(id))] }));
      toast.success(m.dashboard.brand.logosAdded(stored.length), { duration: 2600 });
    });
  };

  const remove = (asset: Asset) => {
    const index = kit.logos.indexOf(asset.id);
    void updateBrandKit((current) => ({ ...current, logos: current.logos.filter((id) => id !== asset.id) }));
    toast.info(m.dashboard.brand.logoRemoved, {
      actionLabel: m.common.undo,
      duration: 6000,
      onAction: () =>
        void updateBrandKit((current) => {
          if (current.logos.includes(asset.id)) return current;
          const next = [...current.logos];
          next.splice(Math.min(index, next.length), 0, asset.id);
          return { ...current, logos: next };
        }),
    });
  };

  return (
    <Card
      title={m.dashboard.brand.logos}
      hint={m.dashboard.brand.logosHint}
      action={
        <Button variant="secondary" icon={<IconUpload aria-hidden="true" />} onClick={upload}>
          {m.dashboard.brand.uploadLogo}
        </Button>
      }
    >
      {logos.length === 0 ? (
        <EmptyState icon={<IconImage />} title={m.dashboard.brand.noLogos} text={m.dashboard.brand.noLogosText} />
      ) : (
        <ul className="cf-brand__logos">
          {logos.map((asset) => (
            <li key={asset.id}>
              <LogoTile asset={asset} onRemove={() => remove(asset)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LogoTile({ asset, onRemove }: { asset: Asset; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getAssetUrl(asset.id).then((value) => live && setUrl(value));
    return () => {
      live = false;
    };
  }, [asset.id, asset.blob]);
  return (
    <figure className="cf-brand__logo">
      <div className="cf-brand__logo-stage">{url ? <img src={url} alt={asset.name} draggable={false} /> : <Skeleton width="100%" height="100%" radius={0} />}</div>
      <figcaption className="cf-brand__logo-name" title={asset.name}>
        {asset.name}
      </figcaption>
      <IconButton className="cf-brand__remove" size="sm" label={m.dashboard.brand.removeFromKit(asset.name)} icon={<IconClose aria-hidden="true" />} onClick={onRemove} />
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Colours                                                            */
/* ------------------------------------------------------------------ */

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function moveColor(from: number, to: number): Promise<void> {
  return updateBrandKit((kit) => {
    if (from === to || from < 0 || to < 0 || from >= kit.colors.length || to >= kit.colors.length) return kit;
    const colors = [...kit.colors];
    const [moved] = colors.splice(from, 1);
    colors.splice(to, 0, moved);
    return { ...kit, colors };
  });
}

function ColorsCard({ colors }: { colors: string[] }) {
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const full = colors.length >= MAX_COLORS;

  const onDrop = (event: DragEvent, to: number) => {
    event.preventDefault();
    if (dragFrom !== null) void moveColor(dragFrom, to);
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <Card title={m.dashboard.brand.colours} hint={m.dashboard.brand.coloursHint}>
      <ul className="cf-brand__colors">
        {colors.map((color, index) => (
          <li
            // keyed by position: editing a colour must not remount its chip (that would close the open editor)
            key={index}
            className={cx("cf-brand__color", dragFrom === index && "is-dragging", dragOver === index && dragFrom !== index && "is-over")}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", color);
              setDragFrom(index);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragOver={(event) => {
              if (dragFrom === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (dragOver !== index) setDragOver(index);
            }}
            onDrop={(event) => onDrop(event, index)}
          >
            <ColorChip color={color} index={index} count={colors.length} />
          </li>
        ))}
        <li>
          <IconButton
            className="cf-brand__add"
            label={full ? m.dashboard.brand.coloursFull(MAX_COLORS) : m.dashboard.brand.addAColour}
            icon={<IconPlus aria-hidden="true" />}
            disabled={full}
            aria-haspopup="dialog"
            aria-expanded={adding !== null}
            onClick={(event) => setAdding(event.currentTarget)}
          />
        </li>
      </ul>
      {colors.length === 0 ? <p className="cf-brand__empty-line">{m.dashboard.brand.noColours}</p> : null}
      <AddColorPopover anchor={adding} onClose={() => setAdding(null)} existing={colors} />
    </Card>
  );
}

function ColorChip({ color, index, count }: { color: string; index: number; count: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(color);

  // a colour changed elsewhere (undo, reorder) replaces the local draft
  useEffect(() => setDraft(color), [color]);

  const close = () => setAnchor(null);
  const save = (value: string) => {
    if (sameColor(value, color)) return;
    void updateBrandKit((kit) => ({ ...kit, colors: kit.colors.map((item, i) => (i === index ? value : item)) }));
  };

  return (
    <div className="cf-brand__chip">
      <ColorSwatch color={color} size={56} shape="square" title={m.dashboard.brand.editColour(color.toUpperCase())} onClick={(event) => setAnchor(event.currentTarget)} />
      <span className="cf-brand__hex">{color.toUpperCase()}</span>
      <Popover
        open={anchor !== null}
        anchor={anchor}
        onClose={close}
        placement="bottom-start"
        className="cf-brand__popover"
        aria-label={m.dashboard.brand.editColour(color.toUpperCase())}
      >
        <div className="cf-brand__editcolor">
          <ColorPicker value={draft} onChange={setDraft} onChangeEnd={save} />
          <div className="cf-brand__editcolor-actions">
            <IconButton
              label={m.dashboard.brand.moveEarlier}
              icon={<IconArrowLeft aria-hidden="true" />}
              disabled={index === 0}
              onClick={() => {
                close();
                void moveColor(index, index - 1);
              }}
            />
            <IconButton
              label={m.dashboard.brand.moveLater}
              icon={<IconArrowRight aria-hidden="true" />}
              disabled={index === count - 1}
              onClick={() => {
                close();
                void moveColor(index, index + 1);
              }}
            />
            <span className="cf-brand__spacer" />
            <Button
              variant="secondary"
              icon={<IconTrash aria-hidden="true" />}
              onClick={() => {
                close();
                void updateBrandKit((kit) => ({ ...kit, colors: kit.colors.filter((_item, i) => i !== index) }));
              }}
            >
              {m.common.remove}
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

function AddColorPopover({ anchor, onClose, existing }: { anchor: HTMLElement | null; onClose: () => void; existing: string[] }) {
  return (
    <Popover open={anchor !== null} anchor={anchor} onClose={onClose} placement="bottom-start" className="cf-brand__popover" aria-label={m.dashboard.brand.addBrandColour}>
      <AddColorBody onClose={onClose} existing={existing} />
    </Popover>
  );
}

function AddColorBody({ onClose, existing }: { onClose: () => void; existing: string[] }) {
  const [value, setValue] = useState("#7c3aed");
  const duplicate = existing.some((color) => sameColor(color, value));
  return (
    <div className="cf-brand__editcolor">
      <ColorPicker value={value} onChange={setValue} />
      {duplicate ? <p className="cf-brand__note">{m.dashboard.brand.duplicateColour}</p> : null}
      <div className="cf-brand__editcolor-actions">
        <span className="cf-brand__spacer" />
        <Button variant="secondary" onClick={onClose}>
          {m.common.cancel}
        </Button>
        <Button
          variant="primary"
          disabled={duplicate}
          onClick={() => {
            void updateBrandKit((kit) => (kit.colors.some((color) => sameColor(color, value)) ? kit : { ...kit, colors: [...kit.colors, value] }));
            onClose();
          }}
        >
          {m.dashboard.brand.addColour}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fonts                                                              */
/* ------------------------------------------------------------------ */

function FontsCard({ fonts }: { fonts: string[] }) {
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  // an upload, a rename or a deletion changes what a name in this list is: read here so that the list is drawn again
  useCustomFamilies();

  return (
    <Card
      title={m.dashboard.brand.fonts}
      hint={m.dashboard.brand.fontsHint}
      action={
        <Button
          variant="secondary"
          icon={<IconPlus aria-hidden="true" />}
          aria-haspopup="dialog"
          aria-expanded={picker !== null}
          onClick={(event) => setPicker(event.currentTarget)}
        >
          {m.dashboard.brand.addFont}
        </Button>
      }
    >
      {fonts.length === 0 ? (
        <EmptyState icon={<IconSearch />} title={m.dashboard.brand.noFonts} text={m.dashboard.brand.noFontsText} />
      ) : (
        <ul className="cf-brand__fonts">
          {fonts.map((family, index) => {
            const def = getFontDef(family);
            const role = index === 0 ? m.dashboard.brand.heading : index === 1 ? m.dashboard.brand.body : null;
            return (
              <li key={family} className="cf-brand__font">
                <span className="cf-brand__font-sample" style={{ fontFamily: cssFontFamily(family) }} aria-hidden="true">
                  Aa
                </span>
                <span className="cf-brand__font-text">
                  <span className="cf-brand__font-name" style={{ fontFamily: cssFontFamily(family) }}>
                    {family}
                  </span>
                  <span className="cf-brand__font-meta">
                    {def ? kindOf(def) : m.dashboard.brand.customFont}
                    {role ? ` · ${role}` : ""}
                  </span>
                </span>
                <IconButton
                  size="sm"
                  label={m.dashboard.brand.removeFromKit(family)}
                  icon={<IconClose aria-hidden="true" />}
                  onClick={() => void updateBrandKit((kit) => ({ ...kit, fonts: kit.fonts.filter((item) => item !== family) }))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <Popover
        open={picker !== null}
        anchor={picker}
        onClose={() => setPicker(null)}
        placement="bottom-end"
        className="cf-brand__popover cf-brand__popover--fonts"
        aria-label={m.dashboard.brand.addBrandFont}
      >
        <FontPicker chosen={fonts} />
      </Popover>
    </Card>
  );
}

function FontPicker({ chosen }: { chosen: string[] }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // the uploaded families first, then the bundled ones
  const uploaded = useCustomFamilies();
  const list = [...(uploaded ? customFontDefs() : []), ...FONT_CATALOG].filter((def) => words.every((word) => `${def.family} ${kindOf(def)}`.toLowerCase().includes(word)));
  return (
    <div className="cf-brand__fontpicker">
      <SearchField value={query} onChange={setQuery} placeholder={m.dashboard.brand.searchFonts} aria-label={m.dashboard.brand.searchFonts} autoFocus />
      <div className="cf-brand__fontlist" role="listbox" aria-label={m.dashboard.brand.fontList} aria-multiselectable="true">
        {list.length === 0 ? (
          <p className="cf-brand__note">{m.dashboard.brand.noFontMatches(query.trim())}</p>
        ) : (
          list.map((def) => <FontOption key={def.family} def={def} added={chosen.includes(def.family)} />)
        )}
      </div>
    </div>
  );
}

/** One catalogue font, drawn in itself; the face is fetched when the row scrolls into view. */
function FontOption({ def, added }: { def: FontDef; added: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      void ensureFont(def.family, 400);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void ensureFont(def.family, 400);
          observer.disconnect();
        }
      },
      { root: el.closest(".cf-brand__fontlist"), rootMargin: "160px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [def.family]);

  const toggle = () => {
    void updateBrandKit((kit) =>
      added ? { ...kit, fonts: kit.fonts.filter((item) => item !== def.family) } : kit.fonts.includes(def.family) ? kit : { ...kit, fonts: [...kit.fonts, def.family] },
    );
  };

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={added}
      tabIndex={0}
      className={cx("cf-brand__fontoption", added && "is-added")}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <span className="cf-brand__fontoption-name" style={{ fontFamily: cssFontFamily(def.family) }}>
        {def.family}
      </span>
      <span className="cf-brand__fontoption-meta">{kindOf(def)}</span>
      {added ? <IconCheck className="cf-brand__fontoption-check" aria-hidden="true" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live preview                                                       */
/* ------------------------------------------------------------------ */

function BrandPreview({ kit, logo }: { kit: BrandKit; logo: Asset | undefined }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const logoId = logo?.id;
  useEffect(() => {
    if (!logoId) {
      setLogoUrl(null);
      return;
    }
    let live = true;
    void getAssetUrl(logoId).then((value) => live && setLogoUrl(value));
    return () => {
      live = false;
    };
  }, [logoId]);

  const background = kit.colors[0] ?? "#ffffff";
  const ink = readableOn(background);
  const accent = kit.colors[1] ?? kit.colors[0] ?? "#7c3aed";
  const heading = kit.fonts[0] ?? "Plus Jakarta Sans";
  const body = kit.fonts[1] ?? heading;

  useEffect(() => {
    void ensureFont(heading, 700);
    void ensureFont(body, 400);
  }, [heading, body]);

  // the logo placeholder and the body copy are the ink a little faded, but never below 4.5:1 on the background
  const style = {
    "--cf-brand-bg": background,
    "--cf-brand-ink": ink,
    "--cf-brand-ink-soft": fadedInk(ink, background, 0.82),
    "--cf-brand-ink-faint": fadedInk(ink, background, 0.75),
    "--cf-brand-accent": accent,
    "--cf-brand-accent-ink": readableOn(accent),
  } as CSSProperties;

  return (
    <div className="cf-brand__preview" style={style}>
      <p className="cf-brand__preview-label">{m.dashboard.brand.preview}</p>
      <div className="cf-brand__preview-card">
        <div className="cf-brand__preview-logo">
          {logoUrl ? (
            <img src={logoUrl} alt={logo?.name ?? m.dashboard.brand.previewLogo} draggable={false} />
          ) : (
            <span className="cf-brand__preview-placeholder">
              <IconImage aria-hidden="true" />
              {m.dashboard.brand.previewYourLogo}
            </span>
          )}
        </div>
        <h3 className="cf-brand__preview-title" style={{ fontFamily: cssFontFamily(heading) }}>
          {m.dashboard.brand.previewTitle}
        </h3>
        <p className="cf-brand__preview-body" style={{ fontFamily: cssFontFamily(body) }}>
          {m.dashboard.brand.previewBody}
        </p>
        <span className="cf-brand__preview-button" style={{ fontFamily: cssFontFamily(heading) }}>
          {m.dashboard.brand.previewButton}
        </span>
        {kit.colors.length > 0 ? (
          <div className="cf-brand__preview-swatches" role="img" aria-label={m.dashboard.brand.swatches(kit.colors.map((color) => color.toUpperCase()).join(", "))}>
            {kit.colors.map((color, index) => (
              <span key={index} className="cf-brand__preview-swatch" style={{ background: color }} title={color.toUpperCase()} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
