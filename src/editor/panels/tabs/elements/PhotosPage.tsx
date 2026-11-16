import { useMemo, useRef, useState } from "react";
import { PHOTOS, type PhotoCategory, type PhotoDef } from "@/data/photos";
import { insertImageFiles } from "@/editor/insert";
import { m } from "@/i18n";
import { IconImage, IconUpload, toast } from "@/ui";
import { ChipRow } from "../../shared/ChipRow";
import { EmptyHint } from "../../shared/EmptyHint";
import { Masonry } from "../../shared/ItemGrid";
import { Panel, PanelScroll } from "../../shared/PanelLayout";
import { PhotoCell } from "./cells";
import { useElementsNav } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./PhotosPage.css";

const CATEGORY_LABELS: Record<PhotoCategory, string> = m.panelsTabs.elements.photos.categories;

export const matchPhoto = (p: PhotoDef, q: string): boolean => {
  if (!q) return true;
  const hay = `${p.name} ${p.category} ${CATEGORY_LABELS[p.category]} ${p.tags.join(" ")}`.toLowerCase();
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

export function PhotosPage() {
  const query = useElementsNav((s) => s.query);
  const [category, setCategory] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();

  const chips = useMemo(() => {
    const present = (Object.keys(CATEGORY_LABELS) as PhotoCategory[]).filter((c) => PHOTOS.some((p) => p.category === c));
    return [{ id: "all", label: m.panelsTabs.shared.all }, ...present.map((c) => ({ id: c, label: CATEGORY_LABELS[c] }))];
  }, []);

  const results = useMemo(() => PHOTOS.filter((p) => (category === "all" || p.category === category) && matchPhoto(p, q)), [category, q]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const ids = await insertImageFiles(Array.from(files));
      if (ids.length) toast.success(m.panelsTabs.elements.photos.added(ids.length));
      else toast.error(m.panelsTabs.elements.photos.notImage);
    } catch {
      toast.error(m.panelsTabs.elements.photos.addFailed);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Panel>
      <SubPageTop title={m.panelsTabs.elements.categories.photos} placeholder={m.panelsTabs.elements.photos.search}>
        <ChipRow chips={chips} value={category} onChange={setCategory} aria-label={m.panelsTabs.elements.photos.categoriesLabel} />
      </SubPageTop>
      <PanelScroll>
        <button type="button" className="cf-photos__upload" onClick={() => fileRef.current?.click()}>
          <span className="cf-photos__upload-icon">
            <IconUpload aria-hidden="true" />
          </span>
          <span className="cf-photos__upload-text">
            <strong>{m.panelsTabs.elements.photos.uploadOwn}</strong>
            <span>{m.panelsTabs.elements.photos.uploadOwnText}</span>
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        {results.length ? (
          <Masonry items={results} columns={2} minColumnWidth={140} gap={8} aspectOf={(p) => p.height / p.width} keyOf={(p) => p.id} renderItem={(p) => <PhotoCell def={p} />} />
        ) : (
          <EmptyHint
            icon={<IconImage />}
            title={m.panelsTabs.elements.photos.noneTitle}
            text={q ? m.panelsTabs.elements.photos.noneText(query.trim()) : m.panelsTabs.elements.photos.emptyCategory}
          />
        )}
      </PanelScroll>
    </Panel>
  );
}
