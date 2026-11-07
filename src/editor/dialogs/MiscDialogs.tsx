/**
 * The small dialogs: share, settings, rename and the "new design" redirect. Nothing in the editor needs most of
 * them (rename is inline in the top bar), but `openDialog()` accepts these names, so each one has to do something real.
 */
import { useEffect, useState } from "react";
import { useEditor } from "@/core/store";
import { Button, Modal, Switch, TextField } from "@/ui";
import { SharePanel } from "../topbar/SharePopover";
import { startNewDesign } from "../topbar/designActions";
import "./dialogs.css";

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="sm" flush aria-label="Share design">
      <SharePanel onClose={onClose} />
    </Modal>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showRulers = useEditor((s) => s.showRulers);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const showPageStrip = useEditor((s) => s.showPageStrip);
  const actions = useEditor.getState().actions;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Settings"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="cf-dialog-stack">
        <Switch checked={showRulers} onChange={() => actions.toggle("showRulers")} label="Show rulers" />
        <Switch checked={snapEnabled} onChange={() => actions.toggle("snapEnabled")} label="Snap to guides" />
        <Switch checked={showPageStrip} onChange={() => actions.toggle("showPageStrip")} label="Show page thumbnails" />
      </div>
    </Modal>
  );
}

export function RenameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const title = useEditor((s) => s.design?.title ?? "");
  const [value, setValue] = useState(title);
  const save = () => {
    useEditor.getState().actions.setTitle(value);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Rename design"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField label="Design name" value={value} maxLength={120} data-autofocus="" onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
      </form>
    </Modal>
  );
}

/** `openDialog("newDesign")` has no dialog of its own: the home page owns "Create a design". */
export function NewDesignRedirect({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    onClose();
    startNewDesign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
