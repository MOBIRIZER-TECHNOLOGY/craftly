import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { getActivePage, useEditor } from "@/core/store";
import { m } from "@/i18n";
import { IconButton, IconClose } from "@/ui";
import "./notes.css";

const SAVE_DELAY = 400;

/** Presenter notes of the active page. Typing is debounced into one undo step per burst. */
export function NotesPanel() {
  const pageId = useEditor((s) => s.activePageId);
  const stored = useEditor((s) => getActivePage(s)?.notes ?? "");
  const pageNumber = useEditor((s) => (s.design ? s.design.pages.findIndex((p) => p.id === s.activePageId) + 1 : 0));
  const readOnly = useEditor((s) => s.mode === "view");
  const [text, setText] = useState(stored);
  const pending = useRef<{ pageId: string; text: string } | null>(null);
  const timer = useRef(0);
  const lastSent = useRef(stored);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    lastSent.current = p.text;
    useEditor.getState().actions.setPageNotes(p.pageId, p.text);
  }, []);

  // another page became active: write what was typed to the page it belongs to, then show the new page's notes
  useEffect(() => {
    flush();
    lastSent.current = stored;
    setText(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // undo / redo changed the stored notes while nothing is being typed
  useEffect(() => {
    if (!pending.current && stored !== lastSent.current) {
      lastSent.current = stored;
      setText(stored);
    }
  }, [stored]);

  useEffect(() => flush, [flush]);

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    pending.current = { pageId, text: value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  return (
    <section className="cf-notes" aria-label={m.editorChrome.notes.region}>
      <header className="cf-notes__head">
        <h2 className="cf-notes__title">{m.editorChrome.notes.title}</h2>
        <span className="cf-notes__page">{m.editorChrome.pages.page(pageNumber)}</span>
        <IconButton
          className="cf-notes__close"
          size="sm"
          label={m.editorChrome.notes.close}
          icon={<IconClose aria-hidden="true" />}
          onClick={() => useEditor.getState().actions.toggle("notesOpen")}
        />
      </header>
      <textarea
        className="cf-notes__text"
        value={text}
        readOnly={readOnly}
        aria-label={m.editorChrome.notes.notesFor(pageNumber)}
        placeholder={m.editorChrome.notes.placeholder}
        onChange={onChange}
        onBlur={flush}
      />
    </section>
  );
}
