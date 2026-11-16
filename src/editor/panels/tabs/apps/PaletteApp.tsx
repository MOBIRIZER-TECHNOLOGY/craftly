import { useEffect, useRef, useState } from "react";
import { addAssetFromFile, isAcceptedImage } from "@/core/assets";
import { getBrandKit, setBrandKit } from "@/core/library";
import type { Asset } from "@/core/types";
import { m } from "@/i18n";
import { Button, ColorSwatch, IconBrand, IconImage, IconUpload, Skeleton, cx, toast } from "@/ui";
import { EmptyHint } from "../../shared/EmptyHint";
import { useAssetUrl, useAssets } from "../../shared/hooks";
import { applyColorToSelection } from "../../shared/panelActions";
import { AppField, AppPage } from "./appKit";
import { extractPalette } from "./quantize";
import "./PaletteApp.css";

const SWATCHES = 6;
const MAX_BRAND_COLORS = 24;

/**
 * Colour palette from an image: pick one of your uploads, get its six dominant colours, click a colour to use it on
 * the selected text or shape (or the page background) and save the set to the brand kit.
 */
export function PaletteApp() {
  const assets = useAssets();
  const [chosen, setChosen] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const images = (assets ?? []).filter((a) => a.kind === "image" || a.kind === "svg");
  const asset = images.find((a) => a.id === chosen) ?? null;
  const url = useAssetUrl(asset?.id);

  // default to the newest upload
  useEffect(() => {
    if (!chosen && images.length) setChosen(images[0].id);
    if (chosen && assets && !images.some((a) => a.id === chosen)) setChosen(images[0]?.id ?? null);
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPalette(null);
    setFailed(false);
    if (!url) return;
    let alive = true;
    extractPalette(url, SWATCHES)
      .then((p) => {
        if (!alive) return;
        if (p.length) setPalette(p);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url]);

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(isAcceptedImage);
    if (fileRef.current) fileRef.current.value = "";
    if (!list.length) return;
    setUploading(true);
    try {
      const added = await addAssetFromFile(list[0]);
      setChosen(added.id);
    } catch {
      toast.error(m.panelsTabs.palette.imageFailed);
    } finally {
      setUploading(false);
    }
  };

  const apply = (color: string) => {
    if (applyColorToSelection(color) === "none") toast.info(m.panelsTabs.shared.nothingToColour);
  };

  const saveToKit = async () => {
    if (!palette) return;
    const kit = await getBrandKit();
    const have = new Set(kit.colors.map((c) => c.toLowerCase()));
    const fresh = palette.filter((c) => !have.has(c.toLowerCase()));
    if (!fresh.length) {
      toast.info(m.panelsTabs.palette.alreadyInKit);
      return;
    }
    await setBrandKit({ ...kit, colors: [...kit.colors, ...fresh].slice(0, MAX_BRAND_COLORS) });
    toast.success(m.panelsTabs.palette.added(fresh.length));
  };

  const picker = <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files)} />;

  if (assets !== null && images.length === 0) {
    return (
      <AppPage title={m.panelsTabs.palette.title} subtitle={m.panelsTabs.palette.subtitle}>
        <EmptyHint
          icon={<IconImage />}
          title={m.panelsTabs.palette.uploadFirst}
          text={m.panelsTabs.palette.uploadFirstText}
          action={
            <Button variant="primary" icon={<IconUpload />} loading={uploading} onClick={() => fileRef.current?.click()}>
              {m.panelsTabs.palette.uploadImage}
            </Button>
          }
        />
        {picker}
      </AppPage>
    );
  }

  return (
    <AppPage
      title={m.panelsTabs.palette.title}
      subtitle={m.panelsTabs.palette.subtitle}
      footer={
        <Button variant="primary" size="lg" block icon={<IconBrand />} disabled={!palette} onClick={() => void saveToKit()}>
          {m.panelsTabs.palette.saveToKit}
        </Button>
      }
    >
      <AppField label={m.panelsTabs.palette.pickImage} hint={m.panelsTabs.palette.pickImageHint}>
        {assets === null ? (
          <Skeleton height={64} radius={12} />
        ) : (
          <div className="cf-pal__images" role="listbox" aria-label={m.panelsTabs.palette.yourUploads}>
            {images.slice(0, 11).map((a) => (
              <UploadChoice key={a.id} asset={a} selected={a.id === chosen} onChoose={() => setChosen(a.id)} />
            ))}
            <button type="button" className="cf-pal__add" aria-label={m.panelsTabs.palette.uploadAnother} onClick={() => fileRef.current?.click()} disabled={uploading}>
              <IconUpload aria-hidden="true" />
            </button>
          </div>
        )}
        {picker}
      </AppField>

      <AppField label={m.panelsTabs.palette.colours} hint={m.panelsTabs.palette.coloursHint}>
        {failed ? (
          <p className="cf-app__error">{m.panelsTabs.palette.readFailed}</p>
        ) : palette ? (
          <div className="cf-pal__swatches" role="group" aria-label={m.panelsTabs.palette.paletteColours}>
            {palette.map((c) => (
              <div key={c} className="cf-pal__swatch">
                <ColorSwatch color={c} size={40} shape="square" title={m.panelsTabs.palette.swatchTitle(c.toUpperCase())} onClick={() => apply(c)} />
                <span>{c.slice(1).toUpperCase()}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cf-pal__swatches" aria-busy="true">
            {Array.from({ length: SWATCHES }, (_, i) => (
              <Skeleton key={i} width={40} height={40} radius={8} />
            ))}
          </div>
        )}
      </AppField>

      {palette ? (
        <div className="cf-pal__bar" aria-hidden="true">
          {palette.map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </div>
      ) : null}
    </AppPage>
  );
}

function UploadChoice({ asset, selected, onChoose }: { asset: Asset; selected: boolean; onChoose: () => void }) {
  const url = useAssetUrl(asset.id);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={asset.name}
      title={asset.name}
      className={cx("cf-pal__choice", selected && "is-selected")}
      onClick={onChoose}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <Skeleton width="100%" height="100%" radius={0} />}
    </button>
  );
}
