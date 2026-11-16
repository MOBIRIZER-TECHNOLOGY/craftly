/**
 * The small dialogs: share, settings, rename and the "new design" redirect. Nothing in the editor needs most of
 * them (rename is inline in the top bar), but `openDialog()` accepts these names, so each one has to do something real.
 */
import { useEffect, useState } from "react";
import { useEditor } from "@/core/store";
import { m } from "@/i18n";
import { Button, Modal, Switch, TextField } from "@/ui";
import { SharePanel } from "../topbar/SharePopover";
import { startNewDesign } from "../topbar/designActions";
import "./dialogs.css";

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="sm" flush aria-label={m.editorChrome.share.title}>
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
      title={m.editorChrome.settings.title}
      footer={
        <Button variant="primary" onClick={onClose}>
          {m.common.done}
        </Button>
      }
    >
      <div className="cf-dialog-stack">
        <Switch checked={showRulers} onChange={() => actions.toggle("showRulers")} label={m.editorChrome.settings.showRulers} />
        <Switch checked={snapEnabled} onChange={() => actions.toggle("snapEnabled")} label={m.editorChrome.settings.snapToGuides} />
        <Switch checked={showPageStrip} onChange={() => actions.toggle("showPageStrip")} label={m.editorChrome.settings.showPageThumbnails} />
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
      title={m.editorChrome.rename.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button variant="primary" onClick={save}>
            {m.editorChrome.rename.rename}
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
        <TextField
          label={m.editorChrome.rename.designName}
          value={value}
          maxLength={120}
          data-autofocus=""
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
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
