import { useEffect, useState } from "react";
import { useEditor, type DialogName } from "@/core/store";
import { DownloadDialog } from "./DownloadDialog";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { NewDesignRedirect, RenameDialog, SettingsDialog, ShareDialog } from "./MiscDialogs";
import { ModelsDialog } from "./ModelsDialog";
import { ResizeDialog } from "./ResizeDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { VersionsDialog } from "./VersionsDialog";

/**
 * Renders the dialog named by `state.dialog`. The last dialog stays mounted for a moment after it closes
 * so the Modal can play its exit animation.
 */
export function DialogHost() {
  const dialog = useEditor((s) => s.dialog);
  const [shown, setShown] = useState<DialogName | null>(dialog);

  useEffect(() => {
    if (dialog) {
      setShown(dialog);
      return;
    }
    const id = window.setTimeout(() => setShown(null), 260);
    return () => window.clearTimeout(id);
  }, [dialog]);

  const open = dialog !== null && dialog === shown;
  const close = () => useEditor.getState().actions.closeDialog();

  switch (shown) {
    case "resize":
      return <ResizeDialog open={open} onClose={close} />;
    case "shortcuts":
      return <ShortcutsDialog open={open} onClose={close} />;
    case "findReplace":
      return <FindReplaceDialog open={open} onClose={close} />;
    case "download":
      return <DownloadDialog open={open} onClose={close} />;
    case "versions":
      return <VersionsDialog open={open} onClose={close} />;
    case "share":
      return <ShareDialog open={open} onClose={close} />;
    case "settings":
      return <SettingsDialog open={open} onClose={close} />;
    case "rename":
      return <RenameDialog open={open} onClose={close} />;
    case "models":
      return <ModelsDialog open={open} onClose={close} />;
    case "newDesign":
      return <NewDesignRedirect onClose={close} />;
    default:
      return null;
  }
}
