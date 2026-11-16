import { DownloadPanel } from "@/export/DownloadPanel";
import { m } from "@/i18n";
import { Modal } from "@/ui";

/** File > Download: the export options in a small dialog (the same panel the Share popover shows). */
export function DownloadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="sm" title={m.editorChrome.download.title}>
      <DownloadPanel onDone={onClose} />
    </Modal>
  );
}
