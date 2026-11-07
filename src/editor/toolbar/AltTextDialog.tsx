import { useState } from "react";
import { findElement } from "@/core/ops";
import { getActivePage, useEditor } from "@/core/store";
import type { ID } from "@/core/types";
import { Button, Modal } from "@/ui";
import { useAltTextDialog } from "./altText";
import { editElements } from "./selection";
import "./AltTextDialog.css";

const MAX = 500;

/** Mounted once by FloatingToolbar; opens when `openAltTextDialog(id)` is called (context menu, "..." menu). */
export function AltTextDialog() {
  const id = useAltTextDialog((s) => s.id);
  return id ? <AltTextModal key={id} id={id} /> : null;
}

function AltTextModal({ id }: { id: ID }) {
  const close = useAltTextDialog((s) => s.close);
  const current = useEditor((s) => {
    const page = getActivePage(s);
    return (page && findElement(page, id)?.alt) ?? "";
  });
  const [text, setText] = useState(current);

  const save = () => {
    const value = text.trim();
    editElements([id], (el) => {
      el.alt = value || undefined;
    });
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title="Alternative text"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <p className="cf-alt__hint">Describe this element for people who use a screen reader. It is also saved in SVG downloads.</p>
      <textarea
        className="cf-alt__input"
        data-autofocus
        rows={4}
        maxLength={MAX}
        value={text}
        placeholder="For example: a golden sunset over rolling hills"
        aria-label="Alternative text"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="cf-alt__count" aria-live="polite">
        {text.length} / {MAX}
      </div>
    </Modal>
  );
}
