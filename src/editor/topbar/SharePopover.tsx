import { useState, type ReactNode } from "react";
import { useEditor } from "@/core/store";
import { DownloadPanel } from "@/export/DownloadPanel";
import { Button, IconArrowLeft, IconButton, IconDownload, IconExport, IconFileImage, IconInfo, IconPlay, IconPrint, IconShare, Popover, Spinner } from "@/ui";
import { copyPageAsImage, printDesign, saveProjectFile } from "./designActions";
import "./share.css";

interface TileProps {
  icon: ReactNode;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function Tile({ icon, label, busy, disabled, onClick }: TileProps) {
  return (
    <button type="button" className="cf-share__tile" disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick}>
      <span className="cf-share__tile-icon">{busy ? <Spinner size={22} /> : icon}</span>
      <span className="cf-share__tile-label">{label}</span>
    </button>
  );
}

/**
 * The content of the share popover (and of the "share" dialog): local equivalents of the share tiles.
 * Download swaps the panel for the export options with a back arrow.
 */
export function SharePanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"main" | "download">("main");
  const [busy, setBusy] = useState<"project" | "image" | null>(null);

  if (view === "download") {
    return (
      <div className="cf-share">
        {/* a div, not a header: inside a popover a header would count as a second banner landmark of the page */}
        <div className="cf-share__head cf-share__head--back">
          <IconButton size="sm" label="Back to share" icon={<IconArrowLeft aria-hidden="true" />} onClick={() => setView("main")} />
          <h2 className="cf-share__title">Download</h2>
        </div>
        <div className="cf-share__body">
          <DownloadPanel onDone={onClose} />
        </div>
      </div>
    );
  }

  const run = async (key: "project" | "image", task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cf-share">
      <div className="cf-share__head">
        <h2 className="cf-share__title">Share design</h2>
      </div>
      <div className="cf-share__body">
        <div className="cf-share__tiles">
          <Tile icon={<IconDownload aria-hidden="true" />} label="Download" onClick={() => setView("download")} />
          <Tile
            icon={<IconPlay aria-hidden="true" />}
            label="Present"
            onClick={() => {
              onClose();
              useEditor.getState().actions.setPresenting(true);
            }}
          />
          <Tile icon={<IconExport aria-hidden="true" />} label="Save project file" busy={busy === "project"} onClick={() => void run("project", saveProjectFile)} />
          <Tile
            icon={<IconPrint aria-hidden="true" />}
            label="Print"
            onClick={() => {
              onClose();
              void printDesign();
            }}
          />
          <Tile icon={<IconFileImage aria-hidden="true" />} label="Copy as image" busy={busy === "image"} onClick={() => void run("image", copyPageAsImage)} />
        </div>
        <p className="cf-share__note">
          <IconInfo className="cf-share__note-icon" aria-hidden="true" />
          <span>
            Craftly keeps your designs on this device. To move one to another browser or computer, save a project file and open it there - or download the design as an image or PDF
            to send it to someone.
          </span>
        </p>
      </div>
    </div>
  );
}

/** The white "Share" pill in the top bar and its popover. */
export function SharePopover() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setOpen(false);
  return (
    <>
      <Button
        ref={setAnchor}
        className="cf-topbar__share"
        icon={<IconShare aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Share"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cf-topbar__lbl cf-topbar__lbl--share">Share</span>
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} placement="bottom-end" offset={8} className="cf-share-pop" aria-label="Share design">
        <SharePanel onClose={close} />
      </Popover>
    </>
  );
}
