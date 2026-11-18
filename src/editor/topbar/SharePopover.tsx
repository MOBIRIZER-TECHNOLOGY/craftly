import { useEffect, useState, type ReactNode } from "react";
import { spaceTeam, useCloud, type SessionTeam } from "@/cloud/state";
import { getSummary } from "@/core/library";
import { useEditor } from "@/core/store";
import { DownloadPanel } from "@/export/DownloadPanel";
import { m } from "@/i18n";
import { LiveSection } from "../live/LiveSection";
import { TeamLiveSection } from "../live/TeamLiveSection";
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
 * The team whose space the open design is in, for the signed-in person: a design of a team's space is synced to the team's server,
 * not kept on this device only. Null for a design of this device or of the person's own space, and while nobody is signed in.
 */
function useDesignTeam(): SessionTeam | null {
  const designId = useEditor((s) => s.design?.id ?? "");
  const session = useCloud((s) => s.session);
  const [space, setSpace] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    if (!session || !designId) {
      setSpace(null);
      return;
    }
    // (the space is kept with the design's record in the library, not in the design)
    getSummary(designId)
      .then((summary) => !gone && setSpace(summary?.space ?? null))
      .catch(() => !gone && setSpace(null));
    return () => {
      gone = true;
    };
  }, [session, designId]);
  return spaceTeam(space, session);
}

/**
 * The content of the share popover (and of the "share" dialog): local equivalents of the share tiles.
 * Download swaps the panel for the export options with a back arrow.
 */
export function SharePanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"main" | "download">("main");
  const [busy, setBusy] = useState<"project" | "image" | null>(null);
  const team = useDesignTeam();

  if (view === "download") {
    return (
      <div className="cf-share">
        {/* a div, not a header: inside a popover a header would count as a second banner landmark of the page */}
        <div className="cf-share__head cf-share__head--back">
          <IconButton size="sm" label={m.editorChrome.share.backToShare} icon={<IconArrowLeft aria-hidden="true" />} onClick={() => setView("main")} />
          <h2 className="cf-share__title">{m.editorChrome.share.download}</h2>
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
        <h2 className="cf-share__title">{m.editorChrome.share.title}</h2>
      </div>
      <div className="cf-share__body">
        <div className="cf-share__tiles">
          <Tile icon={<IconDownload aria-hidden="true" />} label={m.editorChrome.share.download} onClick={() => setView("download")} />
          <Tile
            icon={<IconPlay aria-hidden="true" />}
            label={m.editorChrome.share.present}
            onClick={() => {
              onClose();
              useEditor.getState().actions.setPresenting(true);
            }}
          />
          <Tile
            icon={<IconExport aria-hidden="true" />}
            label={m.editorChrome.share.saveProjectFile}
            busy={busy === "project"}
            onClick={() => void run("project", saveProjectFile)}
          />
          <Tile
            icon={<IconPrint aria-hidden="true" />}
            label={m.editorChrome.share.print}
            onClick={() => {
              onClose();
              void printDesign();
            }}
          />
          <Tile icon={<IconFileImage aria-hidden="true" />} label={m.editorChrome.share.copyAsImage} busy={busy === "image"} onClick={() => void run("image", copyPageAsImage)} />
        </div>
        <TeamLiveSection />
        <LiveSection />
        <p className="cf-share__note">
          <IconInfo className="cf-share__note-icon" aria-hidden="true" />
          <span>{team ? m.editorChrome.share.teamNote(team.name) : m.editorChrome.share.note}</span>
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
        aria-label={m.editorChrome.share.share}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cf-topbar__lbl cf-topbar__lbl--share">{m.editorChrome.share.share}</span>
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} placement="bottom-end" offset={8} className="cf-share-pop" aria-label={m.editorChrome.share.title}>
        <SharePanel onClose={close} />
      </Popover>
    </>
  );
}
