import { useId, useState } from "react";
import { findElement } from "@/core/ops";
import { getActivePage, useEditor } from "@/core/store";
import type { ID } from "@/core/types";
import { safeLinkUrl } from "@/export/links";
import { m } from "@/i18n";
import { Button, Modal } from "@/ui";
import { useLinkDialog } from "./link";
import { editElements } from "./selection";
import "./LinkDialog.css";

/** An address is a line of text; nobody types one longer than this. */
const MAX = 2000;

/** Mounted once by FloatingToolbar; opens when `openLinkDialog(id)` is called (context menu, "..." menu). */
export function LinkDialog() {
  const id = useLinkDialog((s) => s.id);
  return id ? <LinkModal key={id} id={id} /> : null;
}

/**
 * The address an element leads to: in the presenter, in a PDF and in an SVG, a click on the element opens it. What is typed is
 * kept only as an address that is safe to write into a file (`safeLinkUrl`: the web, mail or a phone number, never code), so
 * "example.com" is stored as "https://example.com"; anything else is refused in words and nothing is changed.
 */
function LinkModal({ id }: { id: ID }) {
  const close = useLinkDialog((s) => s.close);
  const current = useEditor((s) => {
    const page = getActivePage(s);
    return (page && findElement(page, id)?.link) ?? "";
  });
  const [text, setText] = useState(current);
  const [refused, setRefused] = useState(false);
  const errorId = useId();

  const store = (link: string | undefined) => {
    editElements([id], (el) => {
      el.link = link;
    });
    close();
  };

  const save = () => {
    if (!text.trim()) return store(undefined);
    const url = safeLinkUrl(text);
    if (url) store(url);
    else setRefused(true);
  };

  return (
    <Modal
      open
      onClose={close}
      title={m.editor.link.title}
      size="sm"
      footer={
        <>
          {current ? (
            <Button variant="ghost" className="cf-linkdlg__remove" onClick={() => store(undefined)}>
              {m.editor.link.remove}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={close}>
            {m.common.cancel}
          </Button>
          <Button variant="primary" onClick={save}>
            {m.common.save}
          </Button>
        </>
      }
    >
      <p className="cf-linkdlg__hint">{m.editor.link.hint}</p>
      <input
        className="cf-linkdlg__input"
        data-autofocus
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={MAX}
        value={text}
        placeholder={m.editor.link.placeholder}
        aria-label={m.editor.link.address}
        aria-invalid={refused || undefined}
        aria-describedby={refused ? errorId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setRefused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      {refused ? (
        <p className="cf-linkdlg__error" id={errorId} role="alert">
          {m.editor.link.invalid}
        </p>
      ) : null}
    </Modal>
  );
}
