import { DownloadPanel } from "@/export/DownloadPanel";
import { Modal } from "@/ui";

/** File > Download: the export options in a small dialog (the same panel the Share popover shows). */
export function DownloadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Download">
      <DownloadPanel onDone={onClose} />
    </Modal>
  );
}
