import { useMemo, useRef, useState } from "react";
import { PHOTOS, type PhotoCategory, type PhotoDef } from "@/data/photos";
import { insertImageFiles } from "@/editor/insert";
import { IconImage, IconUpload, toast } from "@/ui";
import { ChipRow } from "../../shared/ChipRow";
import { EmptyHint } from "../../shared/EmptyHint";
import { Masonry } from "../../shared/ItemGrid";
import { Panel, PanelScroll } from "../../shared/PanelLayout";
import { PhotoCell } from "./cells";
import { useElementsNav } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./PhotosPage.css";

const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  landscape: "Landscapes",
  city: "City",
  abstract: "Abstract",
  texture: "Textures",
  nature: "Nature",
  space: "Space",
};

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
    return [{ id: "all", label: "All" }, ...present.map((c) => ({ id: c, label: CATEGORY_LABELS[c] }))];
  }, []);

  const results = useMemo(() => PHOTOS.filter((p) => (category === "all" || p.category === category) && matchPhoto(p, q)), [category, q]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const ids = await insertImageFiles(Array.from(files));
      if (ids.length) toast.success(ids.length === 1 ? "Photo added to the page and to your uploads" : `${ids.length} photos added to the page and to your uploads`);
      else toast.error("That file is not an image. Choose a PNG, JPG, WebP, GIF or SVG.");
    } catch {
      toast.error("The photo could not be added. Try a smaller file.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Panel>
      <SubPageTop title="Photos" placeholder="Search photos">
        <ChipRow chips={chips} value={category} onChange={setCategory} aria-label="Photo categories" />
      </SubPageTop>
      <PanelScroll>
        <button type="button" className="cf-photos__upload" onClick={() => fileRef.current?.click()}>
          <span className="cf-photos__upload-icon">
            <IconUpload aria-hidden="true" />
          </span>
          <span className="cf-photos__upload-text">
            <strong>Upload your own</strong>
            <span>Add photos from your computer</span>
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        {results.length ? (
          <Masonry items={results} columns={2} minColumnWidth={140} gap={8} aspectOf={(p) => p.height / p.width} keyOf={(p) => p.id} renderItem={(p) => <PhotoCell def={p} />} />
        ) : (
          <EmptyHint
            icon={<IconImage />}
            title="No photos found"
            text={q ? `Nothing matches "${query.trim()}". Try "sunset", "ocean" or "forest".` : "No photos in this category yet."}
          />
        )}
      </PanelScroll>
    </Panel>
  );
}
