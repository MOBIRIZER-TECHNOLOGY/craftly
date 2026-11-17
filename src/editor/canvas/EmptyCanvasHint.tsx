import { useEffect, useRef } from "react";
import { markFirstRunDone, useFirstRunDone } from "@/components/firstRun";
import { useEditor } from "@/core/store";
import { m } from "@/i18n";
import { IconButton, IconClose, Kbd } from "@/ui";
import "./EmptyCanvasHint.css";

/**
 * A quiet note at the foot of the canvas, the first time a person is in front of an empty page: where text, shapes and photos come
 * from. It is not a dialog and takes no clicks (the page under it works as usual) except on its own close button. It goes for good
 * when that button is pressed, or when the first element arrives (src/components/firstRun.ts); a design that already has
 * something on it never shows it, and neither does a design that is only being looked at.
 *
 * Render it as a child of <Workspace>.
 */
export function EmptyCanvasHint() {
  const loaded = useEditor((s) => s.design !== null);
  const empty = useEditor((s) => !!s.design && s.design.pages.every((page) => page.elements.length === 0));
  const editing = useEditor((s) => s.mode === "edit");
  const done = useFirstRunDone("canvasHint");
  const visible = loaded && editing && empty && !done;
  const seen = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  // the first element on the page is what the hint asked for: its job is done, on this device
  useEffect(() => {
    if (visible) seen.current = true;
    else if (seen.current && loaded && !empty) markFirstRunDone("canvasHint");
  }, [visible, loaded, empty]);

  if (!visible) return null;

  const dismiss = () => {
    // the button is about to go: the keyboard stays on the canvas, not on the top of the page
    root.current?.closest<HTMLElement>("[data-cf-workspace]")?.focus();
    markFirstRunDone("canvasHint");
  };

  const hint = m.editor.emptyHint;
  return (
    <div ref={root} className="cf-firsthint" role="note" aria-label={hint.label} data-cf-ui>
      <div className="cf-firsthint__body">
        <p className="cf-firsthint__title">{hint.title}</p>
        <p className="cf-firsthint__text">{hint.text}</p>
        <p className="cf-firsthint__keys">
          <span>{hint.keys}</span>
          <span className="cf-firsthint__key">
            <Kbd>T</Kbd> {hint.textBox}
          </span>
          <span className="cf-firsthint__key">
            <Kbd>R</Kbd> {hint.rectangle}
          </span>
          <span className="cf-firsthint__key">
            <Kbd>C</Kbd> {hint.circle}
          </span>
          <span className="cf-firsthint__key">
            <Kbd>?</Kbd> {hint.allShortcuts}
          </span>
        </p>
      </div>
      <IconButton className="cf-firsthint__close" label={hint.dismiss} icon={<IconClose aria-hidden="true" />} onClick={dismiss} />
    </div>
  );
}
