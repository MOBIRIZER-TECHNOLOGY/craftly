import { useMemo, useRef, useState, type DragEvent } from "react";
import { addAssetFromFile, assetSrc, deleteAsset, isAcceptedImage, renameAsset } from "@/core/assets";
import type { Asset } from "@/core/types";
import { insertImage } from "@/editor/insert";
import { m } from "@/i18n";
import { Button, IconButton, IconCloudUpload, IconCopy, IconMore, IconSearch, IconTrash, IconUpload, MenuPopover, Skeleton, TextField, confirm, cx, toast } from "@/ui";
import { DraggableItem } from "../shared/DraggableItem";
import { EmptyHint } from "../shared/EmptyHint";
import { useAssetUrl, useAssets, useDebounced } from "../shared/hooks";
import { Masonry } from "../shared/ItemGrid";
import { Panel, PanelScroll, PanelTop } from "../shared/PanelLayout";
import { PanelSearch } from "../shared/PanelSearch";
import { IconPencilLine } from "../shared/icons";
import "./UploadsTab.css";

/**
 * Uploads: the images you added, stored in your browser. Upload with the button, by dropping files on the panel,
 * or by dropping them straight onto the page. Click an upload to place it, drag it to drop it where you want.
 */
export default function UploadsTab() {
  const assets = useAssets();
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const q = useDebounced(query, 120).trim().toLowerCase();

  const shown = useMemo(() => (assets ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)), [assets, q]);

  const upload = async (files: File[]) => {
    const images = files.filter(isAcceptedImage);
    if (files.length && !images.length) {
      toast.error(m.panelsTabs.uploads.notImages);
      return;
    }
    if (images.length < files.length) toast.info(m.panelsTabs.uploads.skipped(files.length - images.length));
    setUploading((n) => n + images.length);
    let failed = 0;
    for (const file of images) {
      try {
        await addAssetFromFile(file);
      } catch {
        failed++;
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (failed) toast.error(m.panelsTabs.uploads.failed(failed));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    void upload(Array.from(e.dataTransfer.files));
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const empty = assets !== null && assets.length === 0;

  return (
    <Panel>
      <PanelTop>
        <PanelSearch value={query} onChange={setQuery} placeholder={m.panelsTabs.uploads.search} />
        <Button variant="primary" size="lg" block icon={<IconUpload />} loading={uploading > 0} onClick={() => fileRef.current?.click()}>
          {m.panelsTabs.uploads.uploadFiles}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload(files);
          }}
        />
      </PanelTop>
      <PanelScroll>
        <div
          className={cx("cf-uploads__zone", dragging && "is-over", empty && "is-empty")}
          onDragEnter={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth.current++;
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={() => {
            depth.current = Math.max(0, depth.current - 1);
            if (depth.current === 0) setDragging(false);
          }}
          onDrop={onDrop}
        >
          {empty ? <EmptyIntro dragging={dragging} onBrowse={() => fileRef.current?.click()} /> : <DropHint dragging={dragging} onBrowse={() => fileRef.current?.click()} />}
          {assets === null ? (
            <div className="cf-uploads__loading">
              <Skeleton height={110} radius={12} />
              <Skeleton height={140} radius={12} />
            </div>
          ) : shown.length ? (
            <Masonry
              items={shown}
              columns={2}
              minColumnWidth={140}
              gap={8}
              aspectOf={(a) => Math.min(1.6, Math.max(0.5, a.height / a.width))}
              keyOf={(a) => a.id}
              renderItem={(a) => <UploadCard asset={a} />}
            />
          ) : !empty ? (
            <EmptyHint icon={<IconSearch />} title={m.panelsTabs.uploads.noneTitle} text={m.panelsTabs.uploads.noneText(q)} compact />
          ) : null}
        </div>
      </PanelScroll>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* drop zone                                                            */
/* ------------------------------------------------------------------ */

function DropHint({ dragging, onBrowse }: { dragging: boolean; onBrowse: () => void }) {
  return (
    <button type="button" className="cf-uploads__drop" onClick={onBrowse}>
      <IconCloudUpload aria-hidden="true" />
      <span>
        <strong>{dragging ? m.panelsTabs.uploads.dropToUpload : m.panelsTabs.uploads.dropHere}</strong>
        {dragging ? null : <span>{m.panelsTabs.uploads.orBrowse}</span>}
      </span>
    </button>
  );
}

/** Original artwork for the empty library: a folder with a picture card, leaves and sparkles. */
function EmptyIntro({ dragging, onBrowse }: { dragging: boolean; onBrowse: () => void }) {
  return (
    <div className="cf-uploads__intro">
      <svg viewBox="0 0 220 150" className="cf-uploads__art" aria-hidden="true">
        <ellipse cx="110" cy="132" rx="74" ry="9" className="art-shadow" />
        <path d="M44 62c-8-22 6-40 24-34 6-14 24-12 28 4 12-8 26 2 20 16" className="art-leaf art-leaf--back" />
        <path d="M30 48c14 4 20 18 18 34-12-6-24-20-18-34Z" className="art-leaf" />
        <path d="M188 52c-14 2-24 14-24 30 14-2 26-14 24-30Z" className="art-leaf art-leaf--b" />
        <path d="M50 58h40l10 12h72c6 0 10 4 10 10v42c0 6-4 10-10 10H50c-6 0-10-4-10-10V68c0-6 4-10 10-10Z" className="art-folder-back" />
        <g transform="rotate(-7 112 76)">
          <rect x="82" y="42" width="62" height="50" rx="7" className="art-card" />
          <circle cx="102" cy="58" r="6" className="art-sun" />
          <path d="M86 86l16-16 12 10 8-8 18 16v2H86Z" className="art-hill" />
        </g>
        <path d="M44 84h132c6 0 10 4 9 10l-5 32c-1 6-5 8-10 8H55c-5 0-9-2-10-8l-6-32c-1-6 3-10 5-10Z" className="art-folder-front" />
        <path d="M168 24l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" className="art-spark" />
        <path d="M30 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" className="art-spark art-spark--b" />
        <circle cx="196" cy="100" r="3" className="art-dot" />
        <circle cx="22" cy="104" r="2.5" className="art-dot art-dot--b" />
      </svg>
      <h3 className="cf-uploads__intro-title">{m.panelsTabs.uploads.introTitle}</h3>
      <p className="cf-uploads__intro-text">{m.panelsTabs.uploads.introText}</p>
      <button type="button" className={cx("cf-uploads__drop", "is-big", dragging && "is-over")} onClick={onBrowse}>
        <IconCloudUpload aria-hidden="true" />
        <span>
          <strong>{dragging ? m.panelsTabs.uploads.dropToUpload : m.panelsTabs.uploads.dropHere}</strong>
          {dragging ? null : <span>{m.panelsTabs.uploads.orBrowse}</span>}
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* one upload                                                           */
/* ------------------------------------------------------------------ */

function UploadCard({ asset }: { asset: Asset }) {
  const url = useAssetUrl(asset.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(asset.name);
  const menuRef = useRef<HTMLButtonElement>(null);

  const insert = () => void insertImage(assetSrc(asset.id), asset.width, asset.height);

  const commitRename = () => {
    setRenaming(false);
    const next = name.trim();
    if (next && next !== asset.name) void renameAsset(asset.id, next);
    else setName(asset.name);
  };

  const remove = async () => {
    const ok = await confirm({
      title: m.panelsTabs.uploads.deleteTitle(asset.name),
      message: m.panelsTabs.uploads.deleteText,
      confirmLabel: m.common.delete,
      danger: true,
    });
    if (ok) {
      await deleteAsset(asset.id);
      toast.success(m.panelsTabs.uploads.deleted);
    }
  };

  return (
    <div className="cf-uploads__card">
      <DraggableItem
        label={m.panelsTabs.uploads.addToPage(asset.name)}
        onInsert={insert}
        getPayload={() => ({ type: "image", src: assetSrc(asset.id), naturalWidth: asset.width, naturalHeight: asset.height, name: asset.name })}
        className="cf-uploads__item"
        tooltip={false}
      >
        <div className="cf-uploads__thumb" style={{ aspectRatio: `${asset.width} / ${asset.height}` }}>
          {url ? <img src={url} alt="" draggable={false} /> : <Skeleton width="100%" height="100%" radius={0} className="cf-uploads__shimmer" />}
        </div>
        {renaming ? null : <span className="cf-uploads__name">{asset.name}</span>}
      </DraggableItem>
      {renaming ? (
        <div className="cf-uploads__rename">
          <TextField
            size="sm"
            aria-label={m.panelsTabs.uploads.name}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                e.stopPropagation();
                setName(asset.name);
                setRenaming(false);
              }
            }}
          />
        </div>
      ) : null}
      <IconButton
        ref={menuRef}
        label={m.panelsTabs.uploads.more(asset.name)}
        icon={<IconMore />}
        size="sm"
        className="cf-uploads__more"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      />
      <MenuPopover
        open={menuOpen}
        anchor={menuRef.current}
        onClose={() => setMenuOpen(false)}
        placement="bottom-end"
        aria-label={m.panelsTabs.uploads.actions(asset.name)}
        items={[
          { id: "insert", label: m.panelsTabs.uploads.insert, icon: <IconCopy />, onSelect: insert },
          {
            id: "rename",
            label: m.panelsTabs.uploads.rename,
            icon: <IconPencilLine />,
            onSelect: () => {
              setName(asset.name);
              setRenaming(true);
            },
          },
          { type: "divider" },
          { id: "delete", label: m.common.delete, icon: <IconTrash />, danger: true, onSelect: () => void remove() },
        ]}
      />
    </div>
  );
}
