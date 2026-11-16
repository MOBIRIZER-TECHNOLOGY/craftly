import { useState } from "react";
import { findElement } from "@/core/ops";
import { getActivePage, useEditor } from "@/core/store";
import type { ID } from "@/core/types";
import { m } from "@/i18n";
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
      title={m.editor.altText.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {m.common.cancel}
          </Button>
          <Button variant="primary" onClick={save}>
            {m.common.save}
          </Button>
        </>
      }
    >
      <p className="cf-alt__hint">{m.editor.altText.hint}</p>
      <textarea
        className="cf-alt__input"
        data-autofocus
        rows={4}
        maxLength={MAX}
        value={text}
        placeholder={m.editor.altText.placeholder}
        aria-label={m.editor.altText.title}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="cf-alt__count" aria-live="polite">
        {m.editor.altText.count(text.length, MAX)}
      </div>
    </Modal>
  );
}
